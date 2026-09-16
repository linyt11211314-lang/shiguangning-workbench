/**
 * 竞品追踪模块 · 通用工具（拾光柠 utils 未覆盖的部分）
 */
import { esc, normalizeUrl } from '../utils.js';
import { AMAZON_SITES } from '../config.js';

export const STOCK_LABEL = { in_stock: '有货', low: '低库存', out_of_stock: '缺货' };
export const STORES = ['ZOWOO', 'Fongyoung'];

function moneySymbol(mp) {
  const s = (AMAZON_SITES || []).find((x) => x.code === mp);
  return s ? s.symbol : '$';
}

export function fmtMoney(v, mp) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return moneySymbol(mp) + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function fmtNum(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

/** 库存标签：状态 + 具体数量（两者并存） */
export function stockTag(status, qty) {
  if (status === 'in_stock' || status === 'low' || status === 'out_of_stock') {
    const base = STOCK_LABEL[status] || '';
    if (qty != null && qty !== '') return `${base} ${fmtNum(qty)} 件`;
    return base;
  }
  if (qty != null && qty !== '') return `${fmtNum(qty)} 件`;
  return '';
}

export function storeTag(store) {
  if (!store) return '';
  return `<span class="tag" style="background:#eef2ff;color:var(--primary)">${esc(store)}</span>`;
}

export function productLink(p, opts = {}) {
  const href = normalizeUrl(p.url || p.asin || '');
  if (!href) return `<span class="muted">${esc(opts.label || '链接')}</span>`;
  return `<a class="link" href="${esc(href)}" target="_blank" rel="noopener">${esc(opts.label || '打开链接')}</a>`;
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dShort(d) {
  return d ? d.slice(5) : '';
}

/** 差异箭头（通用：▲ 增 / ▼ 减） */
export function diffArrow(dv) {
  if (!dv) return '—';
  return dv > 0 ? '▲' : '▼';
}

/** 差异着色：BSR 越低越好，其余越高越好 */
export function diffClass(metric, dv) {
  if (dv === 0 || dv == null) return 'muted';
  const good = metric === 'bsr' ? dv < 0 : dv > 0;
  return good ? 'up-good' : 'down-bad';
}

/** 归一化某链接/ASIN → 亚马逊跳转地址（用于产品库/详情里的「打开链接」） */
export function toAmazonUrl(raw, marketplace) {
  const u = normalizeUrl(raw || '');
  if (u) return u;
  const asin = String(raw || '').trim();
  if (/^[A-Z0-9]{10}$/i.test(asin)) {
    const domain = (AMAZON_SITES || []).find((s) => s.code === (marketplace || 'US'));
    return `https://www.${domain ? domain.domain : 'amazon.com'}/dp/${asin}`;
  }
  return '';
}
