/**
 * 竞品追踪存储（IndexedDB 持久化，容量大；localStorage 仅作桌面端文件化与降级回退）
 *
 * 设计（对齐 productStore）：
 *  - 对外 API 保持同步签名（listCompetitors / getCompetitor / addCompetitor / updateCompetitor / removeCompetitor）
 *  - 内部 = 内存缓存 + 启动预加载（initCompetitors）+ 异步落盘 IndexedDB（web）/ 文件化 localStorage（桌面）
 *  - 每日快照（snapshots）内嵌在每个产品对象里，导出/导入即整对象搬运，最简单
 *  - DESKTOP：window.__fs 存在时强制走 legacy（localStorage 由 preload 重定向为文件）
 *
 * 字段：
 *  product: { id, asin, url, title, image_url, type:'own'|'competitor', store, marketplace,
 *             category, notes, linked_own_id, createdAt, updatedAt, snapshots:[Snapshot] }
 *  Snapshot: { id, date:'YYYY-MM-DD', price, coupon, bsr, review_count, rating, stock_status,
 *              ship_type, stock_qty, traffic_keywords:[{kw,rank}], note, createdAt }
 */
import { STORES } from '../ui/competitorUtil.js';
import { uid } from '../utils.js';

export const COMPETITOR_KEY = 'sgn.competitor.products';

const DB_NAME = 'sgn-workbench';
const DB_VERSION = 1;
const STORE = 'competitors';
const NUMERIC = ['price', 'coupon', 'bsr', 'review_count', 'rating', 'stock_qty'];

let products = null;
let ready = false;
let useLegacy = false;
let dbPromise = null;
let initPromise = null;

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
  }));
}
function idbDelete(id) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}
function idbReplaceAll(arr) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const s = t.objectStore(STORE);
    s.clear();
    arr.forEach((p) => { if (p && p.id) s.put(p); });
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}

/* ===================== 旧数据迁移（legacy → IndexedDB） ===================== */
const LEGACY_KEY = COMPETITOR_KEY;
function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
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
  });
  try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
  return true;
}

/* ===================== 初始化（幂等） ===================== */
export function initCompetitors() {
  if (ready) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (DESKTOP) {
      products = readLegacy();
      useLegacy = true;
      ready = true;
      notifyCompetitorsChange();
      return;
    }
    try {
      let data = await idbGetAll();
      if (!data.length) {
        const migrated = await migrateLegacy();
        if (migrated) data = await idbGetAll();
      }
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
      console.warn('[competitorStore] IndexedDB 不可用，回退 localStorage：', e && e.message);
      useLegacy = true;
      if (!products) products = readLegacy();
    }
    ready = true;
    notifyCompetitorsChange();
  })();
  return initPromise;
}
function ensureLoaded() {
  if (!ready) { if (!products) products = []; initCompetitors(); }
}

/* ===================== 持久化 ===================== */
function syncAfter() {
  const snapshot = JSON.stringify(products || []);
  return initCompetitors().then(() => {
    const task = useLegacy
      ? Promise.resolve().then(() => { localStorage.setItem(LEGACY_KEY, snapshot); })
      : idbReplaceAll(products || []);
    return task.catch((err) => {
      console.error('[competitorStore] 保存失败：', err && err.message);
      try { products = JSON.parse(snapshot); } catch (_) {}
      notifyCompetitorsChange();
    });
  });
}

/* ===================== 快照工具 ===================== */
export function kwListOf(s) {
  const t = s && s.traffic_keywords;
  if (!t) return [];
  if (Array.isArray(t)) return t.map((x) => {
    if (typeof x === 'string') {
      const mm = x.match(/^(.+?)[,，=\t]\s*(\d+)\s*$/);
      if (mm) return { kw: mm[1].trim(), rank: Math.round(parseFloat(mm[2])) };
      return { kw: x.trim(), rank: null };
    }
    return { kw: String(x.kw || x.keyword || '').trim(), rank: (x.rank != null && !isNaN(parseFloat(x.rank))) ? Math.round(parseFloat(x.rank)) : null };
  }).filter((x) => x.kw);
  // 字符串：按行解析，每行支持「关键词, 排名」或纯关键词
  return String(t).split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const mm = l.match(/^(.+?)[,，=\t]\s*(\d+)\s*$/);
    if (mm) return { kw: mm[1].trim(), rank: Math.round(parseFloat(mm[2])) };
    return { kw: l, rank: null };
  });
}

function normalizeKw(input) {
  if (input == null) return [];
  return kwListOf({ traffic_keywords: input });
}

/** 只覆盖「真正填了」的字段；留空不清空 */
function pickProvidedSnapshot(existing, input) {
  const out = { ...existing };
  for (const k of NUMERIC) {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') out[k] = Number(input[k]);
  }
  ['stock_status', 'ship_type', 'note'].forEach((k) => {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') out[k] = input[k];
  });
  if (input.traffic_keywords !== undefined) out.traffic_keywords = normalizeKw(input.traffic_keywords);
  return out;
}

