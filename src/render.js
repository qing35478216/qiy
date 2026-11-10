/**
 * 服务端渲染一张 4×4 传统布局的紫微命盘（HTML）。
 * 只依赖排盘结果，不引入前端框架，打开即看。
 */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// 传统盘面：地支 -> 网格坐标 [row, col]，均为 0 基
const GRID_POS = {
  巳: [0, 0], 午: [0, 1], 未: [0, 2], 申: [0, 3],
  辰: [1, 0], 酉: [1, 3],
  卯: [2, 0], 戌: [2, 3],
  寅: [3, 0], 丑: [3, 1], 子: [3, 2], 亥: [3, 3],
};

const MUTAGEN_CLASS = { 禄: 'lu', 权: 'quan', 科: 'ke', 忌: 'ji' };

function starHtml(star) {
  const cls = MUTAGEN_CLASS[star.mutagen] || '';
  const brightness = star.brightness ? `<span class="b">${esc(star.brightness)}</span>` : '';
  const mutagen = star.mutagen ? `<span class="m">${esc(star.mutagen)}</span>` : '';
  return `<span class="star ${cls}">${esc(star.name)}${brightness}${mutagen}</span>`;
}

function palaceCell(palace) {
  const [row, col] = GRID_POS[palace.earthlyBranch] ?? [0, 0];
  const major = (palace.majorStars ?? []).map(starHtml).join('');
  const minor = (palace.minorStars ?? []).map(starHtml).join('');
  const adj = (palace.adjectiveStars ?? []).map((s) => `<span class="adj">${esc(s.name)}</span>`).join('');
  const bodyMark = palace.isBodyPalace ? '<span class="tag body">身</span>' : '';
  const soulMark = palace.isSoulPalace ? '<span class="tag soul">命</span>' : '';

  return `
    <div class="cell ${palace.isSoulPalace ? 'is-soul' : ''}" style="grid-row:${row + 1};grid-column:${col + 1}">
      <div class="cell-head">
        <span class="gz">${esc(palace.heavenlyStem)}${esc(palace.earthlyBranch)}</span>
        <span class="pname">${esc(palace.name)}${soulMark}${bodyMark}</span>
      </div>
      <div class="stars">${major}${minor}</div>
      <div class="adjs">${adj}</div>
      <div class="cell-foot">
        <span>${esc(palace.changsheng12)}</span>
        <span>${esc(palace.decadal?.range?.[0] ?? '')}-${esc(palace.decadal?.range?.[1] ?? '')}</span>
      </div>
    </div>`;
}

/**
 * @param {object} payload buildAstrolabe 的返回值
 */
export function renderChartHtml(payload) {
  const chart = payload.chart;
  const s = chart.summary;

  const cells = chart.palaces.map(palaceCell).join('');

  const center = `
    <div class="center">
      <div class="center-title">紫微斗數</div>
      <div class="center-row"><b>${esc(s.solarDate)}</b> 阳历</div>
      <div class="center-row"><b>${esc(s.lunarDate)}</b> 农历</div>
      <div class="center-row">${esc(s.chineseDate)}</div>
      <div class="center-row">${esc(s.fiveElementsClass)} · 命主${esc(s.soul)} · 身主${esc(s.body)}</div>
      <div class="center-row">${esc(s.gender)}命 · ${esc(s.zodiac)} · ${esc(s.sign)}</div>
      <div class="center-row mono">${esc(s.time)} ${esc(s.timeRange)}</div>
      <div class="center-foot">iztro 排盘引擎</div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>紫微命盘 · ${esc(s.solarDate)}</title>
<style>
  :root { --ink:#26221c; --paper:#f7f1e6; --line:#c8bba3; --accent:#b5462f; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:#e9e2d3; color:var(--ink);
         font-family:"Songti SC","STSong","Noto Serif SC",serif; }
  .board { display:grid; grid-template-columns:repeat(4,1fr); grid-template-rows:repeat(4,minmax(158px,auto));
           gap:2px; background:var(--line); border:2px solid var(--line); max-width:1120px; margin:0 auto; }
  .cell { background:var(--paper); padding:8px 10px; display:flex; flex-direction:column; justify-content:space-between; }
  .cell.is-soul { background:#fdf6e4; box-shadow:inset 0 0 0 2px var(--accent); }
  .cell-head { display:flex; justify-content:space-between; align-items:baseline; font-size:12px; }
  .gz { letter-spacing:1px; color:#7c6c52; }
  .pname { font-weight:700; font-size:13px; }
  .tag { display:inline-block; margin-left:4px; padding:0 4px; border-radius:3px; font-size:10px; font-weight:400; color:#fff; }
  .tag.soul { background:var(--accent); }
  .tag.body { background:#7a6a4f; }
  .stars { margin:6px 0; display:flex; flex-wrap:wrap; gap:2px 8px; flex:1; align-content:flex-start; }
  .star { font-size:14px; font-weight:600; }
  .star .b { font-size:10px; margin-left:1px; color:#8a7a5e; font-weight:400; }
  .star .m { font-size:10px; margin-left:2px; padding:0 2px; border-radius:2px; color:#fff; }
  .star.lu .m { background:#2f7a4f; } .star.quan .m { background:#7a4f9c; }
  .star.ke .m { background:#2f5f9c; } .star.ji .m { background:#b5462f; }
  .adjs { display:flex; flex-wrap:wrap; gap:2px 6px; font-size:10px; color:#8a7a5e; }
  .cell-foot { display:flex; justify-content:space-between; font-size:10px; color:#9c8b6e; margin-top:4px; }
  .center { grid-row:2 / span 2; grid-column:2 / span 2; background:#fdf8ec;
            display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
            padding:16px; text-align:center; }
  .center-title { font-size:22px; letter-spacing:8px; color:var(--accent); margin-bottom:6px; }
  .center-row { font-size:13px; color:#4a4133; }
  .center-row b { font-weight:600; }
  .center-row.mono { font-family:ui-monospace,monospace; font-size:11px; color:#8a7a5e; }
  .center-foot { margin-top:8px; font-size:10px; color:#b3a68c; }
  @media (max-width:720px) {
    body { padding:8px; }
    .board { grid-template-rows:repeat(4,minmax(118px,auto)); }
    .star { font-size:12px; } .center-title { font-size:16px; letter-spacing:4px; }
    .center-row { font-size:11px; }
  }
</style>
</head>
<body>
  <div class="board">${cells}${center}</div>
</body>
</html>`;
}
