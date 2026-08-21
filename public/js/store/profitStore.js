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

/** 默认参数：汇率采用此前人工核算口径（1 CNY = X 本地币） */
export const DEFAULT_PARAMS = {
  headRate: 0.05,    // 头程 = 销售额 × 5%
  rateAED: 0.5137,   // 1 CNY = 0.5137 AED
  rateSAR: 0.5245,   // 1 CNY = 0.5245 SAR
};

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
