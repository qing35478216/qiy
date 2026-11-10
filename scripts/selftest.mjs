/**
 * 排盘自检：批量跑随机命盘，校验紫微斗数的硬性规则。
 * 用法：npm test
 */
import { astro } from 'iztro';

const MAJOR_STARS = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞',
  '天府', '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
];

const FIVE_CLASSES = ['水二局', '木三局', '金四局', '土五局', '火六局'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

let checks = 0;
const failures = [];

function assert(cond, message, ctx) {
  checks += 1;
  if (!cond) failures.push({ message, ctx });
}

/**
 * 紫微与天府的关系：以寅宫为轴镜像，即宫位索引之和 ≡ 0 (mod 12)。
 * 寅、申两宫同宫，其余关于寅申轴对称（紫微卯则天府丑，紫微酉则天府未…）。
 */
function palaceIndexOfBranch(branch) {
  return (BRANCHES.indexOf(branch) - BRANCHES.indexOf('寅') + 12) % 12;
}

function checkChart(chart, ctx) {
  assert(chart.palaces.length === 12, '宫位数量应为 12', ctx);

  const names = new Set(chart.palaces.map((p) => p.earthlyBranch));
  assert(names.size === 12, '十二地支不应重复', ctx);

  const majors = chart.palaces.flatMap((p) => p.majorStars.map((s) => ({ ...s, branch: p.earthlyBranch })));
  assert(majors.length === 14, `十四主星数量应为 14，实际 ${majors.length}`, ctx);
  for (const name of MAJOR_STARS) {
    assert(majors.filter((s) => s.name === name).length === 1, `主星 ${name} 应出现且仅出现一次`, ctx);
  }

  const ziwei = majors.find((s) => s.name === '紫微');
  const tianfu = majors.find((s) => s.name === '天府');
  const ziweiIdx = palaceIndexOfBranch(ziwei.branch);
  const tianfuIdx = palaceIndexOfBranch(tianfu.branch);
  assert((ziweiIdx + tianfuIdx) % 12 === 0,
    `紫微(${ziwei.branch}) 与天府(${tianfu.branch}) 不满足寅申轴对称`, ctx);

  assert(FIVE_CLASSES.includes(chart.fiveElementsClass), `五行局取值异常：${chart.fiveElementsClass}`, ctx);

  const soulPalaces = chart.palaces.filter((p) => p.name === '命宫');
  assert(soulPalaces.length === 1, '命宫应唯一', ctx);
  const bodyPalaces = chart.palaces.filter((p) => p.isBodyPalace);
  assert(bodyPalaces.length === 1, '身宫应唯一', ctx);

  // 身宫 = 生月宫 + 时辰数，命宫 = 生月宫 - 时辰数，故两者相隔 2×时辰数，恒为偶数
  const soulIdx = soulPalaces[0].index;
  const bodyIdx = bodyPalaces[0].index;
  const delta = (bodyIdx - soulIdx + 12) % 12;
  assert(delta % 2 === 0, `命宫与身宫应相隔偶数宫（同宫或对称），实际相隔 ${delta} 宫`, ctx);

  const mutagens = chart.palaces
    .flatMap((p) => [...p.majorStars, ...p.minorStars])
    .filter((s) => s.mutagen);
  assert(mutagens.length === 4, `生年四化应有 4 个，实际 ${mutagens.length}`, ctx);

  const mutagenKinds = new Set(mutagens.map((s) => s.mutagen));
  assert(mutagenKinds.size === 4 && ['禄', '权', '科', '忌'].every((m) => mutagenKinds.has(m)),
    `四化应为禄权科忌各一，实际 ${[...mutagenKinds].join('')}`, ctx);
}

const genders = ['男', '女'];
let seed = 20261030;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

for (let i = 0; i < 240; i += 1) {
  const year = 1930 + Math.floor(rand() * 96);
  const month = 1 + Math.floor(rand() * 12);
  const day = 1 + Math.floor(rand() * new Date(Date.UTC(year, month, 0)).getUTCDate());
  const timeIndex = Math.floor(rand() * 13);
  const gender = genders[i % 2];
  const config = i % 3 === 0 ? { algorithm: 'zhongzhou' } : {};
  const ctx = `${year}-${month}-${day} t${timeIndex} ${gender} ${JSON.stringify(config)}`;

  const chart = JSON.parse(JSON.stringify(astro.withOptions({
    type: 'solar', dateStr: `${year}-${month}-${day}`, timeIndex, gender, language: 'zh-CN', config,
  })));
  checkChart(chart, ctx);
}

// 立春边界：同一日期在 normal / exact 下年柱应可能不同，但都不应报错
for (const dateStr of ['1990-02-03', '1990-02-04', '1990-02-05', '2000-02-04']) {
  for (const yearDivide of ['normal', 'exact']) {
    const chart = JSON.parse(JSON.stringify(astro.withOptions({
      type: 'solar', dateStr, timeIndex: 6, gender: '男', language: 'zh-CN', config: { yearDivide },
    })));
    assert(chart.palaces.length === 12, `立春边界 ${dateStr} ${yearDivide} 排盘失败`, dateStr);
  }
}

// 晚子时两种口径都不应报错，且 dayDivide 会影响日柱
const lateZi = (dayDivide) => JSON.parse(JSON.stringify(astro.withOptions({
  type: 'solar', dateStr: '1990-06-15', timeIndex: 12, gender: '男', language: 'zh-CN', config: { dayDivide },
}))).chineseDate;
assert(lateZi('current') !== lateZi('forward'), '晚子时 dayDivide 未影响日柱', 'dayDivide');

if (failures.length) {
  console.error(`\n✗ 自检失败：${failures.length} / ${checks} 项不通过\n`);
  for (const f of failures.slice(0, 20)) {
    console.error(`  - ${f.message}  [${f.ctx}]`);
  }
  process.exit(1);
}

console.log(`✓ 自检通过：${checks} 项断言，240 张随机盘 + 立春边界 + 晚子时口径`);
