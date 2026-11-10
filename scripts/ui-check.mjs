/**
 * 页面渲染冒烟测试：用 jsdom 跑一遍 public/app.html 的前端逻辑，
 * 确认盘面能画出来、宫位可点、流年能切。
 * 需要先启动服务（npm start）。
 */
import { JSDOM } from 'jsdom';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = await JSDOM.fromURL(`${BASE}/app`, {
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  beforeParse(window) {
    window.fetch = (input, init) => fetch(new URL(input, BASE), init);
    // 模拟内嵌预览里剪贴板被拒，强制走降级链路
    window.navigator.clipboard = { writeText: async () => { throw new Error('clipboard denied'); } };
    window.document.execCommand = () => true;
  },
});

const { window } = dom;
const doc = window.document;

// 等待首屏排盘完成（最多 8 秒），再给运限接口留出返回时间
let cells = 0;
for (let i = 0; i < 80; i += 1) {
  await wait(100);
  cells = doc.querySelectorAll('.cell').length;
  if (cells === 12) break;
}
await wait(2500);

const problems = [];
let checks = 0;
const assert = (ok, msg) => { checks += 1; if (!ok) problems.push(msg); };

assert(cells === 12, `盘面宫格数量应为 12，实际 ${cells}`);

const center = doc.querySelector('.center');
assert(!!center, '缺少中宫');
const centerText = center?.textContent ?? '';
assert(/火六局|水二局|木三局|金四局|土五局/.test(centerText), `中宫未显示五行局：${centerText.slice(0, 80)}`);

const pillars = [...doc.querySelectorAll('.pillar .gz2')].map((e) => e.textContent.trim());
assert(pillars.length === 4 && pillars.every((g) => /^[\u4e00-\u9fa5]{2}$/.test(g)),
  `四柱格式异常：${pillars.join(' ')}`);

const soulCells = doc.querySelectorAll('.cell.is-soul');
assert(soulCells.length === 1, `命宫高亮应唯一，实际 ${soulCells.length}`);

const starCount = doc.querySelectorAll('.star').length;
assert(starCount >= 20, `星曜渲染过少：${starCount}`);

const mutagenCount = doc.querySelectorAll('.m').length;
assert(mutagenCount >= 4, `四化标记过少：${mutagenCount}`);

// 中宫应显示流年信息
assert(/流年/.test(centerText), '中宫未显示流年信息');

// 侧栏详情
const detail = doc.querySelector('#detail')?.textContent ?? '';
assert(!!doc.querySelector('#detail .d-name'), `侧栏详情为空：${detail.slice(0, 40)}`);
const summary = doc.querySelector('#summary')?.textContent ?? '';
assert(/化忌/.test(summary), '基本信息面板缺少四化');

// 点击第二个宫位应切换详情
const target = doc.querySelectorAll('.cell')[3];
const before = doc.querySelector('#detail')?.textContent ?? '';
target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(120);
const after = doc.querySelector('#detail')?.textContent ?? '';
assert(before !== after, '点击宫位后详情未变化');
assert(doc.querySelectorAll('.cell.active').length === 1, '选中态应唯一');

// 键盘上一级（流年 +1）
const tlBefore = doc.querySelector('#tl-year .tl-cell.active')?.textContent ?? '';
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
await wait(1600);
const tlAfter = doc.querySelector('#tl-year .tl-cell.active')?.textContent ?? '';
assert(tlBefore && tlAfter && tlBefore !== tlAfter, `切换流年后未更新：${tlBefore} -> ${tlAfter}`);

// ── 精简盘面接口 ──
const cr = await fetch(`${BASE}/api/v1/compact`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ birth: { date: '1990-06-15', timeIndex: 6, gender: '男' }, year: 2026 }),
});
const cd = await cr.json();
assert(cd.ok === true, 'compact 接口返回异常');
assert(cd.chars < 3000, `精简盘面过大：${cd.chars} 字`);
assert(cd.compact?.命盘?.四柱?.split(' ').length === 4, '精简版四柱字段异常');
assert(cd.compact?.宫位?.length === 12, `精简版宫位数量异常：${cd.compact?.宫位?.length}`);
assert(cd.compact?.运限?.流年, '精简版缺少运限');
assert(typeof cd.compact?.宫位?.[0]?.主星 === 'string', '精简版主星应为紧凑字符串');

