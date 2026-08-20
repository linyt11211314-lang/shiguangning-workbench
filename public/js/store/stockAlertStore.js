/**
 * 库存预警存储
 * - 参数（安全库存天数 / 运输时间 / 补货增量系数）→ localStorage
 * - 操作状态（已生成采购单 / 已补货，按 SKU 记录）→ localStorage
 * - 库存数据快照（导入表格解析结果，覆盖式缓存）→ localStorage
 * 说明：本模块数据不参与 JSON 备份迁移（按用户要求），换设备需重新导入表格。
 */
const PARAMS_KEY = 'sgn.stockalert.params';
const OPS_KEY = 'sgn.stockalert.ops';
const DATA_KEY = 'sgn.stockalert.data';

export const DEFAULT_PARAMS = { safetyDays: 14, transitDays: 21, multiplier: 1.5 };

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
      safetyDays: clampNum(p.safetyDays, 1, 365, DEFAULT_PARAMS.safetyDays),
      transitDays: clampNum(p.transitDays, 1, 365, DEFAULT_PARAMS.transitDays),
      multiplier: clampNum(p.multiplier, 0.5, 5, DEFAULT_PARAMS.multiplier),
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

/* ===================== 操作状态（按 SKU） ===================== */
export function getOps() {
  try { return JSON.parse(localStorage.getItem(OPS_KEY) || '{}'); } catch (_) { return {}; }
}

function saveOps(ops) {
  try { localStorage.setItem(OPS_KEY, JSON.stringify(ops)); } catch (_) {}
}

export function markPoGenerated(sku) {
  const ops = getOps();
  ops[sku] = ops[sku] || {};
  ops[sku].poAt = new Date().toISOString();
  saveOps(ops);
}

export function markRestocked(sku) {
  const ops = getOps();
  ops[sku] = ops[sku] || {};
  ops[sku].restockedAt = new Date().toISOString();
  saveOps(ops);
}

export function clearOps() {
  try { localStorage.removeItem(OPS_KEY); } catch (_) {}
}

/* ===================== 库存数据快照 ===================== */
export function getStockData() {
  try {
    const raw = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
    if (raw && Array.isArray(raw.rows)) return raw;
  } catch (_) {}
  return null;
}

export function saveStockData(rows, meta) {
  const payload = { rows, meta: { importedAt: new Date().toISOString(), ...(meta || {}) } };
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (_) {
    return { ok: false, error: '本地存储空间不足，表格数据可能过大，请精简列或行后重试' };
  }
}
