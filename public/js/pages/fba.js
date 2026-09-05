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
  boxPreset: '',      // 箱规预设：空=自定义；选预设时自动填长宽高
  boxQty: '',         // 单箱件数 个（物流预留字段）
  fbaFee: '9',        // FBA 配送费 AED/件（默认 9）
  commissionRate: '15', // 亚马逊佣金率 %（默认 15）
  adSpend: '',        // 广告花费 AED
  adSales: '',        // 广告销售额 AED（算 ACOS）
};

// 箱规预设：常见跨境物流纸箱尺寸（外径 cm）
const BOX_PRESETS = [
  { key: '',           label: '自定义（手动填长宽高）',  l: '', w: '', h: '' },
  { key: 'mini',       label: '小件 30×20×15 cm',     l: '30', w: '20', h: '15' },
  { key: 'small',      label: '小箱 40×30×20 cm',     l: '40', w: '30', h: '20' },
  { key: 'medium',     label: '中箱 50×40×30 cm',     l: '50', w: '40', h: '30' },
  { key: 'large',      label: '大箱 60×40×40 cm',     l: '60', w: '40', h: '40' },
  { key: 'xlarge',     label: '大件 70×50×50 cm',     l: '70', w: '50', h: '50' },
];

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
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
function fieldSelect(key, label, options, state) {
  const opts = options.map(([v, t]) => `<option value="${esc(v)}"${(state[key] ?? '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
  return `
    <div class="fba-field">
      <label>${esc(label)}</label>
      <select class="input" data-fba-key="${esc(key)}" data-fba-role="select">${opts}</select>
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

  // 体积重：长 × 宽 × 高 ÷ 系数；任一尺寸为空 → 体积重 = 0（按实重计费，老数据兼容）
  const L = num(s.dimLength);
  const W = num(s.dimWidth);
  const H = num(s.dimHeight);
  const coef = num(s.volCoef);  // 空/0 → 系数无效，不计算体积重
  const volumetricKg = (L > 0 && W > 0 && H > 0 && coef > 0) ? (L * W * H) / coef : 0;
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
        <div class="fba-list-main">
          <div class="fba-list-sku">${esc(r.sku || '(未命名)')}</div>
          <div class="fba-list-meta">${esc(fmtTime(r.savedAt))}</div>
          <div class="fba-list-stats">
            <span>售价 ${fmt(sum.price)}</span>
            <span>销量 ${fmt(sum.qty, 0)}</span>
            <span>销售 ${fmt(sum.sales)}</span>
            <span>净利 <b class="${profitCls}">${fmt(sum.netProfit)}</b></span>
            <span>利率 ${esc(margin)}</span>
          </div>
        </div>
        <div class="fba-list-actions">
          <button class="btn btn-soft btn-sm" data-act="load" data-rec-id="${esc(r.id)}">载入</button>
          <button class="btn btn-soft btn-sm" data-act="del" data-rec-id="${esc(r.id)}">删除</button>
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
  const costDimFields =
    field('dimLength', '长', 'cm', state) +
    field('dimWidth', '宽', 'cm', state) +
    field('dimHeight', '高', 'cm', state) +
    field('volCoef', '体积重系数', '（空=不计体积重）', state, '5000 国际空运；6000 海运头程') +
    field('unitWeight', '单件实重', 'kg', state) +
    field('boxQty', '单箱件数', '个', state) +
    fieldSelect('boxPreset', '箱规预设', BOX_PRESETS.map((p) => [p.key, p.label]), state);
  // 成本区卡片：分组 + 双 grid
  const costCard = `
    <div class="fba-card">
      <h3>🧾 成本与配送费用</h3>
      <div class="fba-section-title">基础成本</div>
      <div class="fba-grid">${costBaseFields}</div>
      <div class="fba-section-title">产品尺寸与箱规（头程按实重 vs 体积重取大）</div>
      <div class="fba-grid cols-4">${costDimFields}</div>
    </div>`;
  const adFields = field('adSpend', '广告花费', 'AED', state) + field('adSales', '广告销售额', 'AED', state);

  container.innerHTML = `
    <style>
      .fba-layout { display: grid; grid-template-columns: 280px 1fr; gap: 18px; padding: 4px 2px 28px; max-width: 1180px; margin: 0 auto; align-items: start; }
      @media (max-width: 900px) { .fba-layout { grid-template-columns: 1fr; } }
      .fba-side { background: var(--card,#fff); border:1px solid var(--border,#ececf1); border-radius:14px; padding:16px 16px 12px; box-shadow:0 1px 3px rgba(20,20,40,.04); position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow: auto; }
      .fba-side h3 { margin: 0 0 10px; font-size: 14px; }
      .fba-side-head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; }
      .fba-side-head .count { font-size:12px; color:var(--muted,#8a8a99); }
      .fba-list-empty { font-size:12px; color:var(--muted,#8a8a99); padding: 18px 4px; text-align:center; line-height:1.7; }
      .fba-list-item { border:1px solid var(--border,#ececf1); border-radius:10px; padding:10px 12px; margin-bottom:10px; background:var(--input,#fafafe); }
      .fba-list-item:last-child { margin-bottom:0; }
      .fba-list-main { margin-bottom: 8px; }
      .fba-list-sku { font-weight: 600; font-size: 14px; color: var(--text,#1c1c28); word-break: break-all; }
      .fba-list-meta { font-size:11px; color:var(--muted,#8a8a99); margin-top:2px; }
      .fba-list-stats { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:11px; color:var(--muted,#6a6a78); margin-top:6px; }
      .fba-list-stats .pos { color:#16a34a; } .fba-list-stats .neg { color:#dc2626; }
      .fba-list-actions { display:flex; gap:6px; }
      .fba-list-actions .btn { flex:1; font-size:12px; padding:5px 8px; }

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
            汇率口径：1 元 = ${fmt(rate, 4)} AED（与利润看板一致）。体积重 = 长 × 宽 × 高 ÷ 体积重系数；单件头程按「实重 vs 体积重」取大计费。
            单件总成本 =（采购成本 + 单件头程）× 汇率。销售额默认 = 售价 × 销量；若手动填写「总销售额」则以其为准。净利润 = 销售额 − 佣金 − FBA配送费 − 广告费 − 产品成本。
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
    const headDetail = r.volumetricKg > 0
      ? `实重 ${fmt(r.unitWeight)} × 体积重 ${fmt(r.volumetricKg)} → 取大 ${fmt(r.chargeableKg)} kg${r.headByVolume ? '（按体积重计费）' : '（按实重计费）'}`
      : `实重 ${fmt(r.chargeableKg)} kg`;
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
  // select 走 change 事件：箱规预设变化 → 自动回填长宽高到对应输入框
  container.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.fbaKey) return;
    state[el.dataset.fbaKey] = el.value;
    save(state);
    if (el.dataset.fbaKey === 'boxPreset') {
      const preset = BOX_PRESETS.find((p) => p.key === el.value);
      if (preset) {
        ['dimLength', 'dimWidth', 'dimHeight'].forEach((k) => {
          const inp = container.querySelector(`[data-fba-key="${k}"]`);
          if (inp) {
            inp.value = preset[k === 'dimLength' ? 'l' : k === 'dimWidth' ? 'w' : 'h'];
            state[k] = inp.value;
          }
        });
        save(state);
      }
    }
    recalc();
  });

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
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
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
    });
  }

  recalc();
}