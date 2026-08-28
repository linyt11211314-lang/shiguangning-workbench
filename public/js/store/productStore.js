/**
 * 选品库存储（IndexedDB 持久化，容量大；localStorage 仅作迁移源与降级回退）
 * 产品字段：id, image, name, category, site,
 *          supplies（1688 货源数组 [{ link, specColor }]，最多 3 条）,
 *          supply1688（兼容旧单条字符串）,
 *          quote（报价测算 { lengthCm, widthCm, heightCm, weightG, cost, exchangeRate,
 *                         targetProfitRate, adRate, referralRate, fbaFee, shippingPerUnit, result }）,
 *          description, keywords, createdAt, updatedAt
 *
 * 设计：
 *  - 对外 API 保持同步签名（listProducts/getProduct/addProduct/updateProduct/removeProduct）
 *  - 内部 = 内存缓存 + 启动预加载（initProducts）+ 异步落盘 IndexedDB
 *  - 旧 localStorage 数据（sgn.products）首次自动迁移进 IndexedDB 后删除
 *  - IndexedDB 不可用（隐私模式等）时自动回退 localStorage
 */
import { STORAGE_KEYS, CATEGORY_IDS, PRICE_TIER_IDS } from '../config.js';
import { uid } from '../utils.js';

const DB_NAME = 'sgn-workbench';
const DB_VERSION = 1;
const STORE = 'products';

let products = null;
let ready = false;
let useLegacy = false; // IndexedDB 不可用 → 回退 localStorage
let dbPromise = null;
let initPromise = null;

/**
 * 桌面版（Electron）标记：preload 注入 window.__fs 后即表示数据应落本地文件。
 * 此时强制走 legacy（localStorage 由 preload 重定向为文件），不再使用 IndexedDB。
 */
const DESKTOP = typeof window !== 'undefined' && !!window.__fs;

/* ===================== IndexedDB 基础 ===================== */

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbGetAll() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const rq = t.objectStore(STORE).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  }));
}

function idbPut(item) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function idbDelete(id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* ===================== 旧数据迁移 ===================== */

function readLegacy() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

/** 迁移 localStorage 旧数据 → IndexedDB；成功后删除 localStorage key */
async function migrateLegacy() {
  const legacy = readLegacy();
  if (!legacy.length) return false;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    legacy.forEach((p) => { if (p && p.id) s.put(p); });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  try { localStorage.removeItem(STORAGE_KEYS.PRODUCTS); } catch (_) {}
  return true;
}

/* ===================== 初始化（幂等） ===================== */

/** 启动预加载：IndexedDB → 空则迁移 localStorage → ready → notify */
export function initProducts() {
  if (ready) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // 桌面版：直接以文件化的 localStorage 作为数据源，跳过 IndexedDB
    if (DESKTOP) {
      products = readLegacy();
      useLegacy = true;
      ready = true;
      notifyProductsChange();
      return;
    }
    try {
      let data = await idbGetAll();
      if (!data.length) {
        const migrated = await migrateLegacy();
        if (migrated) data = await idbGetAll();
      }
      // 若加载期间已有抢先写入（用户极快保存），以内存为准合并 DB 数据
      const preExisting = products;
      if (preExisting && preExisting.length) {
        const map = new Map((data || []).map((p) => [p.id, p]));
        preExisting.forEach((p) => { if (p && p.id) map.set(p.id, p); });
        products = [...map.values()];
      } else {
        products = data || [];
      }
      useLegacy = false;
    } catch (e) {
      // IndexedDB 不可用 → 回退 localStorage（旧行为）
      console.warn('[productStore] IndexedDB 不可用，回退 localStorage：', e && e.message);
      useLegacy = true;
      if (!products) products = readLegacy();
    }
    ready = true;
    notifyProductsChange(); // 触发当前页重渲染（app 层 refresh）
  })();
  return initPromise;
}

function ensureLoaded() {
  if (!ready) {
    if (!products) products = [];
    initProducts(); // 触发加载；首次调用方立即拿到空缓存，就绪后 notify 重渲染
  }
}

export function isProductsReady() {
  return ready;
}

/* ===================== 持久化（异步落盘 + 失败可感知） ===================== */

