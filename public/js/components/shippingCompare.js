/**
 * 海运空运成本对比（内联页，作为「利润看板」的次导航页面）
 *
 * 两种模式：
 *   auto   —— 按起收重量自动算数量：海/空各自算满足起收重量的最少件数
 *   custom —— 自定义数量：你输入发货件数，海/空按同一数量计算
 *
 * 输入：
 *   length / width / height  单件尺寸（cm）
 *   weight                  单件实重（kg）
 *   dimFactor               泡重系数（5000 / 6000，默认 5000）
 *   seaMin / seaRate        海运：起收重量(kg) / 单价(CNY/kg)
 *   airMin / airRate        空运：起收重量(kg) / 单价(CNY/kg)
 *   purchaseCost            单件采购成本（CNY）
 *   mode                    'auto' | 'custom'
 *   qty                     自定义数量（mode==='custom' 时生效）
 *
 * 计算：
 *   dimW      = L*W*H / dimFactor           单件体积重
 *   chargeW   = max(weight, dimW)           单件计费重
 *   qty       = auto: ceil(min/chargeW) ｜ custom: 用户输入（两路同一数量）
 *   billW     = max(chargeW * qty, min)     实际计费重量（按起收取最大值）
 *   totalCny  = billW * rate                运费总额（CNY）
 *   perCny    = totalCny / qty             单件均摊运费
 *   purchaseCny   = purchaseCost * qty      采购总成本
 *   combinedCny  = totalCny + purchaseCny   综合总成本（运费 + 采购）
 *   perCombinedCny = perCny + purchaseCost  单件综合成本
 *
 * 本模块只做「数据输出」，不给出任何推荐结论。
 */

function num(v, fallback = 0) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function isValidPos(v) {
  const n = Number(v);
  return isFinite(n) && n > 0;
}

/**
 * 纯函数计算，无副作用，便于测试与复用。
 * @param {{
 *   length:number, width:number, height:number, weight:number,
 *   dimFactor?:number,
 *   seaMin:number, seaRate:number,
 *   airMin:number, airRate:number,
 *   purchaseCost?:number,
 *   mode?:'auto'|'custom',
 *   qty?:number,
 * }} input
 */
