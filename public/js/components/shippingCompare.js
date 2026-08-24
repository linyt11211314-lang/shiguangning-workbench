/**
 * 海运空运成本对比（内联页，作为「利润看板」的次导航页面）
 *
 * 输入：
 *   length / width / height  单件尺寸（cm）
 *   weight                  单件实重（kg）
 *   dimFactor               泡重系数（5000 / 6000，默认 5000）
 *   seaMin / seaRate        海运：起收重量(kg) / 单价(CNY/kg)
 *   airMin / airRate        空运：起收重量(kg) / 单价(CNY/kg)
 *
 * 计算：
 *   dimW      = L*W*H / dimFactor           单件体积重
 *   chargeW   = max(weight, dimW)           单件计费重
 *   qty       = ceil(minWeight / chargeW)  满足起收重量的最少件数
 *   billW     = max(chargeW * qty, min)     实际计费重量（按起收取最大值）
 *   totalCny  = billW * rate                运费总额（CNY）
 *   perCny    = totalCny / qty              单件均摊
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
 * }} input
 */
export function computeShipping(input) {
  const length = num(input.length);
  const width = num(input.width);
  const height = num(input.height);
  const weight = num(input.weight);
  const dimFactor = num(input.dimFactor, 5000);

  if (!isValidPos(length) || !isValidPos(width) || !isValidPos(height)) {
    return { error: '请填写完整的长 / 宽 / 高（需 > 0）' };
  }
  if (!isValidPos(weight)) {
    return { error: '请填写单件实重（kg，需 > 0）' };
  }
  if (!isValidPos(dimFactor)) {
    return { error: '泡重系数无效（需 > 0）' };
  }
  const seaMin = num(input.seaMin);
  const seaRate = num(input.seaRate);
  const airMin = num(input.airMin);
  const airRate = num(input.airRate);
  if (seaMin < 0 || airMin < 0) return { error: '起收重量不能为负' };
  if (seaRate < 0 || airRate < 0) return { error: '单价不能为负' };

  const dimW = round3((length * width * height) / dimFactor);
  const chargeW = round3(Math.max(weight, dimW));

  function leg(min, rate) {
    const qty = min <= 0 ? 1 : Math.max(1, Math.ceil(min / chargeW));
    const totalW = round3(Math.max(chargeW * qty, min));
    const totalCny = round3(totalW * rate);
    const perCny = round3(totalCny / qty);
    return { qty, totalW, totalCny, perCny };
  }

  const sea = leg(seaMin, seaRate);
  const air = leg(airMin, airRate);

  // 仅为数据输出保留原始差额（不另作推荐判断）
  const diff = round3(sea.totalCny - air.totalCny);

  return {
    dimW,
    chargeW,
    sea,
    air,
    diff, // 海运运费 − 空运运费（仅作数据展示，正数表示空运更贵）
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
};

/**
 * 渲染对比工具的内联 HTML（输入面板 + 结果面板，仅输出数据）。
 * @param {object} d 当前输入状态（含默认值的对象）
 */
export function renderShippingCompare(d = {}) {
  const s = { ...DEFAULTS, ...d };
  return `
    <div class="ship-grid">
      <div class="ship-panel ship-panel-input">
        <div class="ship-panel-title">📦 产品 & 渠道参数</div>

        <div class="ship-section">
          <div class="ship-section-label">单件尺寸（cm） & 重量</div>
          <div class="ship-row4">
            <label>长 <input type="number" id="shipL" value="${s.length}" min="0" step="0.1"></label>
            <label>宽 <input type="number" id="shipW" value="${s.width}" min="0" step="0.1"></label>
            <label>高 <input type="number" id="shipH" value="${s.height}" min="0" step="0.1"></label>
            <label>实重 kg <input type="number" id="shipWg" value="${s.weight}" min="0" step="0.001"></label>
          </div>
          <div class="ship-row1">
            <label>泡重系数
              <select id="shipDim" class="ship-select">
                <option value="5000"${s.dimFactor == 5000 ? ' selected' : ''}>5000（标准）</option>
                <option value="6000"${s.dimFactor == 6000 ? ' selected' : ''}>6000（宽松）</option>
              </select>
            </label>
          </div>
          <div class="ship-hint">体积重 = 长 × 宽 × 高 ÷ 泡重系数，计费重取实重与体积重较大者</div>
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
            <div class="ship-card-row"><span>起收数量</span><b id="seaQty">—</b><span class="ship-card-unit">件</span></div>
            <div class="ship-card-row"><span>实际计费重</span><b id="seaW">—</b><span class="ship-card-unit">kg</span></div>
            <div class="ship-card-row"><span>运费总额</span><b class="ship-card-em" id="seaTotal">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row ship-card-row-2"><span>单件均摊</span><b id="seaPer">—</b><span class="ship-card-unit">CNY / 件</span></div>
          </div>

          <div class="ship-card" id="cardAir">
            <div class="ship-card-head">
              <span class="ship-card-ico">✈️</span>
              <span class="ship-card-name">空运</span>
            </div>
            <div class="ship-card-row"><span>起收数量</span><b id="airQty">—</b><span class="ship-card-unit">件</span></div>
            <div class="ship-card-row"><span>实际计费重</span><b id="airW">—</b><span class="ship-card-unit">kg</span></div>
            <div class="ship-card-row"><span>运费总额</span><b class="ship-card-em" id="airTotal">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row ship-card-row-2"><span>单件均摊</span><b id="airPer">—</b><span class="ship-card-unit">CNY / 件</span></div>
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
 */
export function bindShipping(root, state) {
  const ids = ['shipL', 'shipW', 'shipH', 'shipWg', 'shipDim',
    'shipSeaMin', 'shipSeaRate', 'shipAirMin', 'shipAirRate'];

  const syncFromInputs = () => {
    state.length = Number(root.querySelector('#shipL').value);
    state.width = Number(root.querySelector('#shipW').value);
    state.height = Number(root.querySelector('#shipH').value);
    state.weight = Number(root.querySelector('#shipWg').value);
    state.dimFactor = Number(root.querySelector('#shipDim').value);
    state.seaMin = Number(root.querySelector('#shipSeaMin').value);
    state.seaRate = Number(root.querySelector('#shipSeaRate').value);
    state.airMin = Number(root.querySelector('#shipAirMin').value);
    state.airRate = Number(root.querySelector('#shipAirRate').value);
  };

  ids.forEach((id) => root.querySelector('#' + id)?.addEventListener('input', () => {
    syncFromInputs();
    recompute(root);
  }));

  root.querySelector('#shipReset')?.addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    root.querySelector('#shipL').value = state.length;
    root.querySelector('#shipW').value = state.width;
    root.querySelector('#shipH').value = state.height;
    root.querySelector('#shipWg').value = state.weight;
    root.querySelector('#shipDim').value = state.dimFactor;
    root.querySelector('#shipSeaMin').value = state.seaMin;
    root.querySelector('#shipSeaRate').value = state.seaRate;
    root.querySelector('#shipAirMin').value = state.airMin;
    root.querySelector('#shipAirRate').value = state.airRate;
    recompute(root);
  });

  recompute(root);
}

function recompute(root) {
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
  });

  const errEl = root.querySelector('#shipError');
  const delta = root.querySelector('#shipDelta');

  if (r.error) {
    errEl.textContent = r.error;
    clearResults(root);
    delta.textContent = '—';
    return;
  }
  errEl.textContent = '';

  root.querySelector('#rDimW').textContent = fmtKg(r.dimW);
  root.querySelector('#rChargeW').textContent = fmtKg(r.chargeW);

  root.querySelector('#seaQty').textContent = r.sea.qty;
  root.querySelector('#seaW').textContent = fmtKg(r.sea.totalW);
  root.querySelector('#seaTotal').textContent = fmtCNY(r.sea.totalCny);
  root.querySelector('#seaPer').textContent = fmtCNY(r.sea.perCny);

  root.querySelector('#airQty').textContent = r.air.qty;
  root.querySelector('#airW').textContent = fmtKg(r.air.totalW);
  root.querySelector('#airTotal').textContent = fmtCNY(r.air.totalCny);
  root.querySelector('#airPer').textContent = fmtCNY(r.air.perCny);

  // 中性数据行：仅列出两路运费与差额，不作任何推荐判断
  delta.innerHTML = `运费对比：海运 <b>${fmtCNY(r.sea.totalCny)}</b> ｜ 空运 <b>${fmtCNY(r.air.totalCny)}</b> ｜ 差额（空运 − 海运） = <b>${fmtCNY(r.diff)}</b>`;
}

function clearResults(root) {
  ['#rDimW', '#rChargeW', '#seaQty', '#seaW', '#seaTotal', '#seaPer',
    '#airQty', '#airW', '#airTotal', '#airPer'].forEach((s) => {
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