function emitStoreError(msg) {
  try { window.dispatchEvent(new CustomEvent('sgn:store-error', { detail: msg })); } catch (_) {}
}

/** 内存已改 → 等 init 完成后异步落盘；失败时回滚并广播错误。返回落盘 Promise 便于备份导入等待完成。 */
function syncAfter() {
  const snapshot = JSON.stringify(products);
  return initProducts().then(() => {
    const task = useLegacy
      ? Promise.resolve().then(() => {
          localStorage.setItem(STORAGE_KEYS.PRODUCTS, snapshot);
        })
      : idbReplace();
    return task.catch((err) => {
      console.error('[productStore] 保存失败：', err && err.message);
      try { products = JSON.parse(snapshot); } catch (_) {}
      notifyProductsChange();
      emitStoreError('保存失败：浏览器本地存储异常，请刷新后重试。');
    });
  });
}

function idbReplace() {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    s.clear();
    products.forEach((p) => { if (p && p.id) s.put(p); });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/* ===================== 同步 API（对外签名不变） ===================== */

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
  // 多图片迁移：旧 image 单图 -> images 数组；保证有且仅有一个主图
  if (!Array.isArray(out.images)) {
    out.images = out.image ? [{ id: uid('img'), data: out.image, isMain: true }] : [];
  }
  if (out.images.length && !out.images.some((i) => i.isMain)) out.images[0].isMain = true;
  // 三档推荐报价字段兜底
  out.selectedPriceTier = PRICE_TIER_IDS.includes(out.selectedPriceTier) ? out.selectedPriceTier : 'aggressive';
  out.priceTiers = (out.priceTiers && typeof out.priceTiers === 'object') ? out.priceTiers : null;
  out.price = (out.price != null && out.price !== '') ? out.price : (out.quote && out.quote.result && out.quote.result.price != null ? out.quote.result.price : '');
  out.draftSaved = Boolean(out.draftSaved);
  out.localDraft = out.localDraft || null;
  out.uploaded = Boolean(out.uploaded);
  return out;
}

export function listProducts() {
  ensureLoaded();
  return (products || []).map(normalizeProduct).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProduct(id) {
  ensureLoaded();
  const p = (products || []).find((x) => x.id === id);
  return p ? normalizeProduct(p) : null;
}

export function addProduct(data) {
  ensureLoaded();
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
    images: Array.isArray(data.images) ? data.images : [],
    selectedPriceTier: PRICE_TIER_IDS.includes(data.selectedPriceTier) ? data.selectedPriceTier : 'aggressive',
    priceTiers: (data.priceTiers && typeof data.priceTiers === 'object') ? data.priceTiers : null,
    price: data.price != null ? data.price : '',
    draftSaved: Boolean(data.draftSaved),
    localDraft: data.localDraft || null,
    uploaded: Boolean(data.uploaded),
    description: data.description || '',
    keywords: data.keywords || '',
    createdAt: now,
    updatedAt: now,
  };
  products.push(item);
  syncAfter();
  return item;
}

export function updateProduct(id, data) {
  ensureLoaded();
  const list = products || [];
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...data, id, updatedAt: Date.now() };
  syncAfter();
  return list[idx];
}

export function removeProduct(id) {
  ensureLoaded();
  const before = (products || []).length;
  products = (products || []).filter((p) => p.id !== id);
  if (products.length !== before) syncAfter();
}

export function countProducts() {
  ensureLoaded();
  return (products || []).length;
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

/* ===================== 备份 / 恢复（含 IndexedDB 数据） ===================== */
/**
 * 导出当前选品库原始数组（从活跃存储读取：web 为 IndexedDB，桌面为文件化 localStorage）。
 * 含 images（base64）等全部字段，供 dataBackup 全量打包。
 */
export async function exportProductsRaw() {
  await initProducts();
  return (products || []).map((p) => ({ ...p }));
}

/**
 * 用原始数组覆盖选品库（写入活跃存储：web 写 IndexedDB，桌面写文件化 localStorage）。
 * @param {Array} arr 产品数组
 */
export async function importProductsRaw(arr) {
  if (!Array.isArray(arr)) return;
  products = arr.map((p) => normalizeProduct(p));
  ready = true;
  useLegacy = DESKTOP ? true : useLegacy;
  await syncAfter();
}
