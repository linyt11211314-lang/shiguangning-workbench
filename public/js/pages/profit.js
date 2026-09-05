/**
 * 利润看板页
 * - 导入「领星利润报表（MSKU 汇总）」+「采购单（SKU→采购单价）」
 * - 可手动修改成本：全局头程费率 / 汇率，逐 SKU 采购单价、逐 SKU 头程比例
 * 布局顺序：成本参数 → KPI → 分站点 → 盈利 TOP10 → 亏损预警(有销量) → 广告效率 → 全量明细(底表)
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
  getHeadOverrides, setHeadOverride,
  getSiteFilter, setSiteFilter,
  getShipState, saveShipState,
} from '../store/profitStore.js';
import { parseProfitFile, parsePurchaseFile, computeProfit } from '../services/profitCalc.js';
import { renderShippingCompare, bindShipping } from '../components/shippingCompare.js';
import { render as renderFba } from './fba.js';

const LOSS_DISPLAY = 25; // 亏损预警默认展示条数
let detailShowAll = false; // 全量明细是否展开零销量 SKU

// 利润看板次导航：analysis = 利润分析；shipping = 海运空运对比；fba = FBA 利润计算
let profitSubTab = 'analysis';
// 海运空运对比输入状态：刷新后保留上次使用的数据（来自 localStorage，与默认值合并）
let shipState = getShipState();

/* ===================== 排序（点击表头切换） ===================== */
// 每张表独立的排序状态；模块级保留，rerender 不丢
const sortStates = {}; // tableKey -> { key, dir }
const DEFAULT_SORT = {
  top:    { key: 'realCny',    dir: 'desc' },
  loss:   { key: 'realCny',    dir: 'asc'  }, // 亏损预警：亏损最深排最前
  ad:     { key: 'adCny',      dir: 'desc' },
  detail: { key: 'realCny',    dir: 'desc' },
};
const STR_KEYS = ['ms', 'name', 'site'];

function getSortVal(r, key) {
  if (key === 'acos') return r.saleCny > 0 ? r.adCny / r.saleCny : 0;
  if (STR_KEYS.includes(key)) return String(r[key] || '');
  return Number(r[key]) || 0;
}
function applySort(rows, tableKey) {
  const st = sortStates[tableKey] || DEFAULT_SORT[tableKey];
  if (!st) return rows;
  const isStr = STR_KEYS.includes(st.key);
  return [...rows].sort((a, b) => {
    const va = getSortVal(a, st.key);
    const vb = getSortVal(b, st.key);
    let cmp = isStr ? String(va).localeCompare(String(vb), 'zh-CN') : (Number(va) - Number(vb));
    if (cmp === 0) cmp = String(a.ms || '').localeCompare(String(b.ms || ''), 'zh-CN');
    return st.dir === 'asc' ? cmp : -cmp;
  });
}
function sortableTh(tableKey, key, label) {
  const st = sortStates[tableKey] || DEFAULT_SORT[tableKey];
  const active = st && st.key === key;
  const arrow = active ? (st.dir === 'asc' ? '↑' : '↓') : '↕';
  const cls = active ? `pf-sortable pf-sort-active pf-sort-${st.dir}` : 'pf-sortable';
  return `<th class="${cls}" data-table="${tableKey}" data-sort="${key}" title="点击切换排序">${label}<span class="pf-sort-arrow">${arrow}</span></th>`;
}
function nameSpan(r) {
  return `<span class="pf-name-inner" title="${esc(r.name)}">${esc(r.name)}</span>`;
}