export function computeShipping(input) {
  const length = num(input.length);
  const width = num(input.width);
  const height = num(input.height);
  const weight = num(input.weight);
  const dimFactor = num(input.dimFactor, 5000);
  const mode = input.mode === 'custom' ? 'custom' : 'auto';
  const purchaseCost = num(input.purchaseCost, 0);

  if (!isValidPos(length) || !isValidPos(width) || !isValidPos(height)) {
    return { error: '请填写完整的长 / 宽 / 高（需 > 0）' };
  }
  if (!isValidPos(weight)) {
    return { error: '请填写单件实重（kg，需 > 0）' };
  }
  if (!isValidPos(dimFactor)) {
    return { error: '泡重系数无效（需 > 0）' };
  }
  if (mode === 'custom') {
    const q = Math.floor(num(input.qty, 0));
    if (q < 1) return { error: '自定义数量需 ≥ 1 件' };
  }
  const seaMin = num(input.seaMin);
  const seaRate = num(input.seaRate);
  const airMin = num(input.airMin);
  const airRate = num(input.airRate);
  if (seaMin < 0 || airMin < 0) return { error: '起收重量不能为负' };
  if (seaRate < 0 || airRate < 0) return { error: '单价不能为负' };
  if (purchaseCost < 0) return { error: '采购成本不能为负' };

  const dimW = round3((length * width * height) / dimFactor);
  const chargeW = round3(Math.max(weight, dimW));

  function leg(min, rate) {
    let qty;
    if (mode === 'custom') {
      qty = Math.max(1, Math.floor(num(input.qty, 1)));
    } else {
      qty = min <= 0 ? 1 : Math.max(1, Math.ceil(min / chargeW));
    }
    const totalW = round3(Math.max(chargeW * qty, min));
    const totalCny = round3(totalW * rate);
    const perCny = round3(totalCny / qty);
    const purchaseCny = round3(purchaseCost * qty);
    const combinedCny = round3(totalCny + purchaseCny);
    const perCombinedCny = round3(perCny + purchaseCost);
    return { qty, totalW, totalCny, perCny, purchaseCny, combinedCny, perCombinedCny };
  }

  const sea = leg(seaMin, seaRate);
  const air = leg(airMin, airRate);

  // 仅为数据输出保留原始差额（不另作推荐判断）
  const diffShipping = round3(sea.totalCny - air.totalCny); // 正数表示空运运费更贵
  const diffCombined = round3(sea.combinedCny - air.combinedCny);

  return {
    dimW,
    chargeW,
    mode,
    sea,
    air,
    diffShipping,
    diffCombined,
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/* ============================================================
 * UI：内联渲染（作为利润看板次导航页面，无弹窗 / 无推荐结论）
 * ============================================================ */
const DEFAULTS = {
  length: 40, width: 30, height: 20, weight: 2,
  dimFactor: 5000,
  seaMin: 21, seaRate: 12,
  airMin: 21, airRate: 38,
  purchaseCost: 0,
  mode: 'auto',
  qty: 100,
};

/**
 * 渲染对比工具的内联 HTML（输入面板 + 结果面板，仅输出数据）。
 * @param {object} d 当前输入状态（含默认值的对象）
 */
export function renderShippingCompare(d = {}) {
  const s = { ...DEFAULTS, ...d };
  const modeBtn = (v, label) =>
    `<button type="button" class="ship-mode-btn ${s.mode === v ? 'active' : ''}" data-mode="${v}">${label}</button>`;
  return `
    <div class="ship-grid">
      <div class="ship-panel ship-panel-input">
        <div class="ship-panel-title">📦 产品 & 渠道参数</div>

        <div class="ship-mode">
          <span class="ship-mode-label">计算模式</span>
          <div class="ship-mode-toggle">
            ${modeBtn('auto', '按起收重量算数量')}
            ${modeBtn('custom', '自定义数量')}
          </div>
        </div>

        <div class="ship-section">
          <div class="ship-section-label">单件尺寸（cm） & 重量</div>
          <div class="ship-row4">
            <label>长 <input type="number" id="shipL" value="${s.length}" min="0" step="0.1"></label>
            <label>宽 <input type="number" id="shipW" value="${s.width}" min="0" step="0.1"></label>
            <label>高 <input type="number" id="shipH" value="${s.height}" min="0" step="0.1"></label>
            <label>实重 kg <input type="number" id="shipWg" value="${s.weight}" min="0" step="0.001"></label>
          </div>
          <div class="ship-row2">
            <label>泡重系数
              <select id="shipDim" class="ship-select">
                <option value="5000"${s.dimFactor == 5000 ? ' selected' : ''}>5000（标准）</option>
                <option value="6000"${s.dimFactor == 6000 ? ' selected' : ''}>6000（宽松）</option>
              </select>
            </label>
            <label>单件采购成本 CNY <input type="number" id="shipPurchase" value="${s.purchaseCost}" min="0" step="0.1"></label>
          </div>
          <div class="ship-hint">体积重 = 长 × 宽 × 高 ÷ 泡重系数，计费重取实重与体积重较大者</div>
        </div>

        <div class="ship-section ${s.mode === 'custom' ? '' : 'is-hidden'}" id="shipQtySection">
          <div class="ship-section-label">📦 产品数量</div>
          <div class="ship-row1">
            <label>发货数量（件）<input type="number" id="shipQty" value="${s.qty}" min="1" step="1"></label>
          </div>
          <div class="ship-hint">两路（海运 / 空运）均按此同一数量计算</div>
        </div>

        <div class="ship-section">
          <div class="ship-section-label">🚢 海运</div>
          <div class="ship-row2">
            <label>起收重量 kg <input type="number" id="shipSeaMin" value="${s.seaMin}" min="0" step="0.1"></label>
            <label>单价 CNY/kg <input type="number" id="shipSeaRate" value="${s.seaRate}" min="0" step="0.1"></label>
          </div>
        </div>

        <div class="ship-section">
          <div class="ship-section-label">✈️ 空运</div>
          <div class="ship-row2">
            <label>起收重量 kg <input type="number" id="shipAirMin" value="${s.airMin}" min="0" step="0.1"></label>
            <label>单价 CNY/kg <input type="number" id="shipAirRate" value="${s.airRate}" min="0" step="0.1"></label>
          </div>
        </div>

        <div class="ship-actions">
          <button class="btn btn-ghost btn-sm" id="shipReset">恢复默认</button>
          <span class="ship-spacer"></span>
          <span class="ship-error" id="shipError"></span>
        </div>
      </div>

      <div class="ship-panel ship-panel-result">
        <div class="ship-panel-title">📊 对比结果（仅数据）</div>

        <div class="ship-base">
          <span class="ship-base-item"><span class="ship-base-label">单件体积重</span><b id="rDimW">—</b></span>
          <span class="ship-base-item"><span class="ship-base-label">单件计费重</span><b id="rChargeW">—</b></span>
        </div>

        <div class="ship-compare">
          <div class="ship-card" id="cardSea">
            <div class="ship-card-head">
              <span class="ship-card-ico">🚢</span>
              <span class="ship-card-name">海运</span>
            </div>
            <div class="ship-card-row"><span>数量</span><b id="seaQty">—</b><span class="ship-card-unit">件</span></div>
            <div class="ship-card-row"><span>实际计费重</span><b id="seaW">—</b><span class="ship-card-unit">kg</span></div>
            <div class="ship-card-row"><span>运费总额</span><b class="ship-card-em" id="seaTotal">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>单件均摊</span><b id="seaPer">—</b><span class="ship-card-unit">CNY / 件</span></div>
            <div class="ship-card-row ship-card-row-2"><span>采购总成本</span><b id="seaPurchase">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>综合总成本</span><b id="seaCombined">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>单件综合</span><b id="seaPerCombined">—</b><span class="ship-card-unit">CNY / 件</span></div>
          </div>

          <div class="ship-card" id="cardAir">
            <div class="ship-card-head">
              <span class="ship-card-ico">✈️</span>
              <span class="ship-card-name">空运</span>
            </div>
            <div class="ship-card-row"><span>数量</span><b id="airQty">—</b><span class="ship-card-unit">件</span></div>
            <div class="ship-card-row"><span>实际计费重</span><b id="airW">—</b><span class="ship-card-unit">kg</span></div>
            <div class="ship-card-row"><span>运费总额</span><b class="ship-card-em" id="airTotal">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>单件均摊</span><b id="airPer">—</b><span class="ship-card-unit">CNY / 件</span></div>
            <div class="ship-card-row ship-card-row-2"><span>采购总成本</span><b id="airPurchase">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>综合总成本</span><b id="airCombined">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row"><span>单件综合</span><b id="airPerCombined">—</b><span class="ship-card-unit">CNY / 件</span></div>
          </div>
        </div>

        <div class="ship-delta" id="shipDelta">—</div>
      </div>
    </div>`;
}

/**
 * 绑定对比工具输入事件（就地重算，不整页刷新，保留输入焦点）。
 * @param {HTMLElement} root 包含对比工具 DOM 的容器
 * @param {object} state 外部输入状态对象（按引用同步，切回页面时保留）
 * @param {(partial:object)=>void} [persist] 每次输入变更后回调，用于持久化（如保存到 localStorage）
 */
export function bindShipping(root, state, persist) {
  const ids = ['shipL', 'shipW', 'shipH', 'shipWg', 'shipDim', 'shipPurchase',
    'shipSeaMin', 'shipSeaRate', 'shipAirMin', 'shipAirRate', 'shipQty'];

  const syncFromInputs = () => {
    state.length = Number(root.querySelector('#shipL').value);
    state.width = Number(root.querySelector('#shipW').value);
    state.height = Number(root.querySelector('#shipH').value);
    state.weight = Number(root.querySelector('#shipWg').value);
    state.dimFactor = Number(root.querySelector('#shipDim').value);
    state.purchaseCost = Number(root.querySelector('#shipPurchase').value);
    state.seaMin = Number(root.querySelector('#shipSeaMin').value);
    state.seaRate = Number(root.querySelector('#shipSeaRate').value);
    state.airMin = Number(root.querySelector('#shipAirMin').value);
    state.airRate = Number(root.querySelector('#shipAirRate').value);
    state.qty = Number(root.querySelector('#shipQty').value);
  };

  const save = () => { if (typeof persist === 'function') persist({ ...state }); };

  ids.forEach((id) => root.querySelector('#' + id)?.addEventListener('input', () => {
    syncFromInputs();
    save();
    recompute(root);
  }));

  // 模式切换：切换激活态 + 显隐「数量」输入 + 重算（不整页刷新）
  root.querySelectorAll('.ship-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      root.querySelectorAll('.ship-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
      root.querySelector('#shipQtySection')?.classList.toggle('is-hidden', state.mode !== 'custom');
      save();
      recompute(root);
    });
  });

  root.querySelector('#shipReset')?.addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    root.querySelector('#shipL').value = state.length;
    root.querySelector('#shipW').value = state.width;
    root.querySelector('#shipH').value = state.height;
    root.querySelector('#shipWg').value = state.weight;
    root.querySelector('#shipDim').value = state.dimFactor;
    root.querySelector('#shipPurchase').value = state.purchaseCost;
    root.querySelector('#shipSeaMin').value = state.seaMin;
    root.querySelector('#shipSeaRate').value = state.seaRate;
    root.querySelector('#shipAirMin').value = state.airMin;
    root.querySelector('#shipAirRate').value = state.airRate;
    root.querySelector('#shipQty').value = state.qty;
    root.querySelectorAll('.ship-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    root.querySelector('#shipQtySection')?.classList.toggle('is-hidden', state.mode !== 'custom');
    save();
    recompute(root);
  });

  recompute(root);
}

