/**
 * 拾光柠工作台 · AI Listing工坊 — 后端服务
 *
 * 职责：
 *  - 静态托管前端页面
 *  - DeepSeek API 代理（Listing 页面 → Listing Service → AI Provider → DeepSeek API）
 *  - DeepSeek API Key 连通性测试
 *  - POST /api/listing/generate 自动生成亚马逊 Listing（独立接口，Key 读环境变量）
 *  - Amazon 竞品链接抓取（尽力而为，失败降级提示）
 */
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

/**
 * POST /api/listing/generate 使用的提示词模板（占位符：{product_name} / {material} / {key_points}）
 */
const LISTING_PROMPT_TEMPLATE = `你是一位资深的亚马逊美国站Listing优化专家。
请根据以下产品信息，生成完整的英文Listing：
- 产品名称：{product_name}
- 材质：{material}
- 核心卖点：{key_points}

要求：
1. 标题150-200字符
2. 五点描述5条，每条不超过500字符
3. 产品描述300-500字
4. 后台搜索关键词5组
5. 输出格式为JSON，包含 title, bullet_points, description, search_terms 四个字段
禁止使用绝对化用语和违规功效词。`;

/** 从 AI 返回文本中提取 JSON（容错 markdown 围栏与多余文本） */
function extractJSONObject(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch (_) {
    try {
      return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
    } catch (_) { /* 继续 */ }
  }
  throw new Error('AI 返回内容不是有效的 JSON，请重试。');
}

/** 调用 DeepSeek Chat Completions */
async function callDeepSeek(apiKey, model, messages, temperature = 0.9) {
  const res = await fetch(DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature,
      max_tokens: 4096,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || detail;
    } catch (_) { /* 保留原文 */ }
    const err = new Error(`DeepSeek API 响应异常（HTTP ${res.status}）：${detail}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek API 未返回有效内容');
  return content;
}

/** POST /api/ai/generate —— 统一 AI 生成代理 */
app.post('/api/ai/generate', async (req, res) => {
  const { apiKey, model, messages, temperature } = req.body || {};
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: '缺少 DeepSeek API Key，请先在「设置」中配置。' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: '缺少请求内容（messages）。' });
  }
  try {
    const content = await callDeepSeek(apiKey, model, messages, temperature);
    res.json({ ok: true, content });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
});

/** POST /api/ai/test —— 测试 API Key 是否真实可用 */
app.post('/api/ai/test', async (req, res) => {
  const { apiKey, model } = req.body || {};
  if (!apiKey) return res.json({ ok: false, error: '未填写 API Key' });
  try {
    const content = await callDeepSeek(apiKey, model || DEFAULT_MODEL, [
      { role: 'system', content: 'You are a connectivity test bot.' },
      { role: 'user', content: 'Reply with exactly: OK' },
    ], 0);
    res.json({ ok: true, content: String(content || '').slice(0, 60) });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/** GET /api/competitor/fetch —— 尽力抓取 Amazon 竞品页面 */
app.get('/api/competitor/fetch', async (req, res) => {
  const url = String(req.query.url || '').trim();
  const amazonRe = /^https?:\/\/([\w-]+\.)?amazon\.(com|co\.uk|de|ca|com\.mx|com\.au|co\.jp|in|ae|nl|se|pl|sg|com\.br|tr|sa|eg|fr|it|es)\//i;
  if (!amazonRe.test(url)) {
    return res.json({ ok: false, error: '仅支持 Amazon 商品链接（amazon.com / co.uk / de / ae 等）。' });
  }
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/Amazon\.com.*$/i, '').trim() : '';
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 200) throw new Error('页面内容过少，可能被反爬拦截');
    res.json({ ok: true, title, snippet: text.slice(0, 3500) });
  } catch (e) {
    res.json({
      ok: false,
      error: `竞品页面抓取失败：${e.message}。可改为在「竞品信息」中直接粘贴竞品标题 / 五点描述文本。`,
    });
  }
});

/** GET 访问时给出友好提示（避免浏览器直接打开显示裸 404） */
app.get('/api/listing/generate', (_req, res) => {
  res.json({
    code: 1,
    message: '该接口仅支持 POST 请求。请在浏览器打开 /api-tester.html 使用测试台，或用 curl / Apifox 发送 POST 请求（请求体含 product_name / material / key_points）。',
    data: null,
  });
});

/**
 * POST /api/listing/generate —— 自动生成亚马逊 Listing（独立接口）
 *
 * 请求体：{ product_name, material, key_points }
 *   - product_name: 产品名称（必填）
 *   - material:     材质（必填）
 *   - key_points:   核心卖点，逗号分隔（必填）
 *
 * DeepSeek API Key 从环境变量 DEEPSEEK_API_KEY 读取（不硬编码）。
 * 返回：{ code: 0, data: { title, bullet_points, description, search_terms }, message: "success" }
 */
app.post('/api/listing/generate', async (req, res) => {
  const { product_name, material, key_points } = req.body || {};

  // 参数校验
  const missing = [];
  if (!product_name || !String(product_name).trim()) missing.push('product_name（产品名称）');
  if (!material || !String(material).trim()) missing.push('material（材质）');
  if (!key_points || !String(key_points).trim()) missing.push('key_points（核心卖点，逗号分隔）');
  if (missing.length) {
    return res.json({ code: 1, message: `缺少必填参数：${missing.join('、')}`, data: null });
  }

  // 读取环境变量中的 API Key
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.json({ code: 1, message: '未配置环境变量 DEEPSEEK_API_KEY，请先设置后重启服务。', data: null });
  }

  // 按模板拼接提示词
  const prompt = LISTING_PROMPT_TEMPLATE
    .replace('{product_name}', String(product_name).trim())
    .replace('{material}', String(material).trim())
    .replace('{key_points}', String(key_points).trim());

  try {
    const raw = await callDeepSeek(apiKey, DEFAULT_MODEL, [
      { role: 'system', content: 'You are a senior Amazon US listing optimization expert. Always reply with valid JSON only.' },
      { role: 'user', content: prompt },
    ], 0.7);

    const parsed = extractJSONObject(raw);
    const data = {
      title: String(parsed.title || '').trim(),
      bullet_points: Array.isArray(parsed.bullet_points)
        ? parsed.bullet_points.map((b) => String(b).trim()).filter(Boolean).slice(0, 5)
        : [],
      description: String(parsed.description || '').trim(),
      search_terms: Array.isArray(parsed.search_terms)
        ? parsed.search_terms.map((s) => String(s).trim()).filter(Boolean)
        : [],
    };
    res.json({ code: 0, data, message: 'success' });
  } catch (e) {
    res.json({ code: 1, message: `AI 生成失败：${e.message}`, data: null });
  }
});

/** GET /api/health —— 健康检查 */
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'shiguangning-workbench' }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 被 Electron 主进程 require 复用时只导出 app，不在此处监听；
// 仅在直接 `node server.js` 时才真正监听端口（Render 部署走这条路径）。
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`🍋 拾光柠工作台已启动: http://${HOST}:${PORT}`);
  });
}

module.exports = app;
