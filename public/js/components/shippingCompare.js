/**
 * 海运空运成本对比
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
 * 返回 null 表示输入不合法（返回 error 字段说明原因）。
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

  // 对比结论
  const diff = round3(sea.totalCny - air.totalCny);
  const cheaper = diff === 0 ? 'same' : diff > 0 ? 'air' : 'sea'; // diff>0 海运贵，空运便宜
  const savedAbs = round3(Math.abs(diff));
  const cheaperTotal = Math.min(sea.totalCny, air.totalCny);
  const savedPct = cheaperTotal > 0 ? round3(savedAbs / cheaperTotal) : 0;

  return {
    dimW,
    chargeW,
    sea,
    air,
    diff,
    cheaper, // 'sea' | 'air' | 'same'
    savedAbs,
    savedPct,
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/* ============================================================
 * UI：渲染 modal
 * ============================================================ */
import { openModal } from '../ui/modal.js';
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';

const DEFAULTS = {
  length: 40, width: 30, height: 20, weight: 2,
  dimFactor: 5000,
  seaMin: 21, seaRate: 12,
  airMin: 21, airRate: 38,
};

export function openShippingCompare(initial = {}) {
  const data = { ...DEFAULTS, ...initial };
  const root = document.createElement('div');
  root.className = 'ship-modal-root';

  const m = openModal({
    title: '海运空运成本对比',
    body: root,
    width: 'wide',
  });

  root.innerHTML = buildHtml(data);
  bind(root, m);
  recompute(root);
  return m;
}

function buildHtml(d) {
  return `
    <div class="ship-grid">
      <div class="ship-panel ship-panel-input">
        <div class="ship-panel-title">📦 产品 & 渠道参数</div>

        <div class="ship-section">
          <div class="ship-section-label">单件尺寸（cm） & 重量</div>
          <div class="ship-row4">
            <label>长 <input type="number" id="shipL" value="${d.length}" min="0" step="0.1"></label>
            <label>宽 <input type="number" id="shipW" value="${d.width}" min="0" step="0.1"></label>
            <label>高 <input type="number" id="shipH" value="${d.height}" min="0" step="0.1"></label>
            <label>实重 kg <input type="number" id="shipWg" value="${d.weight}" min="0" step="0.001"></label>
          </div>
          <div class="ship-row1">
            <label>泡重系数
              <select id="shipDim" class="ship-select">
                <option value="5000"${d.dimFactor == 5000 ? ' selected' : ''}>5000（标准）</option>
                <option value="6000"${d.dimFactor == 6000 ? ' selected' : ''}>6000（宽松）</option>
              </select>
            </label>
          </div>
          <div class="ship-hint">体积重 = 长 × 宽 × 高 ÷ 泡重系数，计费重取实重与体积重较大者</div>
        </div>

        <div class="ship-section">
          <div class="ship-section-label">🚢 海运</div>
          <div class="ship-row2">
            <label>起收重量 kg <input type="number" id="shipSeaMin" value="${d.seaMin}" min="0" step="0.1"></label>
            <label>单价 CNY/kg <input type="number" id="shipSeaRate" value="${d.seaRate}" min="0" step="0.1"></label>
          </div>
        </div>

        <div class="ship-section">
          <div class="ship-section-label">✈️ 空运</div>
          <div class="ship-row2">
            <label>起收重量 kg <input type="number" id="shipAirMin" value="${d.airMin}" min="0" step="0.1"></label>
            <label>单价 CNY/kg <input type="number" id="shipAirRate" value="${d.airRate}" min="0" step="0.1"></label>
          </div>
        </div>

        <div class="ship-actions">
          <button class="btn btn-ghost btn-sm" id="shipReset">恢复默认</button>
          <span class="ship-spacer"></span>
          <span class="ship-error" id="shipError"></span>
        </div>
      </div>

      <div class="ship-panel ship-panel-result">
        <div class="ship-panel-title">📊 对比结果</div>

        <div class="ship-base">
          <span class="ship-base-item"><span class="ship-base-label">单件体积重</span><b id="rDimW">—</b></span>
          <span class="ship-base-item"><span class="ship-base-label">单件计费重</span><b id="rChargeW">—</b></span>
        </div>

        <div class="ship-compare">
          <div class="ship-card" id="cardSea">
            <div class="ship-card-head">
              <span class="ship-card-ico">🚢</span>
              <span class="ship-card-name">海运</span>
              <span class="ship-card-tag" id="seaTag"></span>
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
              <span class="ship-card-tag" id="airTag"></span>
            </div>
            <div class="ship-card-row"><span>起收数量</span><b id="airQty">—</b><span class="ship-card-unit">件</span></div>
            <div class="ship-card-row"><span>实际计费重</span><b id="airW">—</b><span class="ship-card-unit">kg</span></div>
            <div class="ship-card-row"><span>运费总额</span><b class="ship-card-em" id="airTotal">—</b><span class="ship-card-unit">CNY</span></div>
            <div class="ship-card-row ship-card-row-2"><span>单件均摊</span><b id="airPer">—</b><span class="ship-card-unit">CNY / 件</span></div>
          </div>
        </div>

        <div class="ship-verdict" id="shipVerdict">—</div>
      </div>
    </div>`;
}

