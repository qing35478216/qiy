/**
 * 精简盘面：把 iztro 的完整结构压成给 AI 读的紧凑 JSON。
 *
 * 压缩掉的：type / scope / copyright / rawDates / ages / 三套神煞 / 重复字段。
 * 保留的：四柱五行局、生年四化、十二宫的星曜与亮度四化、大限、当年运限。
 */

/** 星曜 -> "武曲(旺·权)"，无亮度四化时就是 "武曲" */
function starToken(star) {
  const bits = [star.brightness, star.mutagen].filter(Boolean);
  return bits.length ? `${star.name}(${bits.join('·')})` : star.name;
}

function palaceLine(palace) {
  const line = { 宫: palace.name, 干支: `${palace.heavenlyStem}${palace.earthlyBranch}` };

  const majors = (palace.majorStars || []).map(starToken);
  line.主星 = majors.length ? majors.join(' ') : '空宫';

  const minors = (palace.minorStars || []).map(starToken);
  if (minors.length) line.辅星 = minors.join(' ');

  const adjs = (palace.adjectiveStars || []).map((s) => s.name);
  if (adjs.length) line.杂曜 = adjs.join(' ');

  if (palace.decadal?.range) line.大限 = `${palace.decadal.range[0]}-${palace.decadal.range[1]}`;
  if (palace.isBodyPalace) line.身宫 = true;

  return line;
}

function mutagenLine(summary) {
  const m = summary.mutagens || {};
  const pick = (k) => (m[k] || []).map((x) => `${x.star}@${x.palace}`).join(' ');
  return { 禄: pick('禄'), 权: pick('权'), 科: pick('科'), 忌: pick('忌') };
}

/**
 * @param {object} payload buildAstrolabe 的返回值
 * @param {object} [horoscope] buildHoroscope 返回的 horoscope 对象，可省略
 */
export function toCompact(payload, horoscope) {
  const chart = payload.chart;
  const s = chart.summary;

  const result = {
    命盘: {
      性别: s.gender,
      阳历: s.solarDate,
      农历: s.lunarDate,
      时辰: `${s.time} ${s.timeRange}`,
      四柱: s.chineseDate,
      五行局: s.fiveElementsClass,
      命主: s.soul,
      身主: s.body,
    },
    生年四化: mutagenLine(s),
    宫位: chart.palaces.map(palaceLine),
  };

  if (payload.meta?.trueSolar) {
    const t = payload.meta.trueSolar;
    result.真太阳时 = `${t.originalDate} → ${t.adjustedDate} ${t.adjustedTime}（偏移 ${t.totalOffsetMinutes} 分钟）`;
  }

  if (horoscope) {
    const host = (idx) => chart.palaces.find((p) => p.index === idx)?.name ?? '';
    const mut = ['禄', '权', '科', '忌']
      .map((k, i) => (horoscope.yearly?.mutagen?.[i] ? `${horoscope.yearly.mutagen[i]}${k}` : ''))
      .filter(Boolean)
      .join(' ');

    result.运限 = {
      虚岁: horoscope.age?.nominalAge,
      大限: `${horoscope.decadal?.heavenlyStem ?? ''}${horoscope.decadal?.earthlyBranch ?? ''} · 本命${host(horoscope.decadal?.index)}`,
      流年: `${horoscope.yearly?.heavenlyStem ?? ''}${horoscope.yearly?.earthlyBranch ?? ''} · 本命${host(horoscope.yearly?.index)}`,
      流年四化: mut,
    };
  }

  return result;
}

/** 估算字符数，供接口返回体积提示 */
export function compactSize(obj) {
  return JSON.stringify(obj).length;
}
