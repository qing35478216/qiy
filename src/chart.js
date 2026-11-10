/**
 * 排盘核心：把 HTTP 参数翻译成 iztro 调用，并对结果做结构化补充。
 */
import { astro } from 'iztro';
import { badRequest } from './errors.js';
import {
  hourToTimeIndex,
  parseDate,
  timeIndexToStartHour,
  TIME_NAMES,
  TIME_RANGES,
  toTrueSolarTime,
} from './time.js';

const GENDERS = new Set(['男', '女', 'male', 'female', 'm', 'f']);
const LANGUAGES = new Set(['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN']);
const CONFIG_KEYS = new Set(['algorithm', 'yearDivide', 'horoscopeDivide', 'ageDivide', 'dayDivide']);
const CONFIG_ENUMS = {
  algorithm: ['default', 'zhongzhou'],
  yearDivide: ['normal', 'exact'],
  horoscopeDivide: ['normal', 'exact'],
  ageDivide: ['normal', 'birthday'],
  dayDivide: ['current', 'forward'],
};

/** 流派预设，直接可用 */
export const PRESETS = {
  /** 文墨天机 / 主流通行软件的默认口径 */
  wenmo: { algorithm: 'default', yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'forward' },
  /** 中州派安星法 */
  zhongzhou: { algorithm: 'zhongzhou', yearDivide: 'normal', horoscopeDivide: 'normal', ageDivide: 'normal', dayDivide: 'forward' },
  /** 以立春为年分界 */
  lichun: { algorithm: 'default', yearDivide: 'exact', horoscopeDivide: 'exact', ageDivide: 'normal', dayDivide: 'forward' },
};

const EXTRA_KEYS = ['preset', 'trueSolar', 'hour', 'minute', ...CONFIG_KEYS];

function assertKnownKeys(params, allowed, where) {
  const unknown = Object.keys(params).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw badRequest(`${where} 不支持字段：${unknown.join(', ')}`, { allowed });
  }
}

/**
 * 规范化并校验排盘输入。
 */
function normalizeInput(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw badRequest('请求体必须是 JSON 对象');
  }
  assertKnownKeys(
    params,
    ['type', 'date', 'lunarDate', 'timeIndex', 'gender', 'isLeapMonth', 'fixLeap', 'language', ...EXTRA_KEYS],
    '排盘参数',
  );

  const type = params.type === 'lunar' ? 'lunar' : 'solar';
  const rawDate = params.date ?? params.lunarDate;
  if (!rawDate) throw badRequest('缺少 date（出生日期，格式 YYYY-MM-DD）');
  try {
    parseDate(rawDate); // 提前校验格式与日期合法性
  } catch (err) {
    throw badRequest(err.message);
  }

  if (!params.gender) throw badRequest('缺少 gender（男 / 女）');
  if (!GENDERS.has(String(params.gender).toLowerCase()) && !GENDERS.has(String(params.gender))) {
    throw badRequest(`gender 取值不支持：${params.gender}，可用：男 / 女`);
  }

  let timeIndex = params.timeIndex;
  if (timeIndex === undefined) {
    if (params.hour === undefined) throw badRequest('缺少 timeIndex（0-12）或 hour（0-23）');
    if (!Number.isInteger(params.hour)) throw badRequest('hour 必须是整数');
    timeIndex = hourToTimeIndex(params.hour);
  }
  if (!Number.isInteger(timeIndex) || timeIndex < 0 || timeIndex > 12) {
    throw badRequest(`timeIndex 必须是 0-12 的整数，收到 ${timeIndex}`);
  }

  const language = params.language ?? 'zh-CN';
  if (!LANGUAGES.has(language)) {
    throw badRequest(`language 不支持：${language}`, { supported: [...LANGUAGES] });
  }

  return {
    type,
    dateStr: rawDate,
    timeIndex,
    gender: params.gender,
    isLeapMonth: params.isLeapMonth === true,
    fixLeap: params.fixLeap !== false,
    language,
  };
}

/**
 * 解析流派配置：preset + 单字段覆盖。
 */
