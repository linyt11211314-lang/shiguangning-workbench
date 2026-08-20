/**
 * 库存预警页
 * 基于用户导入的领星库存表格自动扫描库存，结合运输时间（国内采购+国际物流）生成补货建议。
 * - 产品信息只展示表格里的 SKU + 品名（不读选品库图片）
 * - 预计可售天数 = FBA-可售 ÷ 日均销量；日均销量 = 近30天销量 ÷ 30
 * - 风险分级：🔴 预计可售天数 ≤ 运输+安全；🟡 ≤ 运输+安全×2；🟢 其余
 * - 建议补货量 = 日均销量 × (运输+安全) × 系数 − 在途（至少覆盖运输期消耗）
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import {
  getParams, saveParams, getOps, markPoGenerated, markRestocked, clearOps,
  getStockData, saveStockData,
} from '../store/stockAlertStore.js';
import { autoMap, buildRows, MAX_UPLOAD_MB, ACCEPT } from '../services/dataImport.js';

/* ===================== 工具 ===================== */
function num(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,%¥$￥\s]/g, ''));
  return isFinite(n) ? n : 0;
}
function round2(v) {
  return Math.round(v * 100) / 100;
}
function fmtInt(v) {
  return (Number(v) || 0).toLocaleString('zh-CN');
}
function addDaysStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDays(d) {
  if (d === Infinity) return '充足';
  if (d === null || d === undefined || !isFinite(d)) return '—';
  const n = Math.ceil(d);
  return n <= 0 ? '0' : String(n);
}
function shortDate(iso) {
  if (!iso) return '—';
  const parts = String(iso).split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : iso;
}
function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ===================== 计算引擎 ===================== */
export function buildAlerts(data, params, ops) {
  const T = params.transitDays;
  const S = params.safetyDays;
  const M = params.multiplier;
  const list = [];
  for (const r of (data && data.rows ? data.rows : [])) {
    const sku = String(r.sku || '').trim();
    if (!sku) continue;
    const sales30 = num(r.sales30);
    const daily = sales30 / 30;
    const fbaStock = num(r.fbaStock);
    const fbaInTransit = num(r.fbaInTransit);
    const cost = num(r.cost);
    const name = String(r.name || '').trim() || sku;

    // 预计可售天数
    let daysOfStock;
    if (fbaStock <= 0) daysOfStock = 0;
    else if (daily <= 0) daysOfStock = Infinity; // 无销量 → 视为充足
    else daysOfStock = fbaStock / daily;

    // 风险等级
    let risk, status;
    if (daysOfStock === Infinity) { risk = 'ok'; status = '库存充足'; }
    else if (daysOfStock <= T + S) { risk = 'critical'; status = '需立即补货'; }
    else if (daysOfStock <= T + S * 2) { risk = 'warning'; status = '即将断货'; }
    else { risk = 'ok'; status = '库存充足'; }

    const outOfStockDate = daysOfStock === Infinity ? null : addDaysStr(Math.ceil(daysOfStock));
    const arrivalDate = addDaysStr(T);

    // 断货风险文案
    let riskMessage;
    if (daysOfStock === Infinity) riskMessage = '✅ 当前无销量或库存充足，暂无断货风险';
    else if (daysOfStock <= 0) riskMessage = `⚠️ 已断货！运输需要 ${T} 天，请立即补货！`;
    else if (daysOfStock < T) riskMessage = `⚠️ 运输需要 ${T} 天，当前库存将在 ${Math.ceil(daysOfStock)} 天后耗尽，到货前会断货！`;
    else if (daysOfStock < T + S) riskMessage = `⚠️ 库存即将低于安全线（${S} 天），建议立即补货`;
    else riskMessage = `✅ 当前库存可支撑到货（运输 ${T} 天），建议安排补货`;

    // 建议补货量（红/黄才计算）
    let suggested = 0;
    let suggestedNote = '';
    if (risk !== 'ok') {
      const target = daily * (T + S) * M;
      suggested = Math.max(Math.ceil(target - fbaInTransit), Math.ceil(daily * T));
      if (suggested < 0) suggested = 0;
      suggested = Math.round(suggested);
      if (suggested <= 0) {
        suggested = 0;
        suggestedNote = '在途/现有库存已可覆盖目标，暂无需补货';
      }
    }

    const op = ops[sku] || {};
    list.push({
      sku, name, fbaStock, fbaInTransit, sales30,
      dailySales: daily, daysOfStock, outOfStockDate, arrivalDate,
      risk, status, riskMessage, suggested, suggestedNote, cost, op,
    });
  }
  // 排序：critical 前、warning 后；组内按预计可售天数升序（越紧急越靠前）
  const rank = { critical: 0, warning: 1, ok: 2 };
  list.sort((a, b) => (rank[a.risk] - rank[b.risk]) || (a.daysOfStock - b.daysOfStock));
  return list;
}

