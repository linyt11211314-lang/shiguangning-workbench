/**
 * 数据备份 / 恢复（本地 localStorage 全量导出为 JSON）
 * 覆盖工作台的全部本地数据：设置 / 选品库 / Listing 项目 / 统计 / 利润看板 / FBA / 以及
 * 未来所有以 sgn. 前缀存储的板块数据（自动发现，无需逐个登记）。
 * 用于换设备迁移、定期备份。导入为「覆盖式」，导入前请先导出当前数据作为保险。
 */
import { STORAGE_KEYS } from '../config.js';

/** 已知板块的展示名（仅用于说明与展示；未知 sgn.* 键也会被自动纳入备份） */
const NAMED_KEYS = [
  { key: STORAGE_KEYS.SETTINGS, name: '设置 / API 配置' },
  { key: STORAGE_KEYS.PRODUCTS, name: '选品库' },
  { key: STORAGE_KEYS.PROJECTS, name: 'Listing 项目' },
  { key: STORAGE_KEYS.STATS, name: '统计' },
  { key: 'sgn.profit.params', name: '利润看板参数' },
  { key: 'sgn.profit.report', name: '利润报表缓存' },
  { key: 'sgn.profit.purchase', name: '采购单缓存' },
  { key: 'sgn.profit.costOverride', name: '利润成本覆盖' },
  { key: 'sgn.profit.headOverride', name: '利润头程覆盖' },
  { key: 'sgn.profit.siteFilter', name: '利润站点筛选' },
  { key: 'sgn.profit.shipping', name: '海运空运对比数据' },
  { key: 'sgn.fba.calc', name: 'FBA 当前表单' },
  { key: 'sgn.fba.records', name: 'FBA 已保存 SKU' },
];

/** 不随备份迁移的瞬态/运行时键（仅 UI 记忆，无需跨设备） */
const SKIP_KEYS = new Set([
  STORAGE_KEYS.PRODUCTS, // 选品库走 IndexedDB/文件 专用通道
  'sgn.route',           // 上次停留页面记忆
]);

/** 解析一条 localStorage 原始值（JSON 优先，失败原样保留） */
function parseRaw(raw) {
  try { return JSON.parse(raw); }
  catch (_) { return raw; }
}

/** 汇总当前全部本地数据（解析为对象）
 * 机制：已知命名键按顺序先收，随后自动遍历 localStorage 全部以 sgn. 开头的键，
 * 凡不在 SKIP_KEYS 且尚未收集的一律纳入 → 未来新增板块自动获得备份/恢复能力。
 */
