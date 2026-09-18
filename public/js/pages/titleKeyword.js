/**
 * 标题主词解析（顶栏全局快捷工具）
 *
 * 功能：粘贴亚马逊标题 → 识别「核心产品词」（主关键词）。
 * 策略：优先 AI（DeepSeek，复用 aiProvider，与 AI Listing 工坊同源）；
 *       未配置 Key / AI 不可用时自动回退前端规则提取，保证离线可用。
 * 入口：顶栏「标题主词」按钮（通过 MutationObserver 在每次顶栏重渲染后自动注入，零侵入）。
 * 说明：纯工具、无持久化，不涉及数据备份。
 */
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { chatWithRetry } from '../services/aiProvider.js';

const LAUNCHER_ID = 'tkLauncher';
let toolModal = null;

/** 页面初始化：注入顶栏按钮并监听顶栏重渲染 */
export function initTitleKeywordTool() {
  injectLauncher();
  const topbar = document.getElementById('topbar');
  if (topbar) {
    const obs = new MutationObserver(() => injectLauncher());
    obs.observe(topbar, { childList: true, subtree: true });
  }
}

/** 把「标题主词」按钮注入当前顶栏的 topbar-actions（若已存在则跳过） */
function injectLauncher() {
  const topbar = document.getElementById('topbar');
  if (!topbar) return;
  const actions = topbar.querySelector('.topbar-actions');
  if (!actions || actions.querySelector('#' + LAUNCHER_ID)) return;
  const btn = document.createElement('button');
  btn.id = LAUNCHER_ID;
  btn.className = 'btn btn-ghost btn-sm';
  btn.innerHTML = `${icon('search')} 标题主词`;
  btn.title = '粘贴亚马逊标题，一键解析主关键词';
  btn.addEventListener('click', openTool);
  actions.appendChild(btn);
}

/** 打开解析浮层 */
function openTool() {
  if (toolModal) toolModal.close(); // 触发 onClose → 置空

  const body = document.createElement('div');
  body.innerHTML = `
    <div style="font-size:13px;color:var(--text-sub);margin-bottom:10px;line-height:1.6">
      粘贴亚马逊标题，自动识别 <b>核心产品词</b>（主关键词）。优先 AI 解析，未配置 Key 时自动用规则兜底。
    </div>
    <textarea id="tkInput" class="textarea" style="width:100%;min-height:96px" placeholder="例如：Wireless Earbuds Bluetooth 5.3 Noise Cancelling Headphones with Charging Case"></textarea>
    <div id="tkResult" style="margin-top:14px;display:none">
      <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">主关键词</div>
      <div id="tkKeyword" style="font-size:18px;font-weight:700;color:var(--text);word-break:break-word"></div>
      <div id="tkSource" style="font-size:12px;color:var(--text-faint);margin-top:6px"></div>
    </div>
  `;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px;width:100%';
  const parseBtn = document.createElement('button');
  parseBtn.className = 'btn btn-primary';
  parseBtn.style.flex = '1';
  parseBtn.textContent = '解析主关键词';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-ghost';
  copyBtn.textContent = '复制';
  copyBtn.disabled = true;
  footer.appendChild(parseBtn);
  footer.appendChild(copyBtn);

  const m = openModal({
    title: '标题主词解析',
    body,
    footer,
    width: 'narrow',
    onClose: () => { toolModal = null; },
  });
  toolModal = m;

  const input = body.querySelector('#tkInput');
  const resultBox = body.querySelector('#tkResult');
  const keywordEl = body.querySelector('#tkKeyword');
  const sourceEl = body.querySelector('#tkSource');

  parseBtn.addEventListener('click', async () => {
    const title = input.value.trim();
    if (!title) { toast('请先粘贴亚马逊标题', 'error'); return; }
    parseBtn.disabled = true;
    parseBtn.textContent = '解析中…';
    try {
      const { keyword, source } = await extractMainKeyword(title);
      keywordEl.textContent = keyword;
      sourceEl.textContent = source === 'ai'
        ? '来源：AI（DeepSeek）'
        : '来源：规则兜底（未配置 Key 或 AI 不可用）';
      resultBox.style.display = 'block';
      copyBtn.disabled = false;
      copyBtn._kw = keyword;
    } catch (e) {
      toast(e && e.message ? e.message : '解析失败', 'error');
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = '解析主关键词';
    }
  });

  // Ctrl/Cmd + Enter 快捷解析
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') parseBtn.click();
  });

  copyBtn.addEventListener('click', () => {
    const kw = copyBtn._kw;
    if (!kw) return;
    copyText(kw).then((ok) => {
      toast(ok ? `已复制：${kw}` : '复制失败，请手动选择', ok ? 'success' : 'error');
    });
  });

  setTimeout(() => input.focus(), 50);
}

