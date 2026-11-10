import express from 'express';
import cors from 'cors';
import { ApiError, notFound } from './errors.js';
import { buildAstrolabe, buildHoroscope, buildTimeline, PRESETS } from './chart.js';
import { toCompact, compactSize } from './compact.js';
import { renderChartHtml } from './render.js';
import { TIME_NAMES, TIME_RANGES } from './time.js';
import { astro, util } from 'iztro';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ENGINE_VERSION = '2.6.3';

/** 极简 LRU：避免重复排同一张盘 */
class LruCache {
  constructor(limit = 300) {
    this.limit = limit;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}

const cache = new LruCache(300);

/** GET query 全是字符串，按需转数字 / 布尔 */
function coerceQuery(query) {
  const out = { ...query };
  for (const key of ['timeIndex', 'hour', 'minute', 'targetTimeIndex', 'targetHour', 'longitude', 'standardMeridian']) {
    if (out[key] !== undefined && out[key] !== '') out[key] = Number(out[key]);
  }
  for (const key of ['isLeapMonth', 'fixLeap', 'dstAdjust']) {
    if (out[key] !== undefined) out[key] = out[key] === 'true' || out[key] === '1';
  }
  if (out.longitude !== undefined) {
    out.trueSolar = { longitude: out.longitude, dstAdjust: out.dstAdjust === true };
    delete out.longitude;
    delete out.dstAdjust;
  }
  return out;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  // 请求日志（只记方法、路径、耗时）
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  // 静态页面：/ 为调试台，/app 为可视化命盘页
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

  app.get('/api/v1/health', (req, res) => {
    res.json({
      ok: true,
      status: 'healthy',
      engine: `iztro@${ENGINE_VERSION}`,
      uptimeSeconds: Math.round(process.uptime()),
      now: new Date().toISOString(),
    });
  });

  app.get('/api/v1/meta', (req, res) => {
    const cfg = astro.getConfig();
    res.json({
      ok: true,
      engine: { name: 'iztro', version: ENGINE_VERSION },
      languages: ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'vi-VN'],
      timeIndex: TIME_NAMES.map((name, i) => ({ timeIndex: i, name, range: TIME_RANGES[i] })),
      config: {
        defaults: {
          algorithm: cfg.algorithm,
          yearDivide: cfg.yearDivide,
          horoscopeDivide: cfg.horoscopeDivide,
          ageDivide: cfg.ageDivide,
          dayDivide: cfg.dayDivide,
        },
        options: {
          algorithm: { values: ['default', 'zhongzhou'], desc: '安星法：default 通行版，zhongzhou 中州派' },
          yearDivide: { values: ['normal', 'exact'], desc: '年分界：normal 正月初一，exact 立春' },
          horoscopeDivide: { values: ['normal', 'exact'], desc: '运限分界：normal 正月初一，exact 立春' },
          ageDivide: { values: ['normal', 'birthday'], desc: '小限分界：normal 自然年，birthday 生日' },
          dayDivide: { values: ['current', 'forward'], desc: '晚子时：current 算当日，forward 算次日' },
        },
        presets: PRESETS,
      },
      endpoints: [
        { method: 'GET', path: '/api/v1/health', desc: '健康检查' },
        { method: 'GET', path: '/api/v1/meta', desc: '元信息：时辰表、流派配置、接口清单' },
        { method: 'POST', path: '/api/v1/astrolabe', desc: '排盘（JSON 请求体）' },
        { method: 'GET', path: '/api/v1/astrolabe', desc: '排盘（query 参数）' },
        { method: 'POST', path: '/api/v1/horoscope', desc: '运限：大限/小限/流年/流月/流日/流时' },
        { method: 'POST', path: '/api/v1/compact', desc: '精简盘面（给 AI 读，约 1200 字）' },
        { method: 'GET', path: '/api/v1/sihua', desc: '按天干查四化，如 ?stem=庚' },
        { method: 'GET', path: '/api/v1/chart', desc: '返回一张 HTML 命盘，浏览器直接看' },
      ],
    });
  });

  app.post('/api/v1/astrolabe', (req, res) => {
    const key = JSON.stringify(req.body ?? {});
    const hit = cache.get(key);
    if (hit) {
      res.set('X-Cache', 'HIT').json(hit);
      return;
    }
    const payload = buildAstrolabe(req.body);
    cache.set(key, payload);
    res.set('X-Cache', 'MISS').json(payload);
  });

  app.get('/api/v1/astrolabe', (req, res) => {
    const payload = buildAstrolabe(coerceQuery(req.query));
    res.json(payload);
  });

  app.post('/api/v1/horoscope', (req, res) => {
    res.json(buildHoroscope(req.body));
  });

  app.post('/api/v1/timeline', (req, res) => {
    res.json(buildTimeline(req.body ?? {}));
  });

  app.post('/api/v1/compact', (req, res) => {
    const body = req.body ?? {};
    const birth = body.birth ?? body;
    const payload = buildAstrolabe(birth);

    const year = Number.isInteger(body.year) ? body.year : new Date().getFullYear();
    let horoscope = null;
    try {
      const now = new Date();
      const targetDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      horoscope = buildHoroscope({ birth, targetDate, targetTimeIndex: 6 }).horoscope;
    } catch {
      // 运限算不出来不影响主体盘面
    }

    const compact = toCompact(payload, horoscope);
    res.json({ ok: true, year, chars: compactSize(compact), compact });
  });

  app.get('/api/v1/sihua', (req, res) => {
    const stem = req.query.stem;
    const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    if (!stem || !stems.includes(String(stem))) {
      throw new ApiError(400, 'BAD_REQUEST', `stem 必须是十天干之一：${stems.join(' ')}`);
    }
    const stars = util.getMutagensByHeavenlyStem(stem);
    res.json({
      ok: true,
      stem,
      mutagens: {
        禄: stars[0] ?? null,
        权: stars[1] ?? null,
        科: stars[2] ?? null,
        忌: stars[3] ?? null,
      },
    });
  });

  app.get('/api/v1/chart', (req, res) => {
    const payload = buildAstrolabe(coerceQuery(req.query));
    res.type('html').send(renderChartHtml(payload));
  });

  app.use((req, res, next) => next(notFound(`接口不存在：${req.method} ${req.path}`)));

  // 统一错误处理
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof ApiError) {
      res.status(err.status).json({ ok: false, code: err.code, message: err.message, details: err.details });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ ok: false, code: 'INVALID_JSON', message: '请求体不是合法 JSON' });
      return;
    }
    console.error('[unhandled]', err);
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: err?.message ?? '服务器内部错误' });
  });

  return app;
}