export async function collectBackup() {
  const data = {};
  // 1) 已知命名键（有展示名，顺序稳定）
  for (const { key } of NAMED_KEYS) {
    if (key === STORAGE_KEYS.PRODUCTS) continue; // 选品库单独处理（可能存 IndexedDB）
    const raw = localStorage.getItem(key);
    if (raw != null) data[key] = parseRaw(raw);
  }
  // 2) 自动发现：其余所有 sgn.* 键（未来新增板块默认纳入）
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('sgn.') || key in data || SKIP_KEYS.has(key)) continue;
    const raw = localStorage.getItem(key);
    if (raw != null) data[key] = parseRaw(raw);
  }
  // 选品库：经由 productStore 从活跃存储（IndexedDB/web 或文件/localStorage 桌面）读取，含图片
  try {
    const { exportProductsRaw } = await import('../store/productStore.js');
    const prods = await exportProductsRaw();
    if (prods && prods.length) data[STORAGE_KEYS.PRODUCTS] = prods;
  } catch (_) { /* 忽略选品库导出异常 */ }
  return {
    app: '拾光柠工作台',
    version: 3,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** 触发浏览器下载备份 JSON 文件 */
export async function downloadBackup() {
  const backup = await collectBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  a.href = url;
  a.download = `shiguangning-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 读取并解析备份文件，返回标准化对象
 * { settings, products, listingProjects, stats, profit, fba }（缺失项为 null / {}）
 * profit / fba 为原始键值映射（key → 已解析对象），写回时原样 JSON 序列化。
 */
export async function parseBackupFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (_) { throw new Error('文件不是有效的 JSON'); }

  // 兼容两种格式：带 data 包裹 / 直接顶层键
  const rawData = parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
    ? parsed.data
    : (parsed && typeof parsed === 'object' ? parsed : null);
  if (!rawData) throw new Error('备份文件结构不正确');

  const out = {
    settings: rawData[STORAGE_KEYS.SETTINGS] ?? null,
    products: rawData[STORAGE_KEYS.PRODUCTS] ?? null,
    listingProjects: rawData[STORAGE_KEYS.PROJECTS] ?? null,
    stats: rawData[STORAGE_KEYS.STATS] ?? null,
    profit: {},
    fba: {},
    extra: {}, // 其余 sgn.* 键（未来新增板块自动落入此处，导入时原样写回）
  };
  // 键归类：利润看板 / FBA / 其它 sgn.*
  Object.entries(rawData).forEach(([key, val]) => {
    if (val == null || !key.startsWith('sgn.')) return;
    if (key === STORAGE_KEYS.SETTINGS || key === STORAGE_KEYS.PROJECTS || key === STORAGE_KEYS.STATS) return; // 已显式读取
    if (key.startsWith('sgn.profit.')) out.profit[key] = val;
    else if (key.startsWith('sgn.fba.')) out.fba[key] = val;
    else out.extra[key] = val;
  });

  const hasData = Object.values({ settings: out.settings, products: out.products, listingProjects: out.listingProjects, stats: out.stats }).some((v) => v != null)
    || Object.keys(out.profit).length > 0 || Object.keys(out.fba).length > 0 || Object.keys(out.extra).length > 0;
  if (!hasData) throw new Error('备份文件中未识别到任何工作台数据');
  return out;
}

/** 汇总备份内容（用于确认弹窗） */
export function summarizeBackup(obj) {
  const count = (v) => {
    if (v == null) return 0;
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'object') return Object.keys(v).length;
    return 1;
  };
  const reportRows = (obj.profit && obj.profit['sgn.profit.report'] && Array.isArray(obj.profit['sgn.profit.report'].rows))
    ? obj.profit['sgn.profit.report'].rows.length : 0;
  const purchaseSkus = (obj.profit && obj.profit['sgn.profit.purchase'] && obj.profit['sgn.profit.purchase'].map
    && typeof obj.profit['sgn.profit.purchase'].map === 'object')
    ? Object.keys(obj.profit['sgn.profit.purchase'].map).length : 0;
  const hasOverrides = !!(obj.profit
    && (count(obj.profit['sgn.profit.costOverride']) > 0 || count(obj.profit['sgn.profit.headOverride']) > 0));
  const fbaRecords = (obj.fba && Array.isArray(obj.fba['sgn.fba.records'])) ? obj.fba['sgn.fba.records'].length : 0;
  return {
    settings: obj.settings != null,
    products: count(obj.products),
    projects: count(obj.listingProjects),
    stats: obj.stats != null,
    hasProfit: Object.keys(obj.profit || {}).length > 0,
    reportRows,
    purchaseSkus,
    hasOverrides,
    hasFba: Object.keys(obj.fba || {}).length > 0,
    fbaRecords,
    extraCount: Object.keys(obj.extra || {}).length,
    hasApiKey: !!(obj.settings && obj.settings.apiKey),
  };
}

/** 应用备份：覆盖对应键（缺失项跳过）
 * 选品库单独经 productStore 写回活跃存储（IndexedDB/web 或文件/localStorage 桌面），含图片。
 * 利润看板 / FBA / 其它 sgn.* 键直接写回 localStorage（与导出同键同构，向后兼容旧备份）。
 */
export async function applyBackup(obj) {
  const map = {
    [STORAGE_KEYS.SETTINGS]: obj.settings,
    [STORAGE_KEYS.PROJECTS]: obj.listingProjects,
    [STORAGE_KEYS.STATS]: obj.stats,
  };
  Object.entries(map).forEach(([key, val]) => {
    if (val == null) return;
    const toWrite = typeof val === 'string' ? val : JSON.stringify(val);
    try { localStorage.setItem(key, toWrite); } catch (_) { /* 忽略写入失败 */ }
  });
  // 利润看板 + FBA + 其它 sgn.*：原键写回（未来新增板块自动恢复）
  const extra = { ...(obj.profit || {}), ...(obj.fba || {}), ...(obj.extra || {}) };
  Object.entries(extra).forEach(([key, val]) => {
    if (val == null || !key.startsWith('sgn.') || SKIP_KEYS.has(key)) return;
    const toWrite = typeof val === 'string' ? val : JSON.stringify(val);
    try { localStorage.setItem(key, toWrite); } catch (_) { /* 忽略写入失败 */ }
  });
  // 选品库：写回活跃存储（web=IndexedDB，桌面=文件化 localStorage），确保图片随数据迁移
  if (obj.products != null) {
    try {
      const { importProductsRaw } = await import('../store/productStore.js');
      await importProductsRaw(obj.products);
    } catch (e) {
      console.error('[dataBackup] 选品库导入失败：', e && e.message);
    }
  }
}