/* ===================== 表格解析 ===================== */
const TPL = ['MSKU', '品名', 'FBA-可售', 'FBA-在途', '30天销量', '采购成本'];

async function parseStockFile(file) {
  if (typeof XLSX === 'undefined') throw new Error('Excel 组件未加载，请刷新页面重试');
  if (!/\.(xlsx|xls|csv)$/i.test(file.name || '')) throw new Error('仅支持 .xlsx / .xls / .csv 格式');
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`文件超过 ${MAX_UPLOAD_MB}MB`);

  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let wb;
  try {
    if (ext === 'csv') {
      // 兼容 UTF-8 与 GBK 编码
      let txt = new TextDecoder('utf-8').decode(buf);
      if (txt.includes('\uFFFD')) {
        try { txt = new TextDecoder('gb18030').decode(buf); } catch (_) {}
      }
      wb = XLSX.read(txt, { type: 'string', raw: false });
    } else {
      wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    }
  } catch (_) {
    throw new Error('文件解析失败，可能不是有效的 Excel/CSV 文件');
  }

  // 挑含 SKU 列的 Sheet
  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;
    const hdr = (aoa[0] || []).map((v) => String(v ?? '').trim());
    const { map, skuCol } = autoMap(TPL, hdr);
    if (skuCol < 0) continue;
    const objRows = buildRows(TPL, aoa.slice(1), map);
    const rows = objRows
      .map((o) => ({
        sku: String(o.MSKU || '').trim(),
        name: String(o['品名'] || '').trim(),
        fbaStock: num(o['FBA-可售']),
        fbaInTransit: num(o['FBA-在途']),
        sales30: num(o['30天销量']),
        cost: num(o['采购成本']),
      }))
      .filter((r) => r.sku);
    return { fileName: file.name, sheetName: sn, rows };
  }
  return null;
}