function bind(root, m) {
  const ids = ['shipL', 'shipW', 'shipH', 'shipWg', 'shipDim',
               'shipSeaMin', 'shipSeaRate', 'shipAirMin', 'shipAirRate'];
  const handler = () => recompute(root);
  ids.forEach((id) => root.querySelector('#' + id).addEventListener('input', handler));
  root.querySelector('#shipReset').addEventListener('click', () => {
    for (const id of ids) {
      const el = root.querySelector('#' + id);
      const def = DEFAULTS[id === 'shipL' ? 'length'
        : id === 'shipW' ? 'width'
        : id === 'shipH' ? 'height'
        : id === 'shipWg' ? 'weight'
        : id === 'shipDim' ? 'dimFactor'
        : id === 'shipSeaMin' ? 'seaMin'
        : id === 'shipSeaRate' ? 'seaRate'
        : id === 'shipAirMin' ? 'airMin'
        : 'airRate'];
      el.value = def;
    }
    recompute(root);
  });
}

function readInputs(root) {
  const v = (id) => root.querySelector('#' + id).value;
  return {
    length: v('shipL'),
    width: v('shipW'),
    height: v('shipH'),
    weight: v('shipWg'),
    dimFactor: v('shipDim'),
    seaMin: v('shipSeaMin'),
    seaRate: v('shipSeaRate'),
    airMin: v('shipAirMin'),
    airRate: v('shipAirRate'),
  };
}

function recompute(root) {
  const r = computeShipping(readInputs(root));
  const errEl = root.querySelector('#shipError');
  if (r.error) {
    errEl.textContent = r.error;
    clearResults(root);
    root.querySelector('#shipVerdict').textContent = '—';
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

  const cardSea = root.querySelector('#cardSea');
  const cardAir = root.querySelector('#cardAir');
  const seaTag = root.querySelector('#seaTag');
  const airTag = root.querySelector('#airTag');
  cardSea.classList.remove('is-winner', 'is-loser', 'is-tie');
  cardAir.classList.remove('is-winner', 'is-loser', 'is-tie');
  seaTag.textContent = '';
  airTag.textContent = '';

  const verdict = root.querySelector('#shipVerdict');
  if (r.cheaper === 'same') {
    cardSea.classList.add('is-tie'); cardAir.classList.add('is-tie');
    seaTag.textContent = '持平'; airTag.textContent = '持平';
    verdict.innerHTML = `两边运费一致：<b>${fmtCNY(r.sea.totalCny)}</b>`;
    verdict.className = 'ship-verdict ship-verdict-tie';
  } else if (r.cheaper === 'air') {
    cardAir.classList.add('is-winner'); cardSea.classList.add('is-loser');
    airTag.textContent = '✓ 推荐';
    seaTag.textContent = '偏高';
    verdict.innerHTML = `✈️ 空运更划算 — 比海运便宜 <b>${fmtCNY(r.savedAbs)}</b>（节省 ${(r.savedPct * 100).toFixed(1)}%）`;
    verdict.className = 'ship-verdict ship-verdict-good';
  } else {
    cardSea.classList.add('is-winner'); cardAir.classList.add('is-loser');
    seaTag.textContent = '✓ 推荐';
    airTag.textContent = '偏高';
    verdict.innerHTML = `🚢 海运更划算 — 比空运便宜 <b>${fmtCNY(r.savedAbs)}</b>（节省 ${(r.savedPct * 100).toFixed(1)}%）`;
    verdict.className = 'ship-verdict ship-verdict-good';
  }
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