/* ===================== 格式化 ===================== */
function fmtCNY(v, dec = 0) {
  const n = Number(v || 0);
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(v) {
  return (Number(v || 0) * 100).toFixed(1) + '%';
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
  const headOverrides = getHeadOverrides();
  const siteFilter = getSiteFilter(); // 'all' | 'AE' | 'SA'

  const hasReport = !!(report && report.rows && report.rows.length);
  const result = hasReport
    ? computeProfit(report.rows, purchase ? purchase.map : {}, overrides, headOverrides, params)
    : null;

  // 站点筛选只作用于 SKU 维度的表（TOP/亏损/广告/明细）；KPI 与分站点汇总保持全量
  const filterRows = (rows) => (siteFilter === 'all' ? rows : rows.filter((r) => r.site === siteFilter));
  const viewTop = result ? filterRows(result.topProfit) : [];
  const viewLoss = result ? filterRows(result.loss) : [];
  const viewAd = result ? filterRows(result.adTop) : [];
  const viewRows = result ? filterRows(result.rows) : [];

  container.innerHTML = `
  <div class="pf-wrap">
    ${subNav()}
    ${profitSubTab === 'shipping'
      ? renderShippingCompare(shipState)
      : profitSubTab === 'fba'
        ? '<div id="fbaHost"></div>'
        : renderAnalysisBody({ params, report, purchase, overrides, headOverrides, siteFilter, result, hasReport, viewTop, viewLoss, viewAd, viewRows })}
  </div>`;

  bindEvents(container, ctx);
}

/* ===================== 次导航栏 ===================== */
function subNav() {
  const tab = (id, label) => `<button class="pf-subnav-tab ${profitSubTab === id ? 'active' : ''}" data-sub="${id}">${label}</button>`;
  return `
  <div class="pf-subnav">
    ${tab('analysis', '📊 利润分析')}
    ${tab('shipping', '🚢 海运空运对比')}
    ${tab('fba', '🧮 FBA利润计算')}
  </div>`;
}

/* ===================== 利润分析主体（原「利润看板」全部内容） ===================== */
function renderAnalysisBody(o) {
  const { params, report, purchase, overrides, headOverrides, siteFilter, result, hasReport, viewTop, viewLoss, viewAd, viewRows } = o;
  return `
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
      ${renderParams(params, siteFilter)}
      ${renderKPI(result.kpi)}
      ${renderSite(result.siteStats)}
      ${renderTopProfit(viewTop)}
      ${renderLoss(viewLoss)}
      ${renderAd(viewAd)}
      ${renderDetail(viewRows, overrides, headOverrides, purchase ? purchase.map : {})}
    `}`;
}

/* ===================== 参数卡（可手动改成本） ===================== */
function renderParams(p, siteFilter) {
  const opts = [
    { v: 'all', label: '全部站点' },
    { v: 'AE',  label: 'AE 站（AED）' },
    { v: 'SA',  label: 'SA 站（SAR）' },
  ];
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
      <label>站点筛选
        <select id="pfSiteFilter" class="listing-select pf-filter-select" title="只影响 TOP10 / 亏损 / 广告 / 明细；KPI 与分站点保持全量">
          ${opts.map((o) => `<option value="${o.v}"${siteFilter === o.v ? ' selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </label>
    </div>
  </div>`;
}

/* ===================== KPI（卡片式） ===================== */
function renderKPI(k) {
  const cls = (v) => (v < 0 ? 'pf-neg' : 'pf-pos');
  return `
  <div class="pf-kpis">
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtCNY(k.totSaleCny)}</div><div class="pf-kpi-label">总销售额 (CNY)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num ${cls(k.totRealCny)}">${fmtCNY(k.totRealCny)}</div><div class="pf-kpi-label">真实利润 (CNY)</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num ${cls(k.overallMargin)}">${fmtPct(k.overallMargin)}</div><div class="pf-kpi-label">整体真实毛利率</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num">${fmtPct(k.overallAcos)}</div><div class="pf-kpi-label">整体广告 ACOS</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num pf-pos">${k.profitN}</div><div class="pf-kpi-label">盈利 SKU</div></div>
    <div class="pf-kpi"><div class="pf-kpi-num pf-neg">${k.lossN}</div><div class="pf-kpi-label">亏损 SKU（${k.lossWithSale} 有销量 / ${k.lossZeroSale} 零销量）</div></div>
  </div>
  <div class="pf-note">采购价覆盖 ${k.matchedPu} 个 SKU；${k.zeroSaleN} 个零销量 SKU（多为广告/费用净亏，已在亏损预警中过滤）。修改明细表「调整后采购单价 / 头程比例」或上方参数后实时重算。</div>`;
}

/* ===================== 盈利 TOP10 ===================== */
function renderTopProfit(rows) {
  if (!rows.length) return '';
  const sorted = applySort(rows, 'top');
  const body = sorted.map((r, i) => `
    <tr>
      <td class="pf-rank">${i + 1}</td>
      <td class="pf-ms">${esc(r.ms)}</td>
      <td class="pf-name">${nameSpan(r)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtInt(r.qty)}</td>
      <td class="pf-num">${fmtCNY(r.saleCny)}</td>
      <td class="pf-num">${fmtCNY(r.grossCny)}</td>
      <td class="pf-num pf-pos">${fmtCNY(r.realCny)}</td>
      <td class="pf-num pf-pos">${fmtPct(r.realMargin)}</td>
    </tr>`).join('');
  return section('🏆 盈利 TOP10', `
    <div class="table-scroll">
      <table class="pf-table" data-table="top">
        <thead><tr>
          <th>#</th>
          ${sortableTh('top', 'ms', 'MSKU')}
          ${sortableTh('top', 'name', '品名')}
          ${sortableTh('top', 'site', '站点')}
          ${sortableTh('top', 'qty', '销量')}
          ${sortableTh('top', 'saleCny', '销售额(CNY)')}
          ${sortableTh('top', 'grossCny', '毛利润(CNY)')}
          ${sortableTh('top', 'realCny', '调整后真实利润(CNY)')}
          ${sortableTh('top', 'realMargin', '毛利率')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`);
}

/* ===================== 亏损预警（仅销量>0） ===================== */
function renderLoss(rows) {
  const withSale = rows.filter((r) => r.qty > 0);
  if (!withSale.length) {
    const empty = getSiteFilter() === 'all'
      ? '当前有销量的 SKU 全部盈利（零销量纯费用亏损已过滤）。'
      : `当前站点下有销量的 SKU 全部盈利。`;
    return section('✅ 亏损预警（有销量）', `<div class="pf-note pf-pos">${empty}</div>`);
  }
  const sorted = applySort(withSale, 'loss');
  const disp = sorted.slice(0, LOSS_DISPLAY);
  const body = disp.map((r) => {
    const cause = [];
    if (r.hasPuOverride || (r.matchedPuCny > 0 && r.qty * r.matchedPuCny * (r.cur === 'SAR' ? 1 / getParams().rateSAR : 1 / getParams().rateAED) > r.gross)) cause.push('采购成本>毛利润');
    if (r.ad > r.sale * 0.3 && r.sale > 0) cause.push('广告占比高');
    if (r.gross < 0) cause.push('毛利本身为负');
    return `
    <tr class="pf-row-neg">
      <td class="pf-ms">${esc(r.ms)}</td>
      <td class="pf-name">${nameSpan(r)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtInt(r.qty)}</td>
      <td class="pf-num">${fmtCNY(r.saleCny)}</td>
      <td class="pf-num">${fmtCNY(r.grossCny)}</td>
      <td class="pf-num pf-neg">${fmtCNY(r.realCny)}</td>
      <td class="pf-num pf-neg">${fmtPct(r.realMargin)}</td>
      <td class="pf-cause">${cause.join('; ') || '低销量'}</td>
    </tr>`;
  }).join('');
  const st = sortStates.loss || DEFAULT_SORT.loss;
  const sortHint = `（点击表头切换排序：当前 <b>${sortKeyLabel(st.key)}</b> ${st.dir === 'asc' ? '升' : '降'}序）`;
  return section(`⚠️ 亏损预警（有销量 ${withSale.length} 个，展示前 ${disp.length}）${sortHint}`,
    `<div class="table-scroll">
      <table class="pf-table" data-table="loss">
        <thead><tr>
          ${sortableTh('loss', 'ms', 'MSKU')}
          ${sortableTh('loss', 'name', '品名')}
          ${sortableTh('loss', 'site', '站点')}
          ${sortableTh('loss', 'qty', '销量')}
          ${sortableTh('loss', 'saleCny', '销售额(CNY)')}
          ${sortableTh('loss', 'grossCny', '毛利润(CNY)')}
          ${sortableTh('loss', 'realCny', '调整后真实利润(CNY)')}
          ${sortableTh('loss', 'realMargin', '毛利率')}
          <th>主因</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${withSale.length > LOSS_DISPLAY ? `<div class="pf-note">其余 ${withSale.length - LOSS_DISPLAY} 个有销量亏损 SKU 见下方全量明细。</div>` : ''}`);
}
function sortKeyLabel(k) {
  return ({
    ms: 'MSKU', name: '品名', site: '站点', qty: '销量',
    saleCny: '销售额', grossCny: '毛利润', realCny: '调整后真实利润', realMargin: '毛利率',
    adCny: '广告费', acos: 'ACOS', matchedPuCny: '匹配采购价', head: '头程',
  })[k] || k;
}

/* ===================== 广告效率 ===================== */
function renderAd(rows) {
  if (!rows.length) return '';
  const sorted = applySort(rows, 'ad');
  const body = sorted.map((r) => `
    <tr>
      <td class="pf-ms">${esc(r.ms)}</td>
      <td class="pf-name">${nameSpan(r)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtCNY(r.saleCny)}</td>
      <td class="pf-num">${fmtCNY(r.adCny)}</td>
      <td class="pf-num">${fmtPct(r.saleCny > 0 ? r.adCny / r.saleCny : 0)}</td>
      <td class="pf-num ${r.realCny < 0 ? 'pf-neg' : 'pf-pos'}">${fmtCNY(r.realCny)}</td>
    </tr>`).join('');
  return section('📣 广告效率 TOP10', `
    <div class="table-scroll">
      <table class="pf-table" data-table="ad">
        <thead><tr>
          ${sortableTh('ad', 'ms', 'MSKU')}
          ${sortableTh('ad', 'name', '品名')}
          ${sortableTh('ad', 'site', '站点')}
          ${sortableTh('ad', 'saleCny', '销售额(CNY)')}
          ${sortableTh('ad', 'adCny', '广告费(CNY)')}
          ${sortableTh('ad', 'acos', 'ACOS')}
          ${sortableTh('ad', 'realCny', '调整后真实利润(CNY)')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`);
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
  return section('🌍 按站点汇总（AE / SA，单位 CNY）', `
    <div class="table-scroll">
      <table class="pf-table">
        <thead><tr><th>站点</th><th>SKU数</th><th>销售额(CNY)</th><th>毛利润(CNY)</th><th>真实利润(CNY)</th><th>真实毛利率</th><th>广告费(CNY)</th><th>ACOS</th></tr></thead>
        <tbody>${row(siteStats.AE)}${row(siteStats.SA)}</tbody>
      </table>
    </div>`);
}

/* ===================== 全量明细（默认有销量，支持成本调整） ===================== */
function renderDetail(rows, overrides, headOverrides, purchaseMap) {
  const params = getParams();
  const all = [...rows].sort((a, b) => b.realCny - a.realCny);
  const withSale = all.filter((r) => r.qty > 0);
  const view = applySort(detailShowAll ? all : withSale, 'detail');
  const zeroN = all.length - withSale.length;

  const body = view.map((r) => {
    const rowCls = r.realProfit > 0 ? 'pf-row-pos' : (r.realProfit < 0 ? 'pf-row-neg' : '');
    const puVal = overrides[r.ms] != null ? Number(overrides[r.ms]) : '';
    const headVal = headOverrides[r.ms] != null ? Number(headOverrides[r.ms]) * 100 : '';
    return `
    <tr class="${rowCls}">
      <td class="pf-ms">${esc(r.ms)}</td>
      <td class="pf-name">${nameSpan(r)}</td>
      <td>${r.site}</td>
      <td class="pf-num">${fmtInt(r.qty)}</td>
      <td class="pf-num">${fmtCNY(r.saleCny)}</td>
      <td class="pf-num">${fmtCNY(r.grossCny)}</td>
      <td class="pf-num pf-muted">${r.matchedPuCny > 0 ? fmtCNY(r.matchedPuCny) : '—'}</td>
      <td class="pf-cost-cell">
        <input type="number" class="pf-cost-input" data-ms="${esc(r.ms)}" value="${puVal}" placeholder="${r.matchedPuCny > 0 ? r.matchedPuCny : '0'}" min="0" step="0.01" title="${overrides[r.ms] != null ? '已手动覆盖' : (r.matchedPuCny > 0 ? '来自采购单' : '无采购价，按0计')}">
      </td>
      <td class="pf-cost-cell">
        <input type="number" class="pf-head-input" data-ms="${esc(r.ms)}" value="${headVal}" placeholder="${(params.headRate * 100).toFixed(1)}" min="0" max="50" step="0.1" title="${headOverrides[r.ms] != null ? '已手动覆盖头程比例' : '未填则用全局头程率'}">
      </td>
      <td class="pf-num">${fmtCNY(r.head / r.rate)}</td>
      <td class="pf-num">${fmtCNY(r.adCny)}</td>
      <td class="pf-num ${r.realCny < 0 ? 'pf-neg' : 'pf-pos'}">${fmtCNY(r.realCny)}</td>
      <td class="pf-num ${r.realMargin < 0 ? 'pf-neg' : 'pf-pos'}">${fmtPct(r.realMargin)}</td>
    </tr>`;
  }).join('');

  const toggleBtn = zeroN > 0
    ? `<button class="btn btn-soft btn-sm" id="pfToggleDetail">${detailShowAll ? '仅显示有销量' : `显示全部（含 ${zeroN} 个零销量）`}</button>`
    : '';

  return section(`📋 全量明细（数据底表 · 默认按调整后真实利润降序、仅显示有销量 ${withSale.length} 个${detailShowAll ? '，已展开全部 ' + all.length + ' 个' : ''}）`, `
    <div class="pf-detail-toolbar">${toggleBtn}<span class="pf-note" style="margin:0">「调整后采购单价 / 头程比例」留空则用采购单匹配值 / 全局 ${fmtPct(params.headRate)}；填了即时重算。</span></div>
    <div class="table-scroll">
      <table class="pf-table pf-detail" data-table="detail">
        <thead><tr>
          ${sortableTh('detail', 'ms', 'MSKU')}
          ${sortableTh('detail', 'name', '品名')}
          ${sortableTh('detail', 'site', '站点')}
          ${sortableTh('detail', 'qty', '销量')}
          ${sortableTh('detail', 'saleCny', '销售额(CNY)')}
          ${sortableTh('detail', 'grossCny', '毛利润(CNY)')}
          ${sortableTh('detail', 'matchedPuCny', '匹配采购价(CNY)')}
          <th>调整后采购单价(CNY)</th>
          <th>调整后头程比例(%)</th>
          ${sortableTh('detail', 'head', '头程(CNY)')}
          ${sortableTh('detail', 'adCny', '广告费(CNY)')}
          ${sortableTh('detail', 'realCny', '调整后真实利润(CNY)')}
          ${sortableTh('detail', 'realMargin', '真实毛利率')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`);
}

function section(title, inner) {
  return `<div class="sa-section"><div class="sa-section-head"><span>${title}</span></div>${inner}</div>`;
}

/* ===================== 事件 ===================== */
function bindEvents(container, ctx) {
  // 次导航栏切换（两个 tab 都需可点击，故在最前绑定）
  container.querySelectorAll('.pf-subnav-tab').forEach((el) => {
    el.addEventListener('click', () => {
      profitSubTab = el.dataset.sub;
      ctx.rerender();
    });
  });

  // 「海运空运对比」tab：仅绑定对比输入，以下均为「利润分析」专用事件
  if (profitSubTab === 'shipping') {
    bindShipping(container, shipState, saveShipState);
    return;
  }
  // 「FBA 利润计算」tab：复用 pages/fba.js 的 render 挂载到 #fbaHost
  if (profitSubTab === 'fba') {
    const host = container.querySelector('#fbaHost');
    if (host) renderFba(host, ctx);
    return;
  }

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

  container.querySelector('#pfToggleDetail')?.addEventListener('click', () => {
    detailShowAll = !detailShowAll;
    ctx.rerender();
  });

  // 站点筛选（只影响 TOP / 亏损 / 广告 / 明细；KPI 与分站点保持全量）
  container.querySelector('#pfSiteFilter')?.addEventListener('change', (e) => {
    const next = setSiteFilter(e.target.value);
    e.target.value = next;
    toastInfo(next === 'all' ? '已恢复全部站点' : `已筛选 ${next} 站`);
    ctx.rerender();
  });

  // 点击表头切换排序（每张表独立状态，模块级 sortStates 保留）
  container.querySelectorAll('.pf-sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const tableKey = th.dataset.table;
      const key = th.dataset.sort;
      const cur = sortStates[tableKey] || DEFAULT_SORT[tableKey];
      const dir = cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : (STR_KEYS.includes(key) ? 'asc' : 'desc');
      sortStates[tableKey] = { key, dir };
      ctx.rerender();
    });
  });

  // 调整后采购单价（CNY）：留空/≤0 视为清除，回退采购单取值
  container.querySelectorAll('.pf-cost-input').forEach((inp) => {
    const commit = () => {
      setCostOverride(inp.dataset.ms, inp.value);
      toastInfo('已更新采购单价，重算中…');
      ctx.rerender();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });

  // 调整后头程比例（%）：留空/≤0 视为清除，回退全局头程率
  container.querySelectorAll('.pf-head-input').forEach((inp) => {
    const commit = () => {
      const ratio = Number(inp.value) / 100;
      setHeadOverride(inp.dataset.ms, isFinite(ratio) ? ratio : '');
      toastInfo('已更新头程比例，重算中…');
      ctx.rerender();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
}