/* ===================== 对外同步 API ===================== */
export function normalizeCompetitor(p) {
  const out = { ...p };
  out.type = out.type === 'competitor' ? 'competitor' : 'own';
  if (!Array.isArray(out.snapshots)) out.snapshots = [];
  out.snapshots = out.snapshots.map((s) => ({
    id: s.id || uid('snap'),
    date: s.date,
    price: s.price != null ? Number(s.price) : null,
    coupon: s.coupon != null && s.coupon !== '' ? Number(s.coupon) : (s.coupon || null),
    bsr: s.bsr != null ? Number(s.bsr) : null,
    review_count: s.review_count != null ? Number(s.review_count) : null,
    rating: s.rating != null ? Number(s.rating) : null,
    stock_status: s.stock_status || '',
    ship_type: s.ship_type || '',
    stock_qty: s.stock_qty != null && s.stock_qty !== '' ? Number(s.stock_qty) : (s.stock_qty || null),
    traffic_keywords: normalizeKw(s.traffic_keywords),
    note: s.note || '',
    createdAt: s.createdAt || Date.now(),
  })).filter((s) => s.date);
  if (out.type === 'own' && out.linked_own_id != null) {
    // 归一化为字符串以保持比较稳定
  }
  out.linked_own_id = out.linked_own_id != null ? String(out.linked_own_id) : null;
  out.store = STORES.includes(out.store) ? out.store : (out.store || '');
  out.marketplace = out.marketplace || '';
  out.image_url = out.image_url || '';
  out.title = out.title || '';
  out.asin = out.asin || '';
  out.url = out.url || out.asin || '';
  out.category = out.category || '';
  out.notes = out.notes || '';
  out.createdAt = out.createdAt || Date.now();
  out.updatedAt = out.updatedAt || out.createdAt;
  return out;
}

export function listCompetitors() {
  ensureLoaded();
  return (products || []).map(normalizeCompetitor)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
export function getCompetitor(id) {
  ensureLoaded();
  const p = (products || []).find((x) => String(x.id) === String(id));
  return p ? normalizeCompetitor(p) : null;
}

/** 返回某产品的快照（按日期升序） */
export function getSnapshots(id) {
  const p = getCompetitor(id);
  return p ? p.snapshots.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) : [];
}
function rawProduct(id) {
  ensureLoaded();
  return (products || []).find((x) => String(x.id) === String(id)) || null;
}

export function addCompetitor(data) {
  ensureLoaded();
  const now = Date.now();
  const item = normalizeCompetitor({
    id: uid('cp'),
    asin: data.asin || data.url || '',
    url: data.url || data.asin || '',
    title: data.title || '',
    image_url: data.image_url || '',
    type: data.type === 'competitor' ? 'competitor' : 'own',
    store: data.store || '',
    marketplace: data.marketplace || '',
    category: data.category || '',
    notes: data.notes || '',
    linked_own_id: data.linked_own_id != null ? String(data.linked_own_id) : null,
    createdAt: now,
    updatedAt: now,
    snapshots: [],
  });
  products = products || [];
  products.push(item);
  syncAfter();
  notifyCompetitorsChange();
  return item;
}

export function updateCompetitor(id, data) {
  ensureLoaded();
  const list = products || [];
  const idx = list.findIndex((p) => String(p.id) === String(id));
  if (idx < 0) return null;
  const merged = { ...list[idx], ...data, id: list[idx].id, updatedAt: Date.now() };
  list[idx] = merged;
  syncAfter();
  notifyCompetitorsChange();
  return normalizeCompetitor(merged);
}

export function removeCompetitor(id) {
  ensureLoaded();
  const before = (products || []).length;
  products = (products || []).filter((p) => String(p.id) !== String(id));
  // 解除其它产品对该产品的关联
  products.forEach((p) => {
    if (String(p.linked_own_id) === String(id)) p.linked_own_id = null;
  });
  if (products.length !== before || true) syncAfter();
  notifyCompetitorsChange();
}

/* ===================== 快照操作 ===================== */
export function addSnapshot(productId, snap) {
  const p = rawProduct(productId);
  if (!p) return null;
  if (!Array.isArray(p.snapshots)) p.snapshots = [];
  const date = snap.date;
  const existing = p.snapshots.find((s) => s.date === date);
  const merged = pickProvidedSnapshot(existing || { date }, snap);
  merged.id = (existing && existing.id) || uid('snap');
  merged.date = date;
  merged.createdAt = (existing && existing.createdAt) || Date.now();
  if (existing) Object.assign(existing, merged);
  else p.snapshots.push(merged);
  p.updatedAt = Date.now();
  syncAfter();
  notifyCompetitorsChange();
  return merged;
}

/** 批量写入某天快照：rows=[{id,price,...}]，只覆盖已填字段 */
export function batchSnapshots({ date, rows = [] }) {
  if (!date || !rows.length) return { saved: 0, skipped: 0 };
  let saved = 0; let skipped = 0;
  rows.forEach((row) => {
    const p = rawProduct(row.id);
    if (!p) { skipped++; return; }
    const provided = Object.keys(row).some((k) => k !== 'id' && row[k] !== undefined && row[k] !== null && row[k] !== '');
    if (!provided) { skipped++; return; }
    addSnapshot(row.id, { ...row, date });
    saved++;
  });
  return { saved, skipped };
}

export function deleteSnapshot(productId, date) {
  const p = rawProduct(productId);
  if (!p || !Array.isArray(p.snapshots)) return;
  p.snapshots = p.snapshots.filter((s) => s.date !== date);
  p.updatedAt = Date.now();
  syncAfter();
  notifyCompetitorsChange();
}

export function countCompetitors() {
  ensureLoaded();
  return (products || []).length;
}

/* ===================== 变更订阅 ===================== */
const listeners = new Set();
export function onCompetitorsChange(fn) { listeners.add(fn); }
export function notifyCompetitorsChange() { listeners.forEach((fn) => fn()); }

/* ===================== 备份 / 恢复（含 IndexedDB 数据） ===================== */
export async function exportCompetitorRaw() {
  await initCompetitors();
  return (products || []).map((p) => ({ ...p }));
}
export async function importCompetitorRaw(arr) {
  if (!Array.isArray(arr)) return;
  products = arr.map((p) => normalizeCompetitor(p));
  ready = true;
  useLegacy = DESKTOP ? true : useLegacy;
  await syncAfter();
  notifyCompetitorsChange();
}