// ── 运限时间轴 ──
assert(doc.querySelectorAll('#tl-decadal .tl-cell').length === 12, '大限条应为 12 格');
assert(doc.querySelectorAll('#tl-year .tl-cell').length === 10, '流年条应为 10 格');
assert(doc.querySelectorAll('#tl-month .tl-cell').length >= 12, '流月条至少 12 格');
assert(doc.querySelectorAll('#tl-decadal .tl-cell.active').length === 1, '大限条选中项应唯一');
assert(doc.querySelectorAll('#tl-year .tl-cell.active').length === 1, '流年条选中项应唯一');

const yearsBefore = [...doc.querySelectorAll('#tl-year .tl-cell')].map((b) => b.textContent).join('|');
doc.querySelector('#tl-decadal .tl-cell:nth-child(2)').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(1600);
const yearsAfter = [...doc.querySelectorAll('#tl-year .tl-cell')].map((b) => b.textContent).join('|');
assert(yearsBefore !== yearsAfter, '切换大限后流年条未更新');

doc.querySelector('#tl-month .tl-cell:nth-child(3)').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await wait(1600);
assert(doc.querySelectorAll('#tl-month .tl-cell.active').length === 1, '流月条选中项应唯一');
assert(/流月/.test(doc.querySelector('.center-yun')?.textContent ?? ''), '中宫未显示流月');

// ── 真太阳时跨时辰应给出提示 ──
doc.getElementById('btn-edit').click();
doc.getElementById('f-type').value = 'solar';
doc.getElementById('f-date').value = '2005-02-02';
doc.getElementById('f-time').value = '2';
doc.getElementById('f-hour').value = '';
doc.getElementById('f-city').value = '116.41';
doc.getElementById('f-city').dispatchEvent(new window.Event('change', { bubbles: true }));
doc.getElementById('f-submit').click();
await wait(1400);
const tsText = doc.querySelector('.center')?.textContent ?? '';
assert(/03:00起 → 02:31/.test(tsText), `真太阳时未显示换算过程：${tsText.replace(/\s+/g, ' ').slice(0, 120)}`);
assert(/时辰已被改写/.test(tsText), '真太阳时跨时辰未给出警告');

// ── 补齐具体钟点后应回到寅时、命宫乙亥 ──
doc.getElementById('btn-edit').click();
doc.getElementById('f-hour').value = '03:30';
doc.getElementById('f-hour').dispatchEvent(new window.Event('change', { bubbles: true }));
assert(doc.getElementById('f-time').value === '2', '填具体时间后时辰下拉未联动');
doc.getElementById('f-submit').click();
await wait(1400);
const soulCell = [...doc.querySelectorAll('.cell.is-soul')][0];
assert(soulCell?.querySelector('.gz')?.textContent === '乙亥',
  `3:30 出生命宫应为乙亥，实际 ${soulCell?.querySelector('.gz')?.textContent}`);

// ── 复制链路：clipboard 被拒时应降级到 execCommand ──
doc.getElementById('btn-json').click();
await wait(700);
const toastText = doc.getElementById('toast')?.textContent ?? '';
assert(/已复制/.test(toastText), `剪贴板被拒后未降级成功，toast=${toastText}`);
assert(doc.getElementById('copy-overlay').hidden === true, '降级成功时不应弹手动复制窗');

// ── 两层都失败时应弹出手动复制窗 ──
window.document.execCommand = () => false;
doc.getElementById('btn-json').click();
await wait(700);
assert(doc.getElementById('copy-overlay').hidden === false, '自动复制全失败时未弹出手动复制窗');
const copyText = doc.getElementById('copy-text')?.value ?? '';
assert(copyText.includes('命盘') && copyText.length > 500, '手动复制窗内容为空');
assert(copyText === JSON.stringify(JSON.parse(copyText)), '复制内容不是有效 JSON');

// 右下角流年宫名必须带「流年·」前缀，避免和本命宫名混淆
const yrTexts = [...doc.querySelectorAll('.cell-foot .yr')].map((e) => e.textContent).filter(Boolean);
assert(yrTexts.length === 12, `流年宫名数量异常：${yrTexts.length}`);
assert(yrTexts.every((t) => t.startsWith('流年·')), `流年宫名缺少前缀：${yrTexts.slice(0, 3).join(',')}`);
assert(doc.querySelector('.legend')?.textContent.includes('流年宫名'), '盘面缺少图例说明');

if (problems.length) {
  console.error('✗ 页面冒烟测试失败：');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

console.log(`✓ 页面冒烟测试通过（${checks} 项断言）`);
console.log(`  宫格 ${cells} · 星曜 ${starCount} · 四化 ${mutagenCount} · 命宫高亮 ${soulCells.length} · 点击与流年切换正常`);
console.log(`  精简盘面 ${cd.chars} 字（完整接口 11206 字节）`);
window.close();
