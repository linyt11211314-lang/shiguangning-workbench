/**
 * 利润看板存储
 * - 参数（头程费率 / 人民币汇率）→ localStorage
 * - 利润报表快照（导入解析结果，覆盖式缓存）→ localStorage
 * - 采购单价映射（SKU → CNY 单价）→ localStorage
 * - 逐 SKU 采购成本手动覆盖（覆盖采购单取值）→ localStorage
 * 说明：本模块数据不参与 JSON 备份迁移（按用户要求），换设备需重新导入表格。
 */
const PARAMS_KEY = 'sgn.profit.params';
const REPORT_KEY = 'sgn.profit.report';
const PURCHASE_KEY = 'sgn.profit.purchase';
const OVERRIDE_KEY = 'sgn.profit.costOverride';
const HEAD_OVERRIDE_KEY = 'sgn.profit.headOverride';
const SITE_FILTER_KEY = 'sgn.profit.siteFilter';
const SHIP_KEY = 'sgn.profit.shipping';

/** 默认参数：汇率采用此前人工核算口径（1 CNY = X 本地币） */
export const DEFAULT_PARAMS = {
  headRate: 0.05,    // 头程 = 销售额 × 5%
  rateAED: 0.5137,   // 1 CNY = 0.5137 AED
  rateSAR: 0.5245,   // 1 CNY = 0.5245 SAR
};

/** 站点筛选可选值 */
export const SITE_FILTERS = ['all', 'AE', 'SA'];

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ===================== 参数 ===================== */
export function getParams() {
  try {
    const p = JSON.parse(localStorage.getItem(PARAMS_KEY) || '{}');
    return {
      headRate: clampNum(p.headRate, 0, 1, DEFAULT_PARAMS.headRate),
      rateAED: clampNum(p.rateAED, 0.0001, 10, DEFAULT_PARAMS.rateAED),
      rateSAR: clampNum(p.rateSAR, 0.0001, 10, DEFAULT_PARAMS.rateSAR),
    };
  } catch (_) {
    return { ...DEFAULT_PARAMS };
  }
}

export function saveParams(partial) {
  const next = { ...getParams(), ...partial };
  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

/* ===================== 利润报表快照 ===================== */
export function getReportData() {
  try {
    const raw = JSON.parse(localStorage.getItem(REPORT_KEY) || 'null');
    if (raw && Array.isArray(raw.rows)) return raw;
  } catch (_) {}
  return null;
}

export function saveReportData(rows, meta) {
  const payload = { rows, meta: { importedAt: new Date().toISOString(), ...(meta || {}) } };
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '本地存储空间不足，利润报表数据可能过大，请精简列或行后重试' };
  }
}

/* ===================== 采购单价映射 ===================== */
export function getPurchaseData() {
  try {
    const raw = JSON.parse(localStorage.getItem(PURCHASE_KEY) || 'null');
    if (raw && raw.map && typeof raw.map === 'object') return raw;
  } catch (_) {}
  return null;
}

export function savePurchaseData(map, meta) {
  const payload = { map, meta: { importedAt: new Date().toISOString(), ...(meta || {}) } };
  try {
    localStorage.setItem(PURCHASE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '本地存储空间不足，采购单价数据可能过大，请重试' };
  }
}

/* ===================== 逐 SKU 采购成本手动覆盖 ===================== */
export function getCostOverrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}'); } catch (_) { return {}; }
}

export function saveCostOverrides(map) {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map)); } catch (_) {}
  return map;
}

/** 设置/清除单个 SKU 的采购成本覆盖（value 为空或 <=0 视为清除，回退到采购单取值） */
export function setCostOverride(msku, value) {
  const map = getCostOverrides();
  const n = Number(value);
  if (!isFinite(n) || n <= 0) delete map[msku];
  else map[msku] = n;
  saveCostOverrides(map);
  return map;
}

/* ===================== 逐 SKU 头程比例手动覆盖 ===================== */
export function getHeadOverrides() {
  try { return JSON.parse(localStorage.getItem(HEAD_OVERRIDE_KEY) || '{}'); } catch (_) { return {}; }
}

export function saveHeadOverrides(map) {
  try { localStorage.setItem(HEAD_OVERRIDE_KEY, JSON.stringify(map)); } catch (_) {}
  return map;
}

/** 设置/清除单个 SKU 的头程比例覆盖（value 为空或 <=0 视为清除，回退到全局头程率） */
export function setHeadOverride(msku, value) {
  const map = getHeadOverrides();
  const ratio = Number(value);
  if (!isFinite(ratio) || ratio <= 0) delete map[msku];
  else map[msku] = ratio; // 存储为比例（如 0.06 表示 6%）
  saveHeadOverrides(map);
  return map;
}

/* ===================== 站点筛选（影响 TOP/亏损/广告/明细） ===================== */
/** 站点筛选：'all' = 全部，'AE' = 仅 AED 站（AE 站），'SA' = 仅 SAR 站（SA 站） */
export function getSiteFilter() {
  try {
    const v = String(localStorage.getItem(SITE_FILTER_KEY) || 'all').toUpperCase();
    return SITE_FILTERS.includes(v) ? v : 'all';
  } catch (_) { return 'all'; }
}
export function setSiteFilter(value) {
  const v = String(value || 'all').toUpperCase();
  const safe = SITE_FILTERS.includes(v) ? v : 'all';
  try { localStorage.setItem(SITE_FILTER_KEY, safe); } catch (_) {}
  return safe;
}

/* ===================== 海运空运对比输入状态（刷新保留上次数据） ===================== */
/** 海运空运对比的默认值，与 shippingCompare.js 的 DEFAULTS 保持一致 */
export const DEFAULT_SHIP = {
  length: 40, width: 30, height: 20, weight: 2,
  dimFactor: 5000,
  seaMin: 21, seaRate: 12,
  airMin: 21, airRate: 38,
  purchaseCost: 0,
  mode: 'auto',
  qty: 100,
};
const SHIP_KEYS = Object.keys(DEFAULT_SHIP);

function asNumber(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

/** 读取上次保存的对比参数（与默认值合并，缺字段/非法值回退默认） */
export function getShipState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SHIP_KEY) || '{}') || {}; } catch (_) { saved = {}; }
  const out = { ...DEFAULT_SHIP };
  for (const k of SHIP_KEYS) {
    if (k === 'mode') continue; // mode 为字符串字段，单独处理
    if (k in saved) out[k] = asNumber(saved[k], DEFAULT_SHIP[k]);
  }
  if ('mode' in saved && (saved.mode === 'auto' || saved.mode === 'custom')) out.mode = saved.mode;
  if (out.mode !== 'auto' && out.mode !== 'custom') out.mode = 'auto';
  if (!isFinite(out.qty) || out.qty < 1) out.qty = DEFAULT_SHIP.qty;
  if (!isFinite(out.dimFactor) || out.dimFactor <= 0) out.dimFactor = DEFAULT_SHIP.dimFactor;
  return out;
}

/** 增量保存对比参数（与现有值合并后写入 localStorage） */
export function saveShipState(partial) {
  const next = { ...getShipState(), ...partial };
  try { localStorage.setItem(SHIP_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}
