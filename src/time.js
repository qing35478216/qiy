/**
 * 时辰换算与真太阳时校正。
 *
 * 紫微斗数以「时辰」为输入单位，iztro 的 timeIndex 约定：
 *   0 = 早子时 00:00-00:59
 *   1..11 = 丑时..亥时
 *   12 = 晚子时 23:00-23:59
 */

/** 十二时辰名称，索引与 timeIndex 对齐（13 项，首尾都是子时） */
export const TIME_NAMES = [
  '早子时', '丑时', '寅时', '卯时', '辰时', '巳时',
  '午时', '未时', '申时', '酉时', '戌时', '亥时', '晚子时',
];

/** 每个 timeIndex 对应的钟点区间描述 */
export const TIME_RANGES = [
  '00:00-00:59', '01:00-02:59', '03:00-04:59', '05:00-06:59',
  '07:00-08:59', '09:00-10:59', '11:00-12:59', '13:00-14:59',
  '15:00-16:59', '17:00-18:59', '19:00-20:59', '21:00-22:59',
  '23:00-23:59',
];

/**
 * 24 小时制钟点 -> iztro timeIndex
 * @param {number} hour 0-23
 */
export function hourToTimeIndex(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`hour 必须是 0-23 的整数，收到 ${hour}`);
  }
  // 23 点归晚子时（12），其余按 (hour+1)/2 向下取整
  return hour === 23 ? 12 : Math.floor((hour + 1) / 2);
}

/**
 * timeIndex -> 该时辰的起始钟点，用于真太阳时换算
 * @param {number} timeIndex 0-12
 */
export function timeIndexToStartHour(timeIndex) {
  if (timeIndex === 0) return 0;
  if (timeIndex === 12) return 23;
  return timeIndex * 2 - 1;
}

/**
 * 解析 YYYY-MM-DD（兼容 / 和 . 分隔）
 * @returns {{year:number, month:number, day:number}}
 */
export function parseDate(dateStr) {
  if (typeof dateStr !== 'string') {
    throw new Error('date 必须是字符串，格式 YYYY-MM-DD');
  }
  const m = dateStr.trim().match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) {
    throw new Error(`date 格式不正确：${dateStr}，应为 YYYY-MM-DD`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || year > 9999) throw new Error(`date 年份超出范围 1-9999：${year}`);
  if (month < 1 || month > 12) throw new Error(`date 月份不正确：${month}`);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) throw new Error(`date 日期不正确：${year}-${month}-${day}`);
  return { year, month, day };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * 均时差（分钟）。NOAA 近似公式，全年误差约 ±0.5 分钟。
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
export function equationOfTime(year, month, day) {
  const startOfYear = Date.UTC(year, 0, 1);
  const target = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.floor((target - startOfYear) / 86400000) + 1;
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/** 中国 1986-1991 年夏令时区间（当年 4 月中旬第一个周日 02:00 至 9 月中旬第一个周日 02:00） */
const CN_DST_SPANS = {
  1986: ['1986-05-04', '1986-09-14'],
  1987: ['1987-04-12', '1987-09-13'],
  1988: ['1988-04-17', '1988-09-11'],
  1989: ['1989-04-16', '1989-09-17'],
  1990: ['1990-04-15', '1990-09-16'],
  1991: ['1991-04-14', '1991-09-15'],
};

/**
 * 判断某天是否落在中国夏令时区间内
 */
export function isChinaDST(year, month, day) {
  const span = CN_DST_SPANS[year];
  if (!span) return false;
  const key = Date.UTC(year, month - 1, day);
  const [s, e] = span.map((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return key >= s && key <= e;
}

/**
 * 真太阳时校正。
 *
 * 钟表时间 + (经度 - 标准经线) × 4 分钟 + 均时差 = 真太阳时
 * 中国统一使用东经 120° 作为标准经线。西经为负值，标准经线可取 15 的整数倍。
 *
 * @param {object} opts
 * @param {number} opts.longitude 出生地经度（东经正、西经负）
 * @param {number} [opts.standardMeridian=120] 时区标准经线
 * @param {boolean} [opts.dstAdjust=false] 是否扣除 1986-1991 中国夏令时
 * @param {string} opts.dateStr 出生日期 YYYY-MM-DD
 * @param {number} opts.hour 出生钟点 0-23
 * @param {number} [opts.minute=0] 出生分钟 0-59
 * @returns {{dateStr:string, hour:number, minute:number, totalOffsetMinutes:number, breakdown:object, crossedDay:boolean}}
 */
export function toTrueSolarTime({ longitude, standardMeridian = 120, dstAdjust = false, dateStr, hour, minute = 0 }) {
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    throw new Error(`longitude 必须是 -180 到 180 之间的数字，收到 ${longitude}`);
  }
  const { year, month, day } = parseDate(dateStr);

  const longitudeOffset = (longitude - standardMeridian) * 4;
  const eot = equationOfTime(year, month, day);
  const dstOffset = dstAdjust && isChinaDST(year, month, day) ? -60 : 0;

  const totalOffsetMinutes = longitudeOffset + eot + dstOffset;

  // 用 UTC 做纯粹的分钟加减，避免宿主时区干扰
  const base = Date.UTC(year, month - 1, day, hour, minute);
  const shifted = new Date(base + Math.round(totalOffsetMinutes * 60) * 1000);

  const resultDateStr = `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;

  return {
    dateStr: resultDateStr,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    totalOffsetMinutes: Number(totalOffsetMinutes.toFixed(2)),
    crossedDay: resultDateStr !== `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
    breakdown: {
      longitudeOffset: Number(longitudeOffset.toFixed(2)),
      equationOfTime: Number(eot.toFixed(2)),
      dstOffset,
      standardMeridian,
      longitude,
    },
  };
}
