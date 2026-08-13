/**
 * 广告诊断 · 数据存储（localStorage）
 * - records: 解析后的广告数据明细，按 站点+日期 去重（后者覆盖前者）
 * - imports: 导入批次记录（用于历史回看与按批次清除）
 */
import { STORAGE_KEYS } from '../config.js';

const KEY = STORAGE_KEYS.ADS;
const SCHEMA = { records: [], imports: [] };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { records: [], imports: [] };
    const data = JSON.parse(raw);
    return { records: data.records || [], imports: data.imports || [] };
  } catch (_) {
    return { records: [], imports: [] };
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    throw new Error('本地存储空间不足，请清理旧数据后重试');
  }
}

/** 读取全部明细 */
export function listRecords() {
  return load().records;
}

/** 读取导入批次 */
export function listImports() {
  return load().imports;
}

/**
 * 批量写入明细（按 站点+日期 去重）
 * @param {Array} newRecords 待写入明细（已含 importId）
 * @param {Object} meta 批次元信息 { site, period, fileName, importId }
 * @returns {{added:number, updated:number, total:number}}
 */
export function upsertRecords(newRecords, meta) {
  const data = load();
  const map = new Map(data.records.map((r) => [`${r.site}|${r.date}`, r]));
  let added = 0;
  let updated = 0;
  for (const nr of newRecords) {
    const k = `${nr.site}|${nr.date}`;
    if (map.has(k)) updated += 1;
    else added += 1;
    map.set(k, nr);
  }
  data.records = Array.from(map.values());

  const importRec = {
    id: meta.importId,
    site: meta.site,
    period: meta.period,
    fileName: meta.fileName,
    count: newRecords.length,
    at: Date.now(),
  };
  data.imports.unshift(importRec);
  if (data.imports.length > 30) data.imports = data.imports.slice(0, 30);

  save(data);
  return { added, updated, total: data.records.length };
}

/** 清空全部广告数据 */
export function clearAll() {
  save({ records: [], imports: [] });
}

/** 删除某个导入批次（仅移除该批次写入且未被后续批次覆盖的明细） */
export function removeImport(importId) {
  const data = load();
  data.records = data.records.filter((r) => r.importId !== importId);
  data.imports = data.imports.filter((i) => i.id !== importId);
  save(data);
}

/** 订阅变化（供其它模块联动，可选） */
const listeners = new Set();
export function onAdsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  listeners.forEach((cb) => cb());
}
export function _emitChange() {
  emit();
}
