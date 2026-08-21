/**
 * 利润看板页
 * - 导入「领星利润报表（MSKU 汇总）」+「采购单（SKU→采购单价）」
 * - 可手动修改成本：全局头程费率 / 汇率，以及逐 SKU 采购单价（覆盖采购单取值）
 * - 展示 KPI、盈利 TOP10、亏损预警、广告效率、分站点汇总、全量明细
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import {
  getParams, saveParams,
  getReportData, saveReportData,
  getPurchaseData, savePurchaseData,
  getCostOverrides, setCostOverride,
} from '../store/profitStore.js';
import { parseProfitFile, parsePurchaseFile, computeProfit } from '../services/profitCalc.js';

const LOSS_DISPLAY = 25; // 亏损预警默认展示条数

/* ===================== 格式化 ===================== */
function fmtCNY(v, dec = 0) {
  const n = Number(v || 0);
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtMoney(v, cur, dec = 0) {
  const n = Number(v || 0);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' ' + (cur || '');
}
function fmtPct(v) {
  const n = Number(v || 0) * 100;
  return n.toFixed(1) + '%';
}
function fmtInt(v) {
  return (Number(v) || 0).toLocaleString('zh-CN');
}
function shortTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ===================== 渲染 ===================== */
export function render(container, ctx) {
  const params = getParams();
  const report = getReportData();
  const purchase = getPurchaseData();
  const overrides = getCostOverrides();

  const hasReport = !!(report && report.rows && report.rows.length);
  const result = hasReport ? computeProfit(report.rows, purchase ? purchase.map : {}, overrides, params) : null;

  container.innerHTML = `
  <div class="pf-wrap">
    <input type="file" id="pfReportFile" accept=".xlsx,.xls,.csv" hidden>
    <input type="file" id="pfPurchaseFile" accept=".xlsx,.xls,.csv" hidden>

    <div class="sa-toolbar">
      <div class="sa-toolbar-info">
        ${hasReport
          ? `利润报表：<b>${esc(report.meta?.fileName || '利润报表')}</b> · 导入于 ${esc(shortTime(report.meta?.importedAt))} · ${report.rows.length} 条分组记录`
          : '尚未导入领星利润报表（MSKU 汇总）'}
        ${purchase ? ` ｜ 采购单：<b>${esc(purchase.meta?.fileName || '采购单')}</b> · ${Object.keys(purchase.map).length} 个 SKU` : ' ｜ <span style="color:var(--text-faint)">未导入采购单（采购单价按 0 计）</span>'}
      </div>
      <div class="sa-toolbar-actions">
        <button class="btn btn-primary btn-sm" id="pfImportReport">${icon('upload')} 导入利润报表</button>
        <button class="btn btn-soft btn-sm" id="pfImportPurchase">${icon('upload')} 导入采购单</button>
      </div>
    </div>

    ${!hasReport ? `
      <div class="sa-empty">
        <div class="sa-empty-ico">${icon('chart')}</div>
        <div>请先「导入利润报表」开始分析；若需补扣采购成本，再导入「采购单」。</div>
      </div>
    ` : `
      ${renderParams(params)}
      ${renderKPI(result.kpi)}
      ${renderTopProfit(result.topProfit)}
      ${renderLoss(result.loss)}
      ${renderAd(result.adTop)}
      ${renderSite(result.siteStats)}
      ${renderDetail(result.rows, overrides, purchase ? purchase.map : {})}
    `}
  </div>`;

  bindEvents(container, ctx);
}

/* ===================== 参数卡（可手动改成本） ===================== */
function renderParams(p) {
  return `
  <div class="sa-section sa-section-params">
    <div class="sa-section-head">
      <span>⚙️ 成本参数 <span class="sa-section-sub">真实利润 = 毛利润 − 领星采购 − 销量×采购单价(换算) − 销售额×头程率；改完点「保存并重算」</span></span>
      <button class="btn btn-primary btn-sm" id="pfSaveParams">保存并重算</button>
    </div>
    <div class="sa-params">
      <label>头程费率 (%) <input type="number" id="pfHead" value="${(p.headRate * 100).toFixed(2)}" min="0" max="50" step="0.1"></label>
      <label>汇率 1 CNY = AED <input type="number" id="pfRateAED" value="${p.rateAED}" min="0.0001" max="10" step="0.0001"></label>
      <label>汇率 1 CNY = SAR <input type="number" id="pfRateSAR" value="${p.rateSAR}" min="0.0001" max="10" step="0.0001"></label>
    </div>
  </div>`;
}

/* ===================== KPI ===================== */
function renderKPI(k) {
  const cls = (v) => (v < 0 ? 'pf-neg' : 'pf-pos');
  return `
  <div class="pf-kpis">
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtCNY(k.totSaleCny)}</div><div class="pf-kpi-label">总销售额 (CNY)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtInt(k.totQty)}</div><div class="pf-kpi-label">总销量 (件)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtCNY(k.totGrossCny)}</div><div class="pf-kpi-label">领星毛利润 (CNY)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num ${cls(k.totRealCny)}">${fmtCNY(k.totRealCny)}</div><div class="pf-kpi-label">真实利润 (CNY)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num ${cls(k.overallMargin)}">${fmtPct(k.overallMargin)}</div><div class="pf-kpi-label">整体真实毛利率</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtPct(k.overallAcos)}</div><div class="pf-kpi-label">整体广告 ACOS</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num pf-pos">${k.profitN}</div><div class="pf-kpi-label">盈利 SKU</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num pf-neg">${k.lossN}</div><div class="pf-kpi-label">亏损 SKU（${k.lossWithSale} 有销量 / ${k.lossZeroSale} 零销量）</div></div>
  </div>
  <div class="pf-note">采购价覆盖 ${k.matchedPu} 个 SKU；${k.zeroSaleN} 个零销量 SKU（多为广告/费用净亏）。修改下方「采购单价」或上方参数后实时重算。</div>`;
}

/* ===================== 盈利 TOP10 ===================== */
function renderTopProfit(rows) {
  if (!rows.length) return '';
  const body = rows.map((r, i) => `
    <tr>
      <td class="pf-rank">${i + 1}</td>
      <td class="pf-ms">${esc(r.ms)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtInt(r.qty)}</td>
      <td class="pf-num">${fmtMoney(r.sale, r.cur)}</td>
      <td class="pf-num">${fmtMoney(r.realProfit, r.cur)}</td>
      <td class="pf-num pf-pos">${fmtCNY(r.realCny)}</td>
      <td class="pf-num pf-pos">${fmtPct(r.realMargin)}</td>
    </tr>`).join('');
  return section('🏆 盈利 TOP10（按真实利润 CNY）', `
    <table class="pf-table">
      <thead><tr><th>#</th><th>MSKU</th><th>品名</th><th>站点</th><th>销量</th><th>销售额</th><th>真实利润(本币)</th><th>真实利润(CNY)</th><th>毛利率</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`);
}

/* ===================== 亏损预警 ===================== */
function renderLoss(rows) {
  if (!rows.length) return section('✅ 亏损预警', `<div class="pf-note pf-pos">当前无亏损 SKU。</div>`);
  const disp = rows.slice(0, LOSS_DISPLAY);
  const body = disp.map((r) => {
    const cause = [];
    if (r.qty === 0) cause.push('零销量·费用净亏');
    if (r.qty > 0 && r.puCny > 0 && r.qty * r.puCny * (r.cur === 'SAR' ? 1 / getParams().rateSAR : 1 / getParams().rateAED) > r.gross) cause.push('采购成本>毛利润');
    if (r.ad > r.sale * 0.3 && r.sale > 0) cause.push('广告占比高');
    if (r.gross < 0 && r.qty > 0) cause.push('毛利本身为负');
    return `
    <tr>
      <td class="pf-ms">${esc(r.ms)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${r.qty > 0 ? fmtInt(r.qty) : '0'}</td>
      <td class="pf-num">${fmtMoney(r.sale, r.cur)}</td>
      <td class="pf-num">${fmtMoney(r.gross, r.cur)}</td>
      <td class="pf-num pf-neg">${fmtMoney(r.realProfit, r.cur)}</td>
      <td class="pf-num pf-neg">${fmtCNY(r.realCny)}</td>
      <td class="pf-num pf-neg">${fmtPct(r.realMargin)}</td>
      <td class="pf-cause">${cause.join('; ') || '低销量'}</td>
    </tr>`;
  }).join('');
  return section(`⚠️ 亏损预警（共 ${rows.length} 个，展示前 ${disp.length}）`,
    `<table class="pf-table">
      <thead><tr><th>MSKU</th><th>品名</th><th>站点</th><th>销量</th><th>销售额</th><th>毛利润(本币)</th><th>真实利润(本币)</th><th>真实利润(CNY)</th><th>毛利率</th><th>主因</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${rows.length > LOSS_DISPLAY ? `<div class="pf-note">其余 ${rows.length - LOSS_DISPLAY} 个亏损 SKU（多为零销量小额费用净亏）见下方全量明细。</div>` : ''}`);
}

/* ===================== 广告效率 ===================== */
function renderAd(rows) {
  if (!rows.length) return '';
  const body = rows.map((r) => {
    const acos = r.sale > 0 ? r.ad / r.sale : 0;
    return `
    <tr>
      <td class="pf-ms">${esc(r.ms)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtMoney(r.sale, r.cur)}</td>
      <td class="pf-num">${fmtMoney(r.ad, r.cur)}</td>
      <td class="pf-num">${fmtPct(acos)}</td>
      <td class="pf-num">${fmtCNY(r.realCny)}</td>
    </tr>`;
  }).join('');
  return section('📣 广告效率 TOP10（按本币广告费）', `
    <table class="pf-table">
      <thead><tr><th>MSKU</th><th>品名</th><th>站点</th><th>销售额</th><th>广告费</th><th>ACOS</th><th>真实利润(CNY)</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`);
}

/* ===================== 分站点 ===================== */
function renderSite(siteStats) {
  const row = (s) => `
    <tr>
      <td><b>${s.cur}</b> 站</td>
      <td class="pf-num">${s.n}</td>
      <td class="pf-num">${fmtCNY(s.sale)}</td>
      <td class="pf-num">${fmtCNY(s.gross)}</td>
      <td class="pf-num ${s.real < 0 ? 'pf-neg' : 'pf-pos'}">${fmtCNY(s.real)}</td>
      <td class="pf-num ${s.margin < 0 ? 'pf-neg' : 'pf-pos'}">${fmtPct(s.margin)}</td>
      <td class="pf-num">${fmtCNY(s.ad)}</td>
      <td class="pf-num">${fmtPct(s.acos)}</td>
    </tr>`;
  return section('🌍 按站点汇总（AE / SA）', `
    <table class="pf-table">
      <thead><tr><th>站点</th><th>SKU数</th><th>销售额(CNY)</th><th>毛利润(CNY)</th><th>真实利润(CNY)</th><th>真实毛利率</th><th>广告费(CNY)</th><th>ACOS</th></tr></thead>
      <tbody>${row(siteStats.AE)}${row(siteStats.SA)}</tbody>
    </table>`);
}

/* ===================== 全量明细（采购单价可编辑） ===================== */
function renderDetail(rows, overrides, purchaseMap) {
  const body = [...rows]
    .sort((a, b) => b.realCny - a.realCny)
    .map((r) => {
      const eff = r.puCny; // 已是覆盖/采购单/0 之后的有效值
      const fromOverride = overrides[r.ms] != null;
      return `
      <tr>
        <td class="pf-ms">${esc(r.ms)}</td>
        <td>${esc(r.name)}</td>
        <td>${r.site}</td>
        <td class="pf-num">${fmtInt(r.qty)}</td>
        <td class="pf-num">${fmtMoney(r.sale, r.cur)}</td>
        <td class="pf-num">${fmtMoney(r.gross, r.cur)}</td>
        <td class="pf-cost-cell">
          <input type="number" class="pf-cost-input" data-ms="${esc(r.ms)}" value="${eff}" min="0" step="0.01" title="${fromOverride ? '已手动覆盖' : (purchaseMap[r.ms] != null ? '来自采购单' : '无采购价，按0计')}">
        </td>
        <td class="pf-num">${fmtMoney(r.head, r.cur)}</td>
        <td class="pf-num ${r.realProfit < 0 ? 'pf-neg' : 'pf-pos'}">${fmtMoney(r.realProfit, r.cur)}</td>
        <td class="pf-num ${r.realCny < 0 ? 'pf-neg' : 'pf-pos'}">${fmtCNY(r.realCny)}</td>
        <td class="pf-num ${r.realMargin < 0 ? 'pf-neg' : 'pf-pos'}">${fmtPct(r.realMargin)}</td>
      </tr>`;
    }).join('');
  return section('📋 全量明细（采购单价可手动修改，回车/失焦后重算）', `
    <div class="table-scroll">
      <table class="pf-table pf-detail">
        <thead><tr><th>MSKU</th><th>品名</th><th>站点</th><th>销量</th><th>销售额</th><th>毛利润(本币)</th><th>采购单价(CNY)</th><th>头程(本币)</th><th>真实利润(本币)</th><th>真实利润(CNY)</th><th>毛利率</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`);
}

function section(title, inner) {
  return `<div class="sa-section"><div class="sa-section-head"><span>${title}</span></div>${inner}</div>`;
}

/* ===================== 事件 ===================== */
function bindEvents(container, ctx) {
  container.querySelector('#pfImportReport')?.addEventListener('click', () => container.querySelector('#pfReportFile')?.click());
  container.querySelector('#pfImportPurchase')?.addEventListener('click', () => container.querySelector('#pfPurchaseFile')?.click());

  container.querySelector('#pfReportFile')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = await parseProfitFile(f);
      const res = saveReportData(parsed.rows, { fileName: parsed.fileName, sheetName: parsed.sheetName });
      if (!res.ok) { toastError(res.error); return; }
      toastSuccess(`已导入利润报表 ${parsed.rows.length} 条记录`);
      ctx.rerender();
    } catch (err) {
      toastError(err.message || '利润报表解析失败');
    }
  });

  container.querySelector('#pfPurchaseFile')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = await parsePurchaseFile(f);
      const res = savePurchaseData(parsed.map, { fileName: parsed.fileName, sheetName: parsed.sheetName });
      if (!res.ok) { toastError(res.error); return; }
      toastSuccess(`已导入采购单 ${Object.keys(parsed.map).length} 个 SKU 的采购单价`);
      ctx.rerender();
    } catch (err) {
      toastError(err.message || '采购单解析失败');
    }
  });

  container.querySelector('#pfSaveParams')?.addEventListener('click', () => {
    const head = Number(container.querySelector('#pfHead')?.value) / 100;
    const aed = Number(container.querySelector('#pfRateAED')?.value);
    const sar = Number(container.querySelector('#pfRateSAR')?.value);
    if (!isFinite(head) || head < 0 || head > 0.5) { toastError('头程费率不合法（0%~50%）'); return; }
    if (!isFinite(aed) || aed <= 0 || !isFinite(sar) || sar <= 0) { toastError('汇率不合法'); return; }
    saveParams({ headRate: head, rateAED: aed, rateSAR: sar });
    toastSuccess('成本参数已保存，已重新计算');
    ctx.rerender();
  });

  // 采购单价手动修改：覆盖采购单取值，失焦/回车后重算
  container.querySelectorAll('.pf-cost-input').forEach((inp) => {
    const commit = () => {
      const ms = inp.dataset.ms;
      setCostOverride(ms, inp.value);
      toastInfo(`已更新 ${ms} 采购单价，重算中…`);
      ctx.rerender();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
}
