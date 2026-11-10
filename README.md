# 紫微斗数排盘接口

> **qiy** · 本地跑的开源排盘服务，接口 + 看盘页面

本地跑的紫微斗数排盘服务，内核是开源的 [iztro](https://github.com/SylarLong/iztro)（MIT，TypeScript 排盘库），外面套了一层 HTTP 接口，返回标准 JSON，也能直接出命盘 HTML。

```
POST /api/v1/astrolabe   →  完整命盘 JSON
POST /api/v1/compact     →  精简版，约 1200 字，给 AI 读
POST /api/v1/horoscope   →  大限 / 小限 / 流年 / 流月 / 流日 / 流时
POST /api/v1/timeline    →  十二大限 + 每个大限的十年流年 + 十二流月
GET  /api/v1/chart       →  一张排好的命盘（浏览器直接看）
```

## 快速开始

```bash
git clone git@github.com:qing35478216/qiy.git
cd qiy
npm install          # 首次
npm start            # 默认 http://127.0.0.1:8787
```


- <http://127.0.0.1:8787/app> —— **看盘页面**：填生辰出盘，点宫位从右侧抽屉看星曜与释义，底部运限条点选大限 / 流年 / 流月，↑↓ 换年、←→ 换月，右上角可复制精简盘面
- <http://127.0.0.1:8787/> —— 接口调试台：看原始 JSON、复制 cURL

换端口：`PORT=9000 npm start`；想让局域网访问：`HOST=0.0.0.0 npm start`。

## 关于「和文墨天机一样」

iztro 是当前最成熟的开源紫微斗数排盘库，安星法为**通行版本（《紫微斗数全书》体系）**，默认口径与文墨天机这类主流排盘软件一致：年按正月初一分界、晚子时算次日、十四主星按五行局起紫微。

需要说清楚的三点：

1. **不是文墨天机的逆向或移植**，是独立的开源实现，MIT 协议，可商用。
2. **不能保证逐星 100% 相同**。流派差异是真实存在的——四化表（中州派 / 全书 / 飞星派）、杂曜安法（截空、大耗、龙德等）、闰月处理、星曜亮度表，各家软件设置不同结果就不同。本服务的做法是把这些差异全部做成**开关**（见下方「流派配置」），你按文墨天机里的设置对齐即可。
3. **建议抽样核对**。拿几张你在文墨天机里排过的盘，对一下主星落宫、四化、五行局、命身宫；对得上就说明口径一致。真太阳时记得两边都开或都关。

## 接口

### 排盘 `POST /api/v1/astrolabe`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/astrolabe \
  -H 'Content-Type: application/json' \
  -d '{"date":"1990-06-15","timeIndex":6,"gender":"男"}'
```

请求参数：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `date` | string | 是 | 出生日期 `YYYY-MM-DD`，阳历或农历由 `type` 决定 |
| `type` | string | 否 | `solar`（默认）/ `lunar` |
| `timeIndex` | int | 二选一 | 时辰序号 0–12：0 早子时，1 丑时 … 11 亥时，12 晚子时 |
| `hour` | int | 二选一 | 出生钟点 0–23，自动换算时辰（23 点算晚子时） |
| `gender` | string | 是 | `男` / `女` |
| `isLeapMonth` | bool | 否 | 农历闰月，默认 `false` |
| `fixLeap` | bool | 否 | 闰月是否按十五日切分，默认 `true` |
| `language` | string | 否 | `zh-CN`（默认）/ `zh-TW` / `en-US` / `ja-JP` / `ko-KR` / `vi-VN` |
| `preset` | string | 否 | 流派预设：`wenmo` / `zhongzhou` / `lichun` |
| `algorithm` `yearDivide` `horoscopeDivide` `ageDivide` `dayDivide` | string | 否 | 单项覆盖流派配置 |
| `trueSolar` | object | 否 | 真太阳时校正，见下 |

响应结构（节选）：

```json
{
  "ok": true,
  "meta": {
    "engine": "iztro@2.6.3",
    "input": { "dateStr": "1990-06-15", "timeIndex": 6, "gender": "男",
               "effectiveDate": "1990-06-15", "effectiveTimeName": "午时" },
    "config": { "algorithm": "default", "yearDivide": "normal", "dayDivide": "forward" },
    "trueSolar": null
  },
  "chart": {
    "solarDate": "1990-6-15",
    "lunarDate": "一九九〇年五月廿三",
    "chineseDate": "庚午 壬午 辛亥 甲午",
    "fiveElementsClass": "火六局",
    "soul": "贪狼", "body": "火星",
    "palaces": [
      {
        "index": 10, "name": "命宫",
        "heavenlyStem": "戊", "earthlyBranch": "子",
        "isSoulPalace": true, "isBodyPalace": false,
        "majorStars": [{ "name": "武曲", "brightness": "旺", "mutagen": "权" }],
        "minorStars": [], "adjectiveStars": [],
        "changsheng12": "沐浴", "decadal": { "range": [36, 45] },
        "trineAndOpposite": ["子", "辰", "申", "午"]
      }
    ],
    "summary": {
      "soulPalace": { "name": "命宫", "branch": "子", "stem": "戊" },
      "bodyPalace": { "name": "福德", "branch": "寅" },
      "mutagens": { "禄": [{ "star": "太阳", "palace": "父母", "branch": "丑" }] }
    }
  }
}
```

比 iztro 原生输出多出来的部分：`summary`（命身宫、四化分布汇总）、每宫的 `isSoulPalace` 与 `trineAndOpposite`（三方四正地支）、`meta`（实际生效的日期/时辰/配置，真太阳时校正后以这里为准）。

`GET /api/v1/astrolabe` 是同一接口的 query 版本：

```bash
curl -s "http://127.0.0.1:8787/api/v1/astrolabe?date=1990-06-15&timeIndex=6&gender=%E7%94%B7"
```

### 运限 `POST /api/v1/horoscope`

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/horoscope \
  -H 'Content-Type: application/json' \
  -d '{"birth":{"date":"1990-06-15","timeIndex":6,"gender":"男"},
       "targetDate":"2026-10-30","targetTimeIndex":6}'
```

`birth` 结构同排盘参数。响应里的 `horoscope` 含 `decadal`（大限）、`age`（小限）、`yearly`、`monthly`、`daily`、`hourly`，每层带 `index`、干支、`palaceNames`（该层十二宫名，可与本命宫位对齐）、`mutagen`（该层四化）、`stars`（流耀）。

### 运限时间轴 `POST /api/v1/timeline`

一次取回十二大限、每个大限的十年流年、指定年份的十二流月，供页面底部那条运限条使用。

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/timeline \
  -H 'Content-Type: application/json' \
  -d '{"birth":{"date":"1990-06-15","timeIndex":6,"gender":"男"},"year":2026}'
```

```json
{
  "timeline": {
    "decadals": [
      { "index": 10, "palaceName": "命宫", "ageRange": [6, 15], "yearRange": [1995, 2004],
        "ganZhi": "戊子",
        "years": [{ "index": 5, "year": 1995, "age": 6, "ganZhi": "乙亥" }] }
    ],
    "months": [
      { "index": 6, "month": 1, "isLeapMonth": false, "ganZhi": "庚寅", "dayRange": [1, 30],
        "mutagen": ["太阳", "武曲", "太阴", "天同"] }
    ]
  }
}
```

`decadals[]` 按起运先后排列，`index` 是本命宫位索引（0 = 寅宫）。闰月年份 iztro 会重复返回同一个闰月，这里已去重。

### 四化 `GET /api/v1/sihua?stem=庚`

```json
{ "ok": true, "stem": "庚",
  "mutagens": { "禄": "太阳", "权": "武曲", "科": "太阴", "忌": "天同" } }
```

### 精简盘面 `POST /api/v1/compact`

给 AI 读的紧凑版，同一张盘约 **1200 字**（完整接口约 8 千字），塞进对话不占上下文。

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/compact \
  -H 'Content-Type: application/json' \
  -d '{"birth":{"date":"1990-06-15","timeIndex":6,"gender":"男"},"year":2026}'
```

```json
{
 "命盘": { "性别": "男", "阳历": "1990-6-15", "农历": "一九九〇年五月廿三",
          "时辰": "午时 11:00~13:00", "四柱": "庚午 壬午 辛亥 甲午",
          "五行局": "火六局", "命主": "贪狼", "身主": "火星" },
 "生年四化": { "禄": "太阳@父母", "权": "武曲@命宫", "科": "太阴@父母", "忌": "天同@兄弟" },
 "宫位": [
   { "宫": "命宫", "干支": "戊子", "主星": "武曲(旺·权) 天府(庙)",
     "杂曜": "解神 台辅 天哭 天虚", "大限": "6-15", "身宫": true }
 ],
 "运限": { "虚岁": 37, "大限": "己卯 · 本命田宅",
          "流年": "丙午 · 本命迁移", "流年四化": "天同禄 天机权 文昌科 廉贞忌" }
}
```

星曜写作 `星名(亮度·四化)`，无亮度四化就只写星名；主星为空写「空宫」。页面右上角「复制精简盘面」按钮走的就是这个接口。

### 出图 `GET /api/v1/chart`

参数同排盘接口，返回一张 4×4 传统布局的 HTML 命盘（带四化配色、身宫标记、大限区间），浏览器直接打开或丢进 iframe：

```
http://127.0.0.1:8787/api/v1/chart?date=1990-06-15&timeIndex=6&gender=男
```

### 元信息 `GET /api/v1/meta`

返回时辰对照表、流派配置枚举、预设、全部接口清单。`GET /api/v1/health` 做健康检查。

## 流派配置

排盘口径的差异都在这里，可整体用 `preset`，也可单项覆盖：

| 字段 | 取值 | 含义 |
|---|---|---|
| `algorithm` | `default` / `zhongzhou` | 安星法：通行版 / 中州派（差异在杂曜与部分四化） |
| `yearDivide` | `normal` / `exact` | 年分界：正月初一 / 立春 |
| `horoscopeDivide` | `normal` / `exact` | 运限分界：正月初一 / 立春 |
| `ageDivide` | `normal` / `birthday` | 小限分界：自然年 / 生日 |
| `dayDivide` | `current` / `forward` | 晚子时：算当日 / 算次日 |

预设：

- `wenmo`：通行默认口径，`default` + 正月初一 + 晚子时次日（对齐主流排盘软件）
- `zhongzhou`：中州派安星
- `lichun`：以立春为年分界

```bash
curl -s -X POST http://127.0.0.1:8787/api/v1/astrolabe \
  -H 'Content-Type: application/json' \
  -d '{"date":"1990-06-15","timeIndex":6,"gender":"男","preset":"zhongzhou"}'
```

## 真太阳时

不填 `trueSolar` 就按钟表时间（北京时间）排盘。填了会按出生地经度换算：

```json
{
  "date": "1990-06-15",
  "hour": 11,
  "gender": "男",
  "trueSolar": { "longitude": 87.62, "dstAdjust": false }
}
```

- `longitude`：出生地经度，东经为正、西经为负
- `standardMeridian`：时区标准经线，默认 `120`（东八区）
- `dstAdjust`：是否扣除 1986–1991 年中国夏令时（那几年钟表拨快 1 小时）

换算 = 钟表时间 +（经度 − 120）× 4 分钟 + 均时差，跨日会自动进位。校正结果（含明细和实际生效的日期时辰）在 `meta.trueSolar` 里，`meta.input.effectiveDate/effectiveTimeName` 是最终用于排盘的值。

**务必传 `hour` + `minute`，别只传 `timeIndex`。** `timeIndex` 是两小时的区间，只给时辰时校正只能按区间起点估算，很可能被推过界——比如北京出生、选「寅时」，按 03:00 起算扣掉 28 分钟变成 02:31，直接落到丑时，命宫就换了。这种情况下接口会返回：

```json
"trueSolar": {
  "originalHour": "03:00", "adjustedTime": "02:31",
  "crossedHour": true, "estimated": true,
  "warning": "按寅时起点估算，校正后落到丑时，时辰已被改写；填上具体出生钟点才能定准"
}
```

页面会把这行警告标红显示。填了具体钟点（`estimated: false`）就不会有这个问题。

## 目录

```
qiy/
├── server.js          启动入口
├── src/
│   ├── app.js         Express 路由、缓存、错误处理
│   ├── chart.js       排盘、运限、时间轴封装，参数校验，流派配置
│   ├── compact.js     精简盘面（给 AI 读）
│   ├── time.js        时辰换算、真太阳时、均时差、夏令时
│   ├── render.js      服务端命盘 HTML（/api/v1/chart）
│   └── errors.js      错误类型
├── public/
│   ├── app.html       看盘页面（深色墨金 · 单文件）
│   └── index.html     接口调试台
└── scripts/
    ├── selftest.mjs   排盘规则自检（npm test）
    └── ui-check.mjs   页面冒烟测试（npm run test:ui）
```

## 已知边界

- 排盘范围 1–9999 年，日期必须是真实存在的日期（2 月 30 日会直接报 400）。
- 只做**排盘**，不做命理解读。解读可以拿返回的 JSON 自己接大模型。
- 中州派预设只影响该派特有的安星差异，主星与五行局和其它预设相同——这是流派本身的差异范围，不是 bug。
- 没有鉴权。默认只监听 `127.0.0.1`，只给本机用；要对外开放请自行加反向代理和鉴权。

## 依赖与许可

- [iztro](https://github.com/SylarLong/iztro) — MIT
- Express / cors — MIT

本服务代码 MIT。
