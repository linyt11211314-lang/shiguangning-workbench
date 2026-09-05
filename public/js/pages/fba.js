/**
 * FBA 利润计算工作台
 * 单产品录入 → 自动算净利润 / 净利润率 / 广告指标。
 * 数据存 localStorage：当前表单 sgn.fba.calc，SKU 快照列表 sgn.fba.records。
 */
import { esc } from '../utils.js';
import { getParams } from '../store/profitStore.js';

const KEY = 'sgn.fba.calc';
const REC_KEY = 'sgn.fba.records';

const DEFAULTS = {
  sku: '',            // SKU（保存/列表显示用）
  priceAED: '',       // 售价 AED
  qty: '',            // 销量 个
  totalSales: '',     // 总销售额 AED（空 = 售价 × 销量；填了则覆盖）
  costCny: '',        // 采购成本 元
  headKgPrice: '',    // 头程运费单价 元/kg
  unitWeight: '',     // 单件实重 kg（头程按"实重 vs 体积重"取大计费）
  dimLength: '',      // 长 cm
  dimWidth: '',       // 宽 cm
  dimHeight: '',      // 高 cm
  volCoef: '',         // 体积重系数（国际空运/快递默认 5000；留空则不计算体积重）
  dimSource: 'product', // 体积重来源：'product'=按产品长宽高；'box'=按整箱长宽高÷单箱件数
  boxLength: '',       // 整箱长 cm（仅 dimSource='box' 用）
  boxWidth: '',        // 整箱宽 cm（仅 dimSource='box' 用）
  boxHeight: '',       // 整箱高 cm（仅 dimSource='box' 用）
  boxQty: '',         // 单箱件数 个（按箱子尺寸时必填）
  fbaFee: '9',        // FBA 配送费 AED/件（默认 9）
  commissionRate: '15', // 亚马逊佣金率 %（默认 15）
  adSpend: '',        // 广告花费 AED
  adSales: '',        // 广告销售额 AED（算 ACOS）
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULTS, ...raw };
  } catch (_) {}
  return { ...DEFAULTS };
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
}
function loadRecords() {
  try {
    const arr = JSON.parse(localStorage.getItem(REC_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function saveRecords(arr) {
  try { localStorage.setItem(REC_KEY, JSON.stringify(arr)); } catch (_) {}
}
function safeRate() {
  try { const p = getParams(); if (p && p.rateAED) return p.rateAED; } catch (_) {}
  return 0.5137;
}
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(v, dec = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  // 列表里不要完整日期（太丑），只显示 HH:MM（鼠标 hover 可在原生 title 上看完整时间）
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function field(key, label, unit, state, placeholder = '—') {
  return `
    <div class="fba-field">
      <label>${esc(label)}<span class="fba-unit">${esc(unit)}</span></label>
      <input class="input" type="number" step="any" min="0" data-fba-key="${esc(key)}" value="${esc(state[key] ?? '')}" placeholder="${esc(placeholder)}">
    </div>`;
}
function fieldText(key, label, state, placeholder = '如 SKU-001') {
  return `
    <div class="fba-field">
      <label>${esc(label)}</label>
      <input class="input" type="text" data-fba-key="${esc(key)}" value="${esc(state[key] ?? '')}" placeholder="${esc(placeholder)}" maxlength="80">
    </div>`;
}

function card(title, bodyHtml, gridCls) {
  return `
    <div class="fba-card">
      <h3>${title}</h3>
      <div class="fba-grid${gridCls ? ' ' + gridCls : ''}">${bodyHtml}</div>
    </div>`;
}

export function compute(s, rate) {
  const price = num(s.priceAED);
  const qty = num(s.qty);
  const totalSalesInput = num(s.totalSales);
  const costCny = num(s.costCny);
  const headKgPrice = num(s.headKgPrice);
  const unitWeight = num(s.unitWeight);
  const fbaFee = num(s.fbaFee);
  const cr = num(s.commissionRate) / 100;
  const adSpend = num(s.adSpend);
  const adSales = num(s.adSales);

  // 体积重：两种来源二选一
  //   product：长 × 宽 × 高 ÷ 系数（单件体积）
  //   box：    箱长 × 箱宽 × 箱高 ÷ 单箱件数 ÷ 系数（整箱体积重摊到每件）
  // 任一必要字段为空 / 0 → 体积重 = 0（按实重计费，老数据兼容）
  const source = (s.dimSource === 'box') ? 'box' : 'product';
  const L = num(s.dimLength), W = num(s.dimWidth), H = num(s.dimHeight);
  const BL = num(s.boxLength), BW = num(s.boxWidth), BH = num(s.boxHeight);
  const boxQty = num(s.boxQty);
  const coef = num(s.volCoef);  // 空/0 → 系数无效，不计算体积重
  let volumetricKg = 0;
  if (coef > 0) {
    if (source === 'box') {
      if (BL > 0 && BW > 0 && BH > 0 && boxQty > 0) {
        volumetricKg = (BL * BW * BH) / boxQty / coef;
      }
    } else {
      if (L > 0 && W > 0 && H > 0) {
        volumetricKg = (L * W * H) / coef;
      }
    }
  }
  // 计费重 = max(实重, 体积重)；体积重为 0 时退化为仅按实重
  const chargeableKg = Math.max(unitWeight, volumetricKg);

  const unitCostAED = costCny * rate;
  const unitHeadAED = headKgPrice * chargeableKg * rate;   // 头程按"实重 vs 体积重"取大
  const unitTotalAED = unitCostAED + unitHeadAED;          // 单件总成本（AED）

  const autoSales = price * qty;                           // 自动销售额
  const useManual = s.totalSales !== '' && s.totalSales != null && Number.isFinite(parseFloat(s.totalSales));
  const sales = useManual ? totalSalesInput : autoSales;   // 最终销售额
  const unitCommission = price * cr;                       // 单件佣金
  const totalCommission = unitCommission * qty;            // 总佣金
  const totalFba = fbaFee * qty;                           // 总 FBA
  const totalProductCost = unitTotalAED * qty;             // 总产品成本（AED）
  const totalAd = adSpend;

  const netProfit = sales - totalCommission - totalFba - totalAd - totalProductCost;
  const netMargin = sales > 0 ? netProfit / sales : null;
  const adSpendRatio = sales > 0 ? adSpend / sales : null;
  const acos = adSales > 0 ? adSpend / adSales : null;

  return {
    unitCostAED, unitHeadAED, unitTotalAED,
    volumetricKg, chargeableKg, headByVolume: volumetricKg > unitWeight,
    dimSource: source, // 用于结果区文案区分
    autoSales, salesManual: useManual, sales,
    unitCommission, totalCommission, totalFba, totalProductCost, totalAd,
    netProfit, netMargin, adSpendRatio, acos,
    unitNetProfit: qty > 0 ? netProfit / qty : null,
  };
}

function summary(state, rate) {
  const r = compute(state, rate);
  return {
    price: num(state.priceAED),
    qty: num(state.qty),
    sales: r.sales,
    netProfit: r.netProfit,
    netMargin: r.netMargin,
  };
}

function renderRecordsList(records) {
  if (!records.length) {
    return `<div class="fba-list-empty">还没有保存的 SKU。<br>填好表单后点「💾 保存当前 SKU」即可加入列表。</div>`;
  }
  return records.map((r) => {
    const sum = r.summary || {};
    const margin = sum.netMargin == null ? '—' : (fmt(sum.netMargin * 100) + '%');
    const profitCls = (sum.netProfit ?? 0) >= 0 ? 'pos' : 'neg';
    return `
      <div class="fba-list-item" data-rec-id="${esc(r.id)}">
        <div class="fba-list-row" data-act="toggle" data-rec-id="${esc(r.id)}" title="点击查看总览">
          <span class="fba-list-sku">${esc(r.sku || '(未命名)')}</span>
          <span class="fba-list-meta">${esc(fmtTime(r.savedAt))}</span>
          <span class="fba-list-arrow">▸</span>
        </div>
        <div class="fba-list-detail">
          <div class="fba-list-stats">
            <span>售价 ${fmt(sum.price)}</span>
            <span>销量 ${fmt(sum.qty, 0)}</span>
            <span>销售 ${fmt(sum.sales)}</span>
            <span>净利 <b class="${profitCls}">${fmt(sum.netProfit)}</b></span>
            <span>利率 ${esc(margin)}</span>
          </div>
          <div class="fba-list-actions">
            <button class="btn btn-soft btn-sm" data-act="load" data-rec-id="${esc(r.id)}">载入</button>
            <button class="btn btn-soft btn-sm" data-act="del" data-rec-id="${esc(r.id)}">删除</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

export function render(container, ctx) {
  const state = load();
  const rate = safeRate();
  let records = loadRecords().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

  const saleFields =
    fieldText('sku', 'SKU', state, '用于列表显示与以后查看') +
    field('priceAED', '售价', 'AED', state) +
    field('qty', '销量', '个', state) +
    field('totalSales', '总销售额', 'AED', state);
  const costBaseFields =
    field('costCny', '采购成本', '元', state) +
    field('headKgPrice', '头程运费单价', '元/kg', state) +
    field('fbaFee', 'FBA 配送费', 'AED/件', state) +
    field('commissionRate', '亚马逊佣金率', '%', state);
  // 体积重来源切换（segmented control）+ 两组尺寸块（可同时填，切换不丢数据）
  const src = (state.dimSource === 'box') ? 'box' : 'product';
  const productDimFields =
    field('dimLength', '长', 'cm', state) +
    field('dimWidth', '宽', 'cm', state) +
    field('dimHeight', '高', 'cm', state);
  const boxDimFields =
    field('boxLength', '箱长', 'cm', state) +
    field('boxWidth', '箱宽', 'cm', state) +
    field('boxHeight', '箱高', 'cm', state);
  const costCommonFields =
    field('volCoef', '体积重系数', '（空=不计体积重）', state, '5000 国际空运；6000 海运头程') +
    field('unitWeight', '单件实重', 'kg', state) +
    field('boxQty', '单箱件数', '个', state);
  // 成本区卡片：分组 + 双 grid + 来源切换
  const costCard = `
    <div class="fba-card">
      <h3>🧾 成本与配送费用</h3>
      <div class="fba-chargeable" id="fbaChargeable">
        <span class="fba-chargeable-label">📦 计费重</span>
        <span class="fba-chargeable-value" id="fbaChargeableValue">— kg</span>
        <span class="fba-chargeable-detail" id="fbaChargeableDetail">填尺寸 + 体积重系数后自动计算</span>
      </div>
      <div class="fba-section-title">基础成本</div>
      <div class="fba-grid">${costBaseFields}</div>

      <div class="fba-section-title fba-section-title-row">
        <span>📐 产品尺寸 vs 📦 箱子尺寸（头程按实重 vs 体积重取大）</span>
        <span class="fba-seg" role="tablist" id="fbaDimSeg">
          <button type="button" data-src="product" class="${src === 'product' ? 'active' : ''}">按产品尺寸</button>
          <button type="button" data-src="box" class="${src === 'box' ? 'active' : ''}">按箱子尺寸</button>
        </span>
      </div>

      <div class="fba-dim-block ${src === 'product' ? 'active' : ''}" data-dim-block="product">
        <div class="fba-dim-head">📐 产品尺寸（单件长 × 宽 × 高 ÷ 系数）</div>
        <div class="fba-grid cols-3">${productDimFields}</div>
      </div>
      <div class="fba-dim-block ${src === 'box' ? 'active' : ''}" data-dim-block="box">
        <div class="fba-dim-head">📦 整箱尺寸（箱长×宽×高 ÷ 单箱件数 ÷ 系数 = 单件体积重）</div>
        <div class="fba-grid cols-3">${boxDimFields}</div>
      </div>

      <div class="fba-grid cols-4">${costCommonFields}</div>
    </div>`;
  const adFields = field('adSpend', '广告花费', 'AED', state) + field('adSales', '广告销售额', 'AED', state);

  container.innerHTML = `
    <style>
      .fba-layout { display: grid; grid-template-columns: 220px 1fr; gap: 14px; padding: 4px 4px 28px; max-width: 1040px; margin: 0; align-items: start; }
      @media (max-width: 860px) { .fba-layout { grid-template-columns: 1fr; } }
      .fba-side { background: var(--card,#fff); border:1px solid var(--border,#ececf1); border-radius:14px; padding:14px 12px 10px; box-shadow:0 1px 3px rgba(20,20,40,.04); position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow: auto; }
      .fba-side h3 { margin: 0 0 8px; font-size: 14px; }
      .fba-side-head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
      .fba-side-head .count { font-size:12px; color:var(--muted,#8a8a99); }
      .fba-list-empty { font-size:12px; color:var(--muted,#8a8a99); padding: 18px 4px; text-align:center; line-height:1.7; }
      .fba-list-item { border:1px solid var(--border,#ececf1); border-radius:10px; margin-bottom:8px; background:var(--input,#fafafe); overflow: hidden; }
      .fba-list-item:last-child { margin-bottom:0; }
      .fba-list-row { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; cursor:pointer; gap:6px; user-select:none; }
      .fba-list-row:hover { background: var(--card-hover, rgba(108,92,231,.06)); }
      .fba-list-row .fba-list-sku { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; color: var(--text,#1c1c28); word-break: break-all; }
      .fba-list-row .fba-list-meta { font-size:10px; color:var(--muted,#8a8a99); flex-shrink:0; }
      .fba-list-arrow { font-size:11px; color:var(--muted,#8a8a99); transition: transform .15s ease; flex-shrink:0; }
      .fba-list-item.is-open .fba-list-arrow { transform: rotate(90deg); }
      .fba-list-detail { display: none; padding: 8px 10px 10px; border-top: 1px dashed var(--border,#ececf1); background: var(--card, #fff); }
      .fba-list-item.is-open .fba-list-detail { display: block; }
      .fba-list-stats { display:flex; flex-wrap:wrap; gap:4px 8px; font-size:11px; color:var(--muted,#6a6a78); margin-bottom:8px; }
      .fba-list-stats .pos { color:#16a34a; } .fba-list-stats .neg { color:#dc2626; }
      .fba-list-actions { display:flex; gap:6px; }
      .fba-list-actions .btn { flex:1; font-size:12px; padding:5px 8px; }

      .fba-chargeable { display:flex; align-items:center; gap:10px; padding:10px 14px; background:linear-gradient(135deg,#f7f7fb,#eef0fa); border:1px solid var(--border,#ececf1); border-radius:10px; margin-bottom:14px; flex-wrap: wrap; }
      .fba-chargeable-label { font-size:12px; color:var(--muted,#6a6a78); font-weight:500; }
      .fba-chargeable-value { font-size:20px; font-weight:700; color:var(--accent,#6c5ce7); }
      .fba-chargeable-detail { font-size:11px; color:var(--muted,#8a8a99); flex: 1; min-width: 0; }

      .fba-section-title-row { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
      .fba-seg { display: inline-flex; border:1px solid var(--border,#ececf1); border-radius:8px; overflow:hidden; }
      .fba-seg button { padding:5px 12px; font-size:12px; background:var(--input,#fafafe); border:none; cursor:pointer; color: var(--muted,#8a8a99); transition: background .12s ease, color .12s ease; }
      .fba-seg button + button { border-left: 1px solid var(--border,#ececf1); }
      .fba-seg button:hover { background: var(--card-hover, rgba(108,92,231,.06)); color: var(--text,#1c1c28); }
      .fba-seg button.active { background: var(--accent,#6c5ce7); color: #fff; }

      .fba-dim-block { padding:10px 14px; border:1px solid var(--border,#ececf1); border-radius:10px; margin-bottom:10px; background: transparent; transition: border-color .15s ease, background .15s ease; }
      .fba-dim-block.active { border-color: var(--accent,#6c5ce7); background: rgba(108,92,231,.05); }
      .fba-dim-head { font-size:12px; color: var(--muted,#6a6a78); margin-bottom:8px; font-weight: 500; }
      .fba-dim-block.active .fba-dim-head { color: var(--accent,#6c5ce7); }
      .fba-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }

      .fba-main { min-width: 0; }
      .fba-card { background: var(--card,#fff); border:1px solid var(--border,#ececf1); border-radius:14px;
        padding:18px 20px; margin-bottom:18px; box-shadow:0 1px 3px rgba(20,20,40,.04); }
      .fba-card h3 { margin:0 0 14px; font-size:15px; }
      .fba-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px 18px; }
      .fba-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
      .fba-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
      .fba-section-title { font-size:12px; color:var(--muted,#8a8a99); margin: 4px 0 10px; font-weight: 500; letter-spacing: .2px; }
      .fba-section-title:not(:first-child) { margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--border,#ececf1); }
      @media (max-width:760px){ .fba-grid, .fba-grid.cols-4 { grid-template-columns:repeat(2,1fr);} }
      .fba-field label { display:block; font-size:12px; color:var(--muted,#8a8a99); margin-bottom:6px; }
      .fba-field input { width:100%; box-sizing:border-box; padding:9px 10px; border:1px solid var(--border,#e3e3ea);
        border-radius:9px; font-size:14px; background:var(--input,#fafafe); color:var(--text,#1c1c28); }
      .fba-field input:focus { outline:none; border-color:var(--accent,#6c5ce7); box-shadow:0 0 0 3px rgba(108,92,231,.12); }
      .fba-unit { font-size:11px; color:var(--muted,#8a8a99); margin-left:4px; }
      .fba-results { display:grid; grid-template-columns:repeat(2,1fr); gap:12px 18px; }
      @media (max-width:760px){ .fba-results{ grid-template-columns:1fr;} }
      .fba-kpi { background:var(--input,#f7f7fb); border-radius:10px; padding:12px 14px; }
      .fba-kpi .k { font-size:12px; color:var(--muted,#8a8a99); }
      .fba-kpi .v { font-size:20px; font-weight:700; margin-top:4px; }
      .fba-kpi .sub { font-size:11px; color:var(--muted,#8a8a99); margin-top:2px; }
      .fba-kpi.hl { background:linear-gradient(135deg,#6c5ce7,#8e7bff); color:#fff; }
      .fba-kpi.hl .k { color:rgba(255,255,255,.85); }
      .pos { color:#16a34a; } .neg { color:#dc2626; }
      .fba-note { font-size:12px; color:var(--muted,#8a8a99); line-height:1.6; margin-top:12px; }
      .fba-actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
      .fba-actions .btn { font-size: 13px; }
    </style>
    <div class="fba-layout">
      <aside class="fba-side" id="fbaSide">
        <div class="fba-side-head">
          <h3>📚 已保存 SKU</h3>
          <span class="count">共 <span id="fbaRecCount">${records.length}</span> 条</span>
        </div>
        <div id="fbaRecords">${renderRecordsList(records)}</div>
      </aside>
      <div class="fba-main">
        ${card('📦 销售参数', saleFields, 'cols-4')}
        ${costCard}
        ${card('📣 广告参数', adFields)}
        <div class="fba-card">
          <h3>💰 自动计算结果</h3>
          <div class="fba-results" id="fbaResults"></div>
          <div class="fba-note" id="fbaNote">
            汇率口径：1 元 = ${fmt(rate, 4)} AED（与利润看板一致）。体积重来源：「按产品尺寸」= 长 × 宽 × 高 ÷ 系数；「按箱子尺寸」= 箱长 × 箱宽 × 箱高 ÷ 单箱件数 ÷ 系数。
            单件头程按「实重 vs 体积重」取大计费；单件总成本 =（采购 + 单件头程）× 汇率。销售额默认 = 售价 × 销量；填了「总销售额」则以其为准。
          </div>
          <div class="fba-actions">
            <button class="btn btn-primary btn-sm" id="fbaSave">💾 保存当前 SKU</button>
            <button class="btn btn-soft btn-sm" id="fbaReset">清空重填</button>
          </div>
        </div>
      </div>
    </div>`;

  const recalc = () => {
    const r = compute(state, rate);
    const resultsEl = container.querySelector('#fbaResults');
    if (!resultsEl) return;
    const clsNet = r.netProfit > 0 ? 'pos' : (r.netProfit < 0 ? 'neg' : '');
    const clsMargin = r.netMargin == null ? '' : (r.netMargin >= 0 ? 'pos' : 'neg');
    const clsUnitNet = r.unitNetProfit == null ? '' : (r.unitNetProfit >= 0 ? 'pos' : 'neg');
    const salesSource = r.salesManual
      ? `（手动 ${fmt(r.sales)}，自动 = ${fmt(r.autoSales)}）`
      : `（自动 = 售价 × 销量）`;
    const sourceLabel = r.dimSource === 'box' ? '箱子尺寸' : '产品尺寸';
    const headDetail = r.volumetricKg > 0
      ? `实重 ${fmt(r.unitWeight)} × 体积重 ${fmt(r.volumetricKg)}（${sourceLabel}）→ 取大 ${fmt(r.chargeableKg)} kg${r.headByVolume ? '（按体积重计费）' : '（按实重计费）'}`
      : `实重 ${fmt(r.chargeableKg)} kg（按${sourceLabel}）`;
    // 同步更新卡片标题下方的计费重摘要条
    const chargeVal = container.querySelector('#fbaChargeableValue');
    const chargeDet = container.querySelector('#fbaChargeableDetail');
    if (chargeVal) chargeVal.textContent = `${fmt(r.chargeableKg)} kg`;
    if (chargeDet) chargeDet.textContent = headDetail;
    resultsEl.innerHTML = `
      <div class="fba-kpi"><div class="k">单件总成本（AED）</div><div class="v">${fmt(r.unitTotalAED)}</div><div class="sub">采购 ${fmt(r.unitCostAED)} + 头程 ${fmt(r.unitHeadAED)}</div></div>
      <div class="fba-kpi"><div class="k">单件净利润（AED）</div><div class="v ${clsUnitNet}">${fmt(r.unitNetProfit)}</div><div class="sub">净利润 ÷ 销量</div></div>
      <div class="fba-kpi"><div class="k">销售额（AED）</div><div class="v">${fmt(r.sales)}</div><div class="sub">${salesSource}</div></div>
      <div class="fba-kpi hl"><div class="k">净利润（AED）</div><div class="v ${clsNet}">${fmt(r.netProfit)}</div></div>
      <div class="fba-kpi"><div class="k">净利润率</div><div class="v ${clsMargin}">${r.netMargin == null ? '—' : (fmt(r.netMargin * 100) + '%')}</div></div>
      <div class="fba-kpi"><div class="k">佣金金额（单件 AED）</div><div class="v">${fmt(r.unitCommission)}</div></div>
      <div class="fba-kpi"><div class="k">广告费占比（广告费 ÷ 销售额）</div><div class="v">${r.adSpendRatio == null ? '—' : (fmt(r.adSpendRatio * 100) + '%')}</div></div>
      <div class="fba-kpi"><div class="k">ACOS（广告费 ÷ 广告销售额）</div><div class="v">${r.acos == null ? '—' : (fmt(r.acos * 100) + '%')}</div></div>`;
  };

  // 输入联动：刷新 KPI + 自动同步"总销售额"提示位
  container.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.dataset && el.dataset.fbaKey) {
      state[el.dataset.fbaKey] = el.value;
      save(state);
      recalc();
    }
  });
  // select 走 change 事件（暂未使用，箱规预设已移除）
  container.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.fbaKey) return;
    state[el.dataset.fbaKey] = el.value;
    save(state);
    recalc();
  });
  // 体积重来源切换：点击 segmented control 按钮 → 切换 state.dimSource + active 类
  const segEl = container.querySelector('#fbaDimSeg');
  if (segEl) {
    segEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-src]');
      if (!btn) return;
      const src = btn.getAttribute('data-src');
      if (state.dimSource === src) return;
      state.dimSource = src;
      save(state);
      // 按钮 active
      segEl.querySelectorAll('button[data-src]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-src') === src);
      });
      // 区块 active
      container.querySelectorAll('[data-dim-block]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-dim-block') === src);
      });
      recalc();
    });
  }

  // 售价 × 销量 → 实时回填到 totalSales（仅当 totalSales 为空时）
  const syncAutoTotal = () => {
    const inp = container.querySelector('[data-fba-key="totalSales"]');
    if (!inp) return;
    if (inp.value === '' || inp.value == null) {
      const p = parseFloat(state.priceAED);
      const q = parseFloat(state.qty);
      if (Number.isFinite(p) && Number.isFinite(q) && p > 0 && q > 0) {
        // 仅展示用占位：写到 placeholder 提示当前自动值，不污染 state
        inp.placeholder = `自动 = ${fmt(p * q)}`;
      } else {
        inp.placeholder = '售价×销量，留空使用自动';
      }
    }
  };
  // price / qty 改动时也要刷新 placeholder
  ['priceAED', 'qty'].forEach((k) => {
    const inp = container.querySelector(`[data-fba-key="${k}"]`);
    if (inp) inp.addEventListener('input', syncAutoTotal);
  });
  syncAutoTotal();

  // 清空重填
  const resetBtn = container.querySelector('#fbaReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      const blank = { ...DEFAULTS };
      save(blank);
      Object.keys(blank).forEach((k) => {
        const inp = container.querySelector(`[data-fba-key="${k}"]`);
        if (inp) inp.value = blank[k];
      });
      Object.assign(state, blank);
      recalc();
      syncAutoTotal();
    });
  }

  // 保存当前 SKU
  const saveBtn = container.querySelector('#fbaSave');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const sku = (state.sku || '').trim();
      if (!sku) {
        if (ctx && typeof ctx.toast === 'function') ctx.toast('请先填写 SKU 再保存');
        else alert('请先填写 SKU 再保存');
        const skuInp = container.querySelector('[data-fba-key="sku"]');
        if (skuInp) skuInp.focus();
        return;
      }
      const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const rec = {
        id,
        sku,
        savedAt: Date.now(),
        state: { ...state },
        summary: summary(state, rate),
      };
      records.unshift(rec);
      saveRecords(records);
      refreshList();
      if (ctx && typeof ctx.toast === 'function') ctx.toast(`已保存：${sku}`);
      else console.log(`[FBA] 已保存 ${sku}`);
    });
  }

  // 列表事件：载入 / 删除
  const refreshList = () => {
    records = loadRecords().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const list = container.querySelector('#fbaRecords');
    if (list) list.innerHTML = renderRecordsList(records);
    const cnt = container.querySelector('#fbaRecCount');
    if (cnt) cnt.textContent = String(records.length);
  };

  const listEl = container.querySelector('#fbaRecords');
  if (listEl) {
    listEl.addEventListener('click', (e) => {
      // 优先匹配：行内按钮（载入/删除）
      const btn = e.target.closest('button[data-act]');
      if (btn) {
        const id = btn.getAttribute('data-rec-id');
        const rec = records.find((r) => r.id === id);
        if (!rec) return;
        if (btn.dataset.act === 'load') {
          Object.assign(state, rec.state);
          save(state);
          Object.keys(state).forEach((k) => {
            const inp = container.querySelector(`[data-fba-key="${k}"]`);
            if (inp) inp.value = state[k] ?? '';
          });
          recalc();
          syncAutoTotal();
          if (ctx && typeof ctx.toast === 'function') ctx.toast(`已载入：${rec.sku}`);
        } else if (btn.dataset.act === 'del') {
          const ok = confirm(`确认删除「${rec.sku}」？此操作不可撤销。`);
          if (!ok) return;
          records = records.filter((r) => r.id !== id);
          saveRecords(records);
          refreshList();
        }
        return;
      }
      // 列表行点击 → 切换展开状态（显示总览卡片）
      const row = e.target.closest('[data-act="toggle"]');
      if (row) {
        const item = row.closest('.fba-list-item');
        if (item) item.classList.toggle('is-open');
      }
    });
  }

  recalc();
}