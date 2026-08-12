/**
 * 选品库存储（localStorage 持久化）
 * 产品字段：id, image, name, category, site,
 *          supplies（1688 货源数组 [{ link, specColor }]，最多 3 条）,
 *          supply1688（兼容旧单条字符串）,
 *          quote（报价测算 { lengthCm, widthCm, heightCm, weightG, cost, exchangeRate,
 *                         targetProfitRate, adRate, referralRate, fbaFee, shippingPerUnit, result }）,
 *          description, keywords, createdAt, updatedAt
 */
import { STORAGE_KEYS, CATEGORY_IDS } from '../config.js';
import { uid } from '../utils.js';

let products = null;

function load() {
  if (products) return products;
  try {
    products = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRODUCTS)) || [];
  } catch (_) {
    products = [];
  }
  return products;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
  } catch (_) { /* 忽略 */ }
}

/** 兼容旧数据：把字符串 supply1688 转成 supplies 数组；单站点数据迁移为多站点结构（sites/quotes/quote） */
export function normalizeProduct(p) {
  const out = { ...p };
  if (!Array.isArray(out.supplies)) {
    out.supplies = out.supply1688
      ? [{ link: out.supply1688, specColor: '' }]
      : [];
  }
  // 多站点结构迁移：sites 缺失时由 quote.site / site 推导
  if (!Array.isArray(out.sites) || !out.sites.length) {
    const s = (out.quote && out.quote.site) ? out.quote.site : (out.site || 'US');
    out.sites = [s];
    out.site = s;
  }
  if (!out.quotes || typeof out.quotes !== 'object' || !Object.keys(out.quotes).length) {
    const s = out.quote && out.quote.site ? out.quote.site : out.sites[0];
    out.quotes = out.quote ? { [s]: out.quote } : {};
  }
  if (!out.quote && out.quotes && Object.keys(out.quotes).length) {
    out.quote = out.quotes[out.sites[0]] || Object.values(out.quotes)[0] || null;
  }
  out.site = out.sites[0] || out.site || 'US';
  // 选品库三大分类迁移：旧 category 字段曾是「产品类目」自由文本，现改作分类标识（niuma/zhaowu/fengyang）
  if (!CATEGORY_IDS.includes(out.category)) {
    if (!out.productCategory) out.productCategory = out.category || '';
    out.category = CATEGORY_IDS.includes(out.category) ? out.category : 'niuma';
  }
  return out;
}

export function listProducts() {
  return load().map(normalizeProduct).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProduct(id) {
  const p = load().find((x) => x.id === id);
  return p ? normalizeProduct(p) : null;
}

export function addProduct(data) {
  const now = Date.now();
  const sites = Array.isArray(data.sites) && data.sites.length ? data.sites : [data.site || 'US'];
  const mainSite = sites[0] || data.site || 'US';
  const quotes = data.quotes || (data.quote ? { [data.quote.site || mainSite]: data.quote } : {});
  const item = {
    id: uid('prod'),
    image: data.image || '',
    name: data.name || '',
    amazonUrl: data.amazonUrl || '',
    category: CATEGORY_IDS.includes(data.category) ? data.category : 'niuma',
    productCategory: data.productCategory || '',
    site: mainSite,
    sites,
    supplies: Array.isArray(data.supplies) ? data.supplies : (data.supply1688 ? [{ link: data.supply1688, specColor: '' }] : []),
    supply1688: Array.isArray(data.supplies)
      ? data.supplies.map((s) => s.link).filter(Boolean).join(' / ')
      : (data.supply1688 || ''),
    quotes,
    quote: data.quote || quotes[mainSite] || null,
    description: data.description || '',
    keywords: data.keywords || '',
    createdAt: now,
    updatedAt: now,
  };
  load().push(item);
  persist();
  return item;
}

export function updateProduct(id, data) {
  const list = load();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...data, id, updatedAt: Date.now() };
  persist();
  return list[idx];
}

export function removeProduct(id) {
  load();
  const before = products.length;
  products = products.filter((p) => p.id !== id);
  if (products.length !== before) persist();
}

export function countProducts() {
  return load().length;
}

/** 供其他模块订阅变更 */
const listeners = new Set();
export function onProductsChange(fn) { listeners.add(fn); }
export function notifyProductsChange() { listeners.forEach((fn) => fn()); }

// 包装增删改，触发通知
const _add = addProduct, _update = updateProduct, _remove = removeProduct;
export function addProductTracked(data) { const r = _add(data); notifyProductsChange(); return r; }
export function updateProductTracked(id, data) { const r = _update(id, data); if (r) notifyProductsChange(); return r; }
export function removeProductTracked(id) { _remove(id); notifyProductsChange(); }