/**
 * 提取主关键词：AI 优先，失败回退规则。
 * @returns {Promise<{keyword:string, source:'ai'|'rule'}>}
 */
async function extractMainKeyword(title) {
  // 1) AI 优先
  try {
    const content = await chatWithRetry([
      {
        role: 'system',
        content:
          'You are an Amazon SEO expert. Given an Amazon product title, identify the SINGLE core product keyword (the main product noun phrase, typically at the front of the title, e.g. "Wireless Earbuds" from "Wireless Earbuds Bluetooth 5.3 Noise Cancelling Headphones"). Respond with ONLY that keyword phrase: no explanation, no punctuation, no quotes, no extra words.',
      },
      { role: 'user', content: title },
    ], { model: 'deepseek-chat', temperature: 0.2 });

    const kw = (content || '')
      .trim()
      .replace(/^["'“”'']+|["'“”'']+$/g, '')
      .replace(/[.。,，;；:：!！?？]+$/g, '')
      .trim();
    if (kw) return { keyword: kw, source: 'ai' };
  } catch (_) {
    // 落到规则兜底
  }
  // 2) 规则兜底
  return { keyword: ruleBasedMainKeyword(title), source: 'rule' };
}

/**
 * 前端规则兜底：取标题最前面的连续「内容词」作为核心产品词，
 * 遇到数字规格（如 5.3 / 2024 / 100ml）或连接停用词即停止。
 */
function ruleBasedMainKeyword(title) {
  const rawTokens = title.split(/[\s,;|–—\-()[\]{}'"]+/).filter(Boolean);
  const STOP = new Set([
    'for', 'with', 'and', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'by',
    'new', 'premium', 'high', 'quality', 'best', 'top', 'upgraded', 'improved',
    'professional', 'portable', 'universal', 'official',
  ]);

  const picked = [];
  for (const t of rawTokens) {
    const w = t.replace(/[^A-Za-z0-9一-龥]/g, '');
    if (!w) continue;
    const lower = w.toLowerCase();
    if (/^\d/.test(w)) break; // 数字开头（年份/版本/容量）→ 停止
    if (/\d/.test(w) && /(%|x|ml|gb|ah|w|v|cm|mm|oz|lbs?|kg|inch|pack)/.test(lower)) break; // 带数字的规格
    if (STOP.has(lower)) {
      if (picked.length) break; // 已取得内容词则停止；否则跳过开头冠词
      else continue;
    }
    picked.push(w);
    if (picked.length >= 3) break; // 最多取前 3 个内容词
  }

  if (!picked.length) {
    const alt = rawTokens.slice(0, 2)
      .map((t) => t.replace(/[^A-Za-z0-9一-龥]/g, ''))
      .filter(Boolean);
    return alt.join(' ') || title.slice(0, 40);
  }
  return picked.join(' ');
}

/** 复制文本（优先 Clipboard API，失败回退 execCommand） */
function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
  } catch (_) {}
  return new Promise((resolve) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    resolve(ok);
  });
}