function recompute(root) {
  const mode = root.querySelector('.ship-mode-btn.active')?.dataset.mode || 'auto';
  const r = computeShipping({
    length: root.querySelector('#shipL').value,
    width: root.querySelector('#shipW').value,
    height: root.querySelector('#shipH').value,
    weight: root.querySelector('#shipWg').value,
    dimFactor: root.querySelector('#shipDim').value,
    seaMin: root.querySelector('#shipSeaMin').value,
    seaRate: root.querySelector('#shipSeaRate').value,
    airMin: root.querySelector('#shipAirMin').value,
    airRate: root.querySelector('#shipAirRate').value,
    purchaseCost: root.querySelector('#shipPurchase').value,
    mode,
    qty: root.querySelector('#shipQty').value,
  });

  const errEl = root.querySelector('#shipError');
  const delta = root.querySelector('#shipDelta');

  if (r.error) {
    errEl.textContent = r.error;
    clearResults(root);
    delta.innerHTML = '—';
    return;
  }
  errEl.textContent = '';

  root.querySelector('#rDimW').textContent = fmtKg(r.dimW);
  root.querySelector('#rChargeW').textContent = fmtKg(r.chargeW);

  root.querySelector('#seaQty').textContent = r.sea.qty;
  root.querySelector('#seaW').textContent = fmtKg(r.sea.totalW);
  root.querySelector('#seaTotal').textContent = fmtCNY(r.sea.totalCny);
  root.querySelector('#seaPer').textContent = fmtCNY(r.sea.perCny);
  root.querySelector('#seaPurchase').textContent = fmtCNY(r.sea.purchaseCny);
  root.querySelector('#seaCombined').textContent = fmtCNY(r.sea.combinedCny);
  root.querySelector('#seaPerCombined').textContent = fmtCNY(r.sea.perCombinedCny);

  root.querySelector('#airQty').textContent = r.air.qty;
  root.querySelector('#airW').textContent = fmtKg(r.air.totalW);
  root.querySelector('#airTotal').textContent = fmtCNY(r.air.totalCny);
  root.querySelector('#airPer').textContent = fmtCNY(r.air.perCny);
  root.querySelector('#airPurchase').textContent = fmtCNY(r.air.purchaseCny);
  root.querySelector('#airCombined').textContent = fmtCNY(r.air.combinedCny);
  root.querySelector('#airPerCombined').textContent = fmtCNY(r.air.perCombinedCny);

  // 中性数据行：仅列出两路运费与综合成本及差额，不作任何推荐判断
  delta.innerHTML =
    `运费对比：海运 <b>${fmtCNY(r.sea.totalCny)}</b> ｜ 空运 <b>${fmtCNY(r.air.totalCny)}</b> ｜ 运费差额（空运 − 海运）= <b>${fmtCNY(r.diffShipping)}</b>` +
    `<br>综合对比（含采购）：海运 <b>${fmtCNY(r.sea.combinedCny)}</b> ｜ 空运 <b>${fmtCNY(r.air.combinedCny)}</b> ｜ 综合差额（空运 − 海运）= <b>${fmtCNY(r.diffCombined)}</b>`;
}

function clearResults(root) {
  ['#rDimW', '#rChargeW', '#seaQty', '#seaW', '#seaTotal', '#seaPer', '#seaPurchase', '#seaCombined', '#seaPerCombined',
    '#airQty', '#airW', '#airTotal', '#airPer', '#airPurchase', '#airCombined', '#airPerCombined'].forEach((s) => {
    root.querySelector(s).textContent = '—';
  });
}

function fmtKg(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return (Math.round(n * 1000) / 1000).toString() + ' kg';
}
function fmtCNY(v) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