/* ===================== 渲染 ===================== */
export function render(container, ctx) {
  const params = getParams();
  const ops = getOps();
  const data = getStockData();
  const alerts = buildAlerts(data, params, ops);
  const pending = alerts.filter((a) => a.risk !== 'ok' && !a.op.restockedAt);
  const processedCount = alerts.filter((a) => a.risk !== 'ok' && a.op.restockedAt).length;

  const cnt = { critical: 0, warning: 0, ok: 0 };
  for (const a of alerts) cnt[a.risk]++;

  const totalSuggested = pending.reduce((s, a) => s + a.suggested, 0);
  const totalCost = pending.reduce((s, a) => s + a.suggested * a.cost, 0);
  const criticalCount = pending.filter((a) => a.risk === 'critical').length;
  const hasCost = pending.some((a) => a.cost > 0);

  container.innerHTML = `
  <div class="sa-wrap">
    <input type="file" id="saFile" accept="${ACCEPT}" hidden>

    <div class="sa-toolbar">
      <div class="sa-toolbar-info">
        ${data
          ? `最后更新：${esc(fmtTime(data.meta.importedAt))} ｜ 数据来源：${esc(data.meta.fileName || '领星数据源')} ｜ ${data.rows.length} 个 SKU`
          : '尚未导入数据表格，请先「导入表格」'}
      </div>
      <div class="sa-toolbar-actions">
        <button class="btn btn-primary btn-sm" id="saImportBtn">${icon('upload')} 导入表格</button>
        ${data ? `<button class="btn btn-soft btn-sm" id="saRefreshBtn">${icon('refresh')} 刷新</button>` : ''}
      </div>
    </div>

    <div class="sa-cards">
      <div class="sa-card sa-card-red">
        <div class="sa-card-ico">${icon('alert')}</div>
        <div class="sa-card-num">${cnt.critical}</div>
        <div class="sa-card-label">需立即补货</div>
      </div>
      <div class="sa-card sa-card-yellow">
        <div class="sa-card-ico">${icon('clock')}</div>
        <div class="sa-card-num">${cnt.warning}</div>
        <div class="sa-card-label">即将断货</div>
      </div>
      <div class="sa-card sa-card-green">
        <div class="sa-card-ico">${icon('checkCircle')}</div>
        <div class="sa-card-num">${cnt.ok}</div>
        <div class="sa-card-label">库存充足</div>
      </div>
    </div>

    <div class="sa-section">
      <div class="sa-section-head">
        <span>📋 补货建议清单（按断货紧急程度排序）</span>
        ${processedCount > 0 ? `<button class="btn btn-ghost btn-sm" id="saShowDone">已处理 ${processedCount} 条 · 清除记录</button>` : ''}
      </div>
      ${pending.length
        ? pending.map(alertCard).join('')
        : `<div class="sa-empty">
             <div class="sa-empty-ico">${icon(data ? 'checkCircle' : 'upload')}</div>
             <div>${data ? '所有在售产品库存充足，暂无补货建议' : '导入库存表格后，这里将按紧急程度列出补货建议'}</div>
           </div>`}
    </div>

    <div class="sa-section">
      <div class="sa-section-head">
        <span>📊 补货计划汇总</span>
        <button class="btn btn-soft btn-sm" id="saExportBtn">${icon('download')} 导出补货清单 (Excel)</button>
      </div>
      <div class="sa-summary">
        <div class="sa-summary-item"><b>${pending.length}</b><span>建议补货 SKU</span></div>
        <div class="sa-summary-item"><b>${fmtInt(totalSuggested)}</b><span>建议补货总量（件）</span></div>
        <div class="sa-summary-item"><b>${hasCost ? '¥' + fmtInt(totalCost) : '—'}</b><span>${hasCost ? '预估采购金额' : '预估金额（表格需含成本列）'}</span></div>
        <div class="sa-summary-item"><b>${criticalCount}</b><span>紧急补货 SKU</span></div>
      </div>
    </div>

    <div class="sa-section">
      <div class="sa-section-head">
        <span>⚙️ 参数设置</span>
        <button class="btn btn-primary btn-sm" id="saSaveParams">保存参数</button>
      </div>
      <div class="sa-params">
        <label>安全库存天数 <input type="number" id="saSafety" value="${params.safetyDays}" min="1" max="365"></label>
        <label>运输时间（采购+物流）<input type="number" id="saTransit" value="${params.transitDays}" min="1" max="365"></label>
        <label>补货增量系数 <input type="number" id="saMultiplier" value="${params.multiplier}" min="0.5" max="5" step="0.1"></label>
      </div>
      <div class="sa-tip">建议补货量 = 日均销量 × (运输时间 + 安全库存天数) × 增量系数 − 在途库存（至少覆盖运输期消耗）</div>
    </div>
  </div>`;

  bindEvents(container, ctx, pending, params);
}

function alertCard(a) {
  const badge = a.risk === 'critical'
    ? '<span class="sa-badge sa-badge-red">🔴 需立即补货</span>'
    : '<span class="sa-badge sa-badge-yellow">🟡 即将断货</span>';
  const poDone = a.op.poAt;
  return `
  <div class="sa-alert ${a.risk === 'critical' ? 'sa-alert-red' : 'sa-alert-yellow'}">
    <div class="sa-alert-head">
      ${badge}
      <b class="sa-alert-sku">${esc(a.sku)}</b>
      <span class="sa-alert-name">${esc(a.name)}</span>
    </div>
    <div class="sa-alert-meta">
      可售 <b>${fmtInt(a.fbaStock)}</b> ｜ 在途 <b>${fmtInt(a.fbaInTransit)}</b> ｜ 日销 <b>${round2(a.dailySales)}</b>
      ｜ 预计可售 <b>${fmtDays(a.daysOfStock)} 天</b> ｜ 预计断货 <b>${shortDate(a.outOfStockDate)}</b>
    </div>
    <div class="sa-alert-risk">${esc(a.riskMessage)}</div>
    <div class="sa-alert-suggest">
      ${a.suggested > 0
        ? `补货建议：<b>${fmtInt(a.suggested)} 件</b> ｜ 预计到仓 ${shortDate(a.arrivalDate)}`
        : (a.suggestedNote || '补货建议：暂无需补货')}
    </div>
    <div class="sa-alert-actions">
      ${poDone
        ? `<span class="sa-done">${icon('check')} 已生成采购单 ${esc(shortTime(a.op.poAt))}</span>`
        : `<button class="btn btn-sm btn-primary" data-po="${esc(a.sku)}">${icon('file')} 生成采购单</button>`}
      <button class="btn btn-sm btn-ghost" data-restock="${esc(a.sku)}">🔔 已补货</button>
    </div>
  </div>`;
}