function resolveConfig(params) {
  const config = {};
  if (params.preset) {
    const preset = PRESETS[params.preset];
    if (!preset) {
      throw badRequest(`未知 preset：${params.preset}`, { supported: Object.keys(PRESETS) });
    }
    Object.assign(config, preset);
  }
  for (const key of Object.keys(CONFIG_ENUMS)) {
    if (params[key] === undefined) continue;
    if (!CONFIG_ENUMS[key].includes(params[key])) {
      throw badRequest(`config.${key} 取值不支持：${params[key]}`, { supported: CONFIG_ENUMS[key] });
    }
    config[key] = params[key];
  }
  return config;
}

/**
 * 应用真太阳时校正，返回实际用于排盘的日期、时辰与校正明细。
 *
 * 传了 hour 就按精确钟点算；只传 timeIndex 时按该时辰起点估算，
 * 若估算结果跨到另一个时辰，标记 warning 由调用方提示用户补具体时间。
 */
function applyTrueSolarTime(params, base) {
  if (!params.trueSolar || params.trueSolar.enabled === false) {
    return { dateStr: base.dateStr, timeIndex: base.timeIndex, info: null };
  }
  if (typeof params.trueSolar !== 'object' || Array.isArray(params.trueSolar)) {
    throw badRequest('trueSolar 必须是对象，例如 {"longitude": 116.4}');
  }
  const { longitude, standardMeridian = 120, dstAdjust = false } = params.trueSolar;
  if (longitude === undefined) {
    throw badRequest('trueSolar.longitude 必填（出生地经度，东经为正）');
  }
  if (typeof standardMeridian !== 'number') {
    throw badRequest('trueSolar.standardMeridian 必须是数字（默认 120）');
  }

  const hasExactHour = Number.isInteger(params.hour);
  const startHour = hasExactHour
    ? params.hour
    : (base.timeIndex === 12 ? 23 : timeIndexToStartHour(base.timeIndex));
  const minute = hasExactHour && Number.isInteger(params.minute) ? params.minute : 0;

  let adjusted;
  try {
    adjusted = toTrueSolarTime({
      longitude,
      standardMeridian,
      dstAdjust,
      dateStr: base.dateStr,
      hour: startHour,
      minute,
    });
  } catch (err) {
    throw badRequest(`真太阳时校正失败：${err.message}`, { trueSolar: params.trueSolar });
  }

  const timeIndex = hourToTimeIndex(adjusted.hour);
  const crossedHour = timeIndex !== base.timeIndex;
  const estimated = !hasExactHour;

  return {
    dateStr: adjusted.dateStr,
    timeIndex,
    info: {
      applied: true,
      longitude,
      standardMeridian,
      dstAdjust,
      totalOffsetMinutes: adjusted.totalOffsetMinutes,
      breakdown: adjusted.breakdown,
      originalDate: base.dateStr,
      originalHour: `${String(startHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      originalTimeIndex: base.timeIndex,
      adjustedDate: adjusted.dateStr,
      adjustedTime: `${String(adjusted.hour).padStart(2, '0')}:${String(adjusted.minute).padStart(2, '0')}`,
      adjustedTimeIndex: timeIndex,
      adjustedTimeName: TIME_NAMES[timeIndex],
      crossedDay: adjusted.crossedDay,
      crossedHour,
      estimated,
      warning: estimated && crossedHour
        ? `按${TIME_NAMES[base.timeIndex]}起点估算，校正后落到${TIME_NAMES[timeIndex]}，时辰已被改写；填上具体出生钟点才能定准`
        : null,
    },
  };
}

/** 收集本命盘的四化分布 */
function collectMutagens(palaces) {
  const result = { 禄: [], 权: [], 科: [], 忌: [] };
  for (const palace of palaces) {
    const stars = [...(palace.majorStars ?? []), ...(palace.minorStars ?? [])];
    for (const star of stars) {
      if (!star.mutagen) continue;
      const bucket = result[star.mutagen];
      if (!bucket) continue;
      bucket.push({
        star: star.name,
        palace: palace.name,
        branch: palace.earthlyBranch,
        brightness: star.brightness || null,
      });
    }
  }
  return result;
}

/** 三方四正：本宫、三合两宫、对宫 */
function trineAndOpposite(index) {
  return [index, (index + 4) % 12, (index + 8) % 12, (index + 6) % 12];
}

/**
 * 排盘主函数。
 * @param {object} params HTTP 请求参数
 */
export function buildAstrolabe(params) {
  const input = normalizeInput(params);
  const config = resolveConfig(params);
  const solar = applyTrueSolarTime(params, input);

  const option = {
    type: input.type,
    dateStr: solar.dateStr,
    timeIndex: solar.timeIndex,
    gender: input.gender,
    isLeapMonth: input.isLeapMonth,
    fixLeap: input.fixLeap,
    language: input.language,
  };
  if (Object.keys(config).length) option.config = config;

  let astrolabe;
  try {
    astrolabe = astro.withOptions(option);
  } catch (err) {
    throw badRequest(`排盘失败：${err.message}`, { input: option });
  }

  const chart = JSON.parse(JSON.stringify(astrolabe));
  const soulPalace = chart.palaces.find((p) => p.name === '命宫');
  const bodyPalace = chart.palaces.find((p) => p.isBodyPalace);

  chart.palaces = chart.palaces.map((palace) => ({
    ...palace,
    isSoulPalace: palace.index === soulPalace?.index,
    trineAndOpposite: trineAndOpposite(palace.index).map((i) => chart.palaces[i]?.earthlyBranch).filter(Boolean),
  }));

  const effectiveConfig = astro.getConfig();
  const mergedConfig = { ...effectiveConfig, ...config };

  chart.summary = {
    solarDate: chart.solarDate,
    lunarDate: chart.lunarDate,
    chineseDate: chart.chineseDate,
    zodiac: chart.zodiac,
    sign: chart.sign,
    time: chart.time,
    timeRange: chart.timeRange,
    soulPalace: soulPalace ? { name: soulPalace.name, branch: soulPalace.earthlyBranch, stem: soulPalace.heavenlyStem } : null,
    bodyPalace: bodyPalace ? { name: bodyPalace.name, branch: bodyPalace.earthlyBranch } : null,
    soulBranchOfBodyPalace: chart.earthlyBranchOfBodyPalace,
    soulBranchOfSoulPalace: chart.earthlyBranchOfSoulPalace,
    fiveElementsClass: chart.fiveElementsClass,
    soul: chart.soul,
    body: chart.body,
    gender: chart.gender,
    mutagens: collectMutagens(chart.palaces),
  };

  return {
    ok: true,
    meta: {
      engine: 'iztro@2.6.3',
      generatedAt: new Date().toISOString(),
      input: {
        ...input,
        effectiveDate: solar.dateStr,
        effectiveTimeIndex: solar.timeIndex,
        effectiveTimeName: TIME_NAMES[solar.timeIndex],
        effectiveTimeRange: TIME_RANGES[solar.timeIndex],
      },
      config: {
        algorithm: mergedConfig.algorithm,
        yearDivide: mergedConfig.yearDivide,
        horoscopeDivide: mergedConfig.horoscopeDivide,
        ageDivide: mergedConfig.ageDivide,
        dayDivide: mergedConfig.dayDivide,
      },
      trueSolar: solar.info,
    },
    chart,
  };
}

/**
 * 运限时间轴：一次取回十二大限、每个大限下的十个流年，以及指定年份的十二流月。
 * 供底部运限条点选使用。
 */
export function buildTimeline(params) {
  if (!params || typeof params !== 'object') throw badRequest('请求体必须是 JSON 对象');
  assertKnownKeys(params, ['birth', 'year'], '时间轴参数');
  const birth = params.birth ?? params;

  const payload = buildAstrolabe(birth);
  const m = payload.meta.input;

  const chart = astro.withOptions({
    type: m.type,
    dateStr: m.effectiveDate,
    timeIndex: m.effectiveTimeIndex,
    gender: m.gender,
    isLeapMonth: m.isLeapMonth,
    fixLeap: m.fixLeap,
    language: m.language,
    config: payload.meta.config,
  });

  const decadals = chart.decadalList().map((d, i) => ({
    index: d.index,
    palaceName: d.palaceName,
    ageRange: d.ageRange,
    yearRange: d.yearRange,
    ganZhi: `${d.heavenlyStem}${d.earthlyBranch}`,
    years: chart.yearlyList(i).map((y) => ({
      index: y.index,
      year: y.year,
      age: y.age,
      ganZhi: `${y.heavenlyStem}${y.earthlyBranch}`,
    })),
  }));

  const year = Number.isInteger(params.year) ? params.year : new Date().getFullYear();
  let months = [];
  try {
    // iztro 在闰月年份会重复返回同一个闰月，这里按「月份 + 是否闰月」去重
    const seen = new Set();
    months = chart.monthlyList(year)
      .filter((mo) => {
        const key = `${mo.month}-${mo.isLeapMonth}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((mo) => ({
        index: mo.index,
        month: mo.month,
        isLeapMonth: mo.isLeapMonth,
        ganZhi: `${mo.heavenlyStem}${mo.earthlyBranch}`,
        dayRange: mo.dayRange,
        mutagen: mo.mutagen,
      }));
  } catch {
    months = [];
  }

  return {
    ok: true,
    meta: {
      engine: 'iztro@2.6.3',
      generatedAt: new Date().toISOString(),
      birth: m,
      year,
    },
    timeline: { decadals, months },
  };
}

/**
 * 运限查询：大限、小限、流年、流月、流日、流时。
 */
export function buildHoroscope(params) {
  if (!params || typeof params !== 'object') throw badRequest('请求体必须是 JSON 对象');
  assertKnownKeys(params, ['birth', 'targetDate', 'targetTimeIndex', 'targetHour', 'scopes'], '运限参数');
  if (!params.birth) throw badRequest('缺少 birth（出生信息，结构同排盘接口）');
  assertKnownKeys(params.birth, ['type', 'date', 'lunarDate', 'timeIndex', 'gender', 'isLeapMonth', 'fixLeap', 'language', ...EXTRA_KEYS], 'birth');

  const targetDate = params.targetDate ?? new Date().toISOString().slice(0, 10);
  try {
    parseDate(targetDate);
  } catch (err) {
    throw badRequest(err.message);
  }

  let targetTimeIndex = params.targetTimeIndex;
  if (targetTimeIndex === undefined && params.targetHour !== undefined) {
    targetTimeIndex = hourToTimeIndex(params.targetHour);
  }
  if (targetTimeIndex === undefined) targetTimeIndex = 0;
  if (!Number.isInteger(targetTimeIndex) || targetTimeIndex < 0 || targetTimeIndex > 12) {
    throw badRequest('targetTimeIndex 必须是 0-12 的整数');
  }

  const astrolabe = buildAstrolabe(params.birth);
  const chart = astro.withOptions({
    type: astrolabe.meta.input.type,
    dateStr: astrolabe.meta.input.effectiveDate,
    timeIndex: astrolabe.meta.input.effectiveTimeIndex,
    gender: astrolabe.meta.input.gender,
    isLeapMonth: astrolabe.meta.input.isLeapMonth,
    fixLeap: astrolabe.meta.input.fixLeap,
    language: astrolabe.meta.input.language,
    config: astrolabe.meta.config,
  });

  let horoscope;
  try {
    horoscope = chart.horoscope(targetDate, targetTimeIndex);
  } catch (err) {
    throw badRequest(`运限计算失败：${err.message}`, { targetDate, targetTimeIndex });
  }

  const data = JSON.parse(JSON.stringify(horoscope));
  const scopes = Array.isArray(params.scopes) && params.scopes.length
    ? params.scopes.filter((s) => ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'].includes(s))
    : ['decadal', 'age', 'yearly', 'monthly', 'daily', 'hourly'];

  return {
    ok: true,
    meta: {
      engine: 'iztro@2.6.3',
      generatedAt: new Date().toISOString(),
      birth: astrolabe.meta.input,
      targetDate,
      targetTimeIndex,
      scopes,
    },
    horoscope: data,
  };
}
