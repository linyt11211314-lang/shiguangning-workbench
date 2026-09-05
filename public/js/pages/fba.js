/**
 * FBA 利润计算工作台
 * 单产品录入 → 自动算净利润 / 净利润率 / 广告指标。
 * 数据全部存 localStorage（key: sgn.fba.calc），刷新保留。
 */
import { esc } from '../utils.js';
import { getParams } from '../store/profitStore.js';

const KEY = 'sgn.fba.calc';

const DEFAULTS = {
  priceAED: '',     // 售价 AED
  qty: '',          // 销量 个
  costCny: '',      // 采购成本 元
  headKgPrice: '',  // 头程运费单价 元/kg
  unitWeight: '',   // 单件重量 kg
  boxQty: '',       // 单箱件数 个（物流预留字段）
  fbaFee: '9',      // FBA 配送费 AED/件（默认 9）
  commissionRate: '15', // 亚马逊佣金率 %（默认 15）
  adSpend: '',      // 广告花费 AED
  adSales: '',      // 广告销售额 AED（算 ACOS）
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

function field(key, label, unit, state) {
  return `
    <div class="fba-field">
      <label>${esc(label)}<span class="fba-unit">${esc(unit)}</span></label>
      <input class="input" type="number" step="any" min="0" data-fba-key="${esc(key)}" value="${esc(state[key] ?? '')}" placeholder="—">
    </div>`;
}

function card(title, bodyHtml) {
  return `
    <div class="fba-card">
      <h3>${title}</h3>
      <div class="fba-grid">${bodyHtml}</div>
    </div>`;
}

export function compute(s, rate) {
  const price = num(s.priceAED);
  const qty = num(s.qty);
  const costCny = num(s.costCny);
  const headKgPrice = num(s.headKgPrice);
  const unitWeight = num(s.unitWeight);
  const fbaFee = num(s.fbaFee);
  const cr = num(s.commissionRate) / 100;
  const adSpend = num(s.adSpend);
  const adSales = num(s.adSales);

  const unitCostAED = costCny * rate;
  const unitHeadAED = headKgPrice * unitWeight * rate;
  const unitTotalAED = unitCostAED + unitHeadAED;       // 单件总成本（AED）

  const sales = price * qty;                            // 销售额
  const unitCommission = price * cr;                    // 单件佣金
  const totalCommission = unitCommission * qty;         // 总佣金
  const totalFba = fbaFee * qty;                        // 总 FBA
  const totalProductCost = unitTotalAED * qty;          // 总产品成本（AED）
  const totalAd = adSpend;

  const netProfit = sales - totalCommission - totalFba - totalAd - totalProductCost;
  const netMargin = sales > 0 ? netProfit / sales : null;
  const adSpendRatio = sales > 0 ? adSpend / sales : null;
  const acos = adSales > 0 ? adSpend / adSales : null;

  return {
    unitCostAED, unitHeadAED, unitTotalAED,
    sales, unitCommission, totalCommission, totalFba, totalProductCost, totalAd,
    netProfit, netMargin, adSpendRatio, acos,
    unitNetProfit: qty > 0 ? netProfit / qty : null,
  };
}

export function render(container, ctx) {
  const state = load();
  const rate = safeRate();

  const saleFields = field('priceAED', '售价', 'AED', state) + field('qty', '销量', '个', state);
  const costFields =
    field('costCny', '采购成本', '元', state) +
    field('headKgPrice', '头程运费单价', '元/kg', state) +
    field('unitWeight', '单件重量', 'kg', state) +
    field('boxQty', '单箱件数', '个', state) +
    field('fbaFee', 'FBA 配送费', 'AED/件', state) +
    field('commissionRate', '亚马逊佣金率', '%', state);
  const adFields = field('adSpend', '广告花费', 'AED', state) + field('adSales', '广告销售额', 'AED', state);

  container.innerHTML = `
    <style>
      .fba-wrap { max-width: 960px; margin: 0 auto; padding: 4px 2px 28px; }
      .fba-card { background: var(--card,#fff); border:1px solid var(--border,#ececf1); border-radius:14px;
        padding:18px 20px; margin-bottom:18px; box-shadow:0 1px 3px rgba(20,20,40,.04); }
      .fba-card h3 { margin:0 0 14px; font-size:15px; }
      .fba-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px 18px; }
      @media (max-width:760px){ .fba-grid{ grid-template-columns:repeat(2,1fr);} }
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
      .fba-kpi.hl { background:linear-gradient(135deg,#6c5ce7,#8e7bff); color:#fff; }
      .fba-kpi.hl .k { color:rgba(255,255,255,.85); }
      .pos { color:#16a34a; } .neg { color:#dc2626; }
      .fba-note { font-size:12px; color:var(--muted,#8a8a99); line-height:1.6; margin-top:12px; }
      .fba-reset { margin-top:6px; }
    </style>
    <div class="fba-wrap">
      ${card('📦 销售参数', saleFields)}
      ${card('🧾 成本与配送费用', costFields)}
      ${card('📣 广告参数', adFields)}
      <div class="fba-card">
        <h3>💰 自动计算结果</h3>
        <div class="fba-results" id="fbaResults"></div>
        <div class="fba-note">
          汇率口径：1 元 = ${fmt(rate, 4)} AED（与利润看板一致）。单件头程 = 头程运费单价 × 单件重量；单件总成本 =（采购成本 + 单件头程）× 汇率。
          净利润 = 销售额 − 佣金 − FBA配送费 − 广告费 − 产品成本；单箱件数为物流预留字段，本期不参与计算。
        </div>
        <div class="fba-reset"><button class="btn btn-soft btn-sm" id="fbaReset">清空重填</button></div>
      </div>
    </div>`;

  const recalc = () => {
    const r = compute(state, rate);
    const resultsEl = container.querySelector('#fbaResults');
    if (!resultsEl) return;
    const clsNet = r.netProfit > 0 ? 'pos' : (r.netProfit < 0 ? 'neg' : '');
    const clsMargin = r.netMargin == null ? '' : (r.netMargin >= 0 ? 'pos' : 'neg');
    resultsEl.innerHTML = `
      <div class="fba-kpi"><div class="k">单件总成本（AED）</div><div class="v">${fmt(r.unitTotalAED)}</div></div>
      <div class="fba-kpi"><div class="k">单件净利润（AED）</div><div class="v ${r.unitNetProfit == null ? '' : (r.unitNetProfit >= 0 ? 'pos' : 'neg')}">${fmt(r.unitNetProfit)}</div></div>
      <div class="fba-kpi"><div class="k">销售额（AED）</div><div class="v">${fmt(r.sales)}</div></div>
      <div class="fba-kpi hl"><div class="k">净利润（AED）</div><div class="v ${clsNet}">${fmt(r.netProfit)}</div></div>
      <div class="fba-kpi"><div class="k">净利润率</div><div class="v ${clsMargin}">${r.netMargin == null ? '—' : (fmt(r.netMargin * 100) + '%')}</div></div>
      <div class="fba-kpi"><div class="k">佣金金额（单件 AED）</div><div class="v">${fmt(r.unitCommission)}</div></div>
      <div class="fba-kpi"><div class="k">广告费占比（广告费 ÷ 销售额）</div><div class="v">${r.adSpendRatio == null ? '—' : (fmt(r.adSpendRatio * 100) + '%')}</div></div>
      <div class="fba-kpi"><div class="k">ACOS（广告费 ÷ 广告销售额）</div><div class="v">${r.acos == null ? '—' : (fmt(r.acos * 100) + '%')}</div></div>`;
  };

  container.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.dataset && el.dataset.fbaKey) {
      state[el.dataset.fbaKey] = el.value;
      save(state);
      recalc();
    }
  });
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
    });
  }

  recalc();
}