function bindEvents(container, ctx, pending, params) {
  container.querySelector('#saImportBtn')?.addEventListener('click', () => {
    container.querySelector('#saFile')?.click();
  });

  container.querySelector('#saFile')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = await parseStockFile(f);
      if (!parsed) throw new Error('未能识别表格：请确认表头包含 SKU 列（如 MSKU / SKU）');
      if (!parsed.rows.length) throw new Error('表格中没有有效数据行（缺少 SKU 或全为空）');
      const res = saveStockData(parsed.rows, { fileName: parsed.fileName, sheetName: parsed.sheetName, rowCount: parsed.rows.length });
      if (!res.ok) { toastError(res.error); return; }
      toastSuccess(`已导入 ${parsed.rows.length} 个 SKU 库存数据`);
      ctx.rerender();
    } catch (err) {
      toastError(err.message || '导入失败');
    }
  });

  container.querySelector('#saRefreshBtn')?.addEventListener('click', () => {
    toastInfo('已重新计算补货建议');
    ctx.rerender();
  });

  container.querySelectorAll('[data-po]').forEach((el) => {
    el.addEventListener('click', () => {
      const sku = el.dataset.po;
      confirmDialog({
        title: '生成采购单',
        message: `确认已为 ${sku} 生成采购单？生成后将记录时间。`,
        confirmText: '已生成',
        onConfirm: () => {
          markPoGenerated(sku);
          toastSuccess('已记录采购单');
          ctx.rerender();
        },
      });
    });
  });

  container.querySelectorAll('[data-restock]').forEach((el) => {
    el.addEventListener('click', () => {
      const sku = el.dataset.restock;
      confirmDialog({
        title: '确认补货',
        message: `确认 ${sku} 已补货？确认后该条将从清单移出。`,
        confirmText: '已补货',
        onConfirm: () => {
          markRestocked(sku);
          toastSuccess('已标记补货完成');
          ctx.rerender();
        },
      });
    });
  });

  container.querySelector('#saShowDone')?.addEventListener('click', () => {
    confirmDialog({
      title: '清除处理记录',
      message: '将清除所有「已补货 / 已生成采购单」记录，对应产品会重新出现在清单中。此操作不可撤销。',
      danger: true,
      confirmText: '清除',
      onConfirm: () => {
        clearOps();
        toastSuccess('已清除处理记录');
        ctx.rerender();
      },
    });
  });

  container.querySelector('#saSaveParams')?.addEventListener('click', () => {
    const val = (id) => container.querySelector(id)?.value;
    saveParams({
      safetyDays: Number(val('#saSafety')),
      transitDays: Number(val('#saTransit')),
      multiplier: Number(val('#saMultiplier')),
    });
    toastSuccess('参数已保存，补货清单已重新计算');
    ctx.rerender();
  });

  container.querySelector('#saExportBtn')?.addEventListener('click', () => {
    exportExcel(pending, params);
  });
}

/* ===================== 导出 Excel ===================== */
function exportExcel(pending) {
  if (!pending.length) { toastInfo('当前没有待处理补货清单，无需导出'); return; }
  if (typeof XLSX === 'undefined') { toastError('Excel 组件未加载，请刷新页面重试'); return; }
  const head = ['SKU', '品名', 'FBA-可售', 'FBA-在途', '近30天销量', '日均销量', '预计可售天数', '预计断货日期', '风险等级', '断货风险提示', '建议补货量', '预计到仓日期', '采购成本', '预估采购金额'];
  const aoa = [head];
  for (const a of pending) {
    aoa.push([
      a.sku, a.name, a.fbaStock, a.fbaInTransit, a.sales30,
      round2(a.dailySales), fmtDays(a.daysOfStock), a.outOfStockDate || '—',
      a.status, a.riskMessage, a.suggested, a.arrivalDate,
      a.cost, a.suggested * a.cost,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 15 }, { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 9 },
    { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 42 }, { wch: 11 }, { wch: 12 },
    { wch: 9 }, { wch: 13 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '补货计划');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  XLSX.writeFile(wb, `补货计划_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.xlsx`);
  toastSuccess(`已导出补货清单（${pending.length} 个 SKU）`);
}
