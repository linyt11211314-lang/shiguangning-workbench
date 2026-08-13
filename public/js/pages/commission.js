/**
 * 我的提成预估
 * 复刻 Excel「工资分类 / 业绩提成计算」逻辑：
 *   - AE/SA 站点：销售额预估 = 累计销售额 ÷ 已过天数 × 整月天数
 *   - VAT = 销售额预估 × 税点 ÷ (1 + 税点)   （AE 5% / SA 15%）
 *   - 计提成利润 = 整月利润预估 − VAT
 *   - 提成预估 = 计提成利润 × 3%
 *   - 预计总提成 = AE + SA
 *   - 预计到手工资 = 底薪 − 五险一金 + 预计总提成
 *   - 规划可用余额 = 预计到手工资 + 银行卡余额 + 微信余额 − 计划支出
 * 全部数据存 localStorage，输入即实时重算并保存。
 */
import { icon } from '../ui/icons.js';
import { esc, uid } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';

const STORE_KEY = 'sgn.commission.v1';

/** 默认配置（与需求文档一致） */
function defaults() {
  const d = new Date();
  const passed = Math.max(0, d.getDate() - 1); // 当月 1 日至昨天
  const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    aeSales: 0, aeProfit: 0,
    saSales: 0, saProfit: 0,
    passedDays: passed, totalDays: total,
    commissionRate: 3.0,
    aeVatRate: 5.0, saVatRate: 15.0,
    baseSalary: 10000, insurance: 639.58,
    bankBalance: 0, wechatBalance: 0,
    fixedRepay: 1700, dailyExpense: 3500, rent: 1358,
    investment: 2000, saving: 0, reserve: 0,
    records: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    return { ...defaults(), ...data, records: Array.isArray(data.records) ? data.records : [] };
  } catch (_) {
    return defaults();
  }
}

/**
 * 生成最近 n 个月（含当月），格式 2026-08。
 * endOffset=0 → 以当前月为最新；endOffset=1 → 以上月为最新。
 * 默认返回最近 24 个月，数组首项为最新月。
 */
function lastMonths(n, endOffset = 0) {
  const arr = [];
  const now = new Date();
  for (let i = endOffset; i < n + endOffset; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return arr;
}

/** 需要随月份存档/加载的字段（页面所有可输入数据快照） */
const SNAP_KEYS = [
  'aeSales', 'aeProfit', 'saSales', 'saProfit',
  'passedDays', 'totalDays', 'commissionRate', 'aeVatRate', 'saVatRate',
  'baseSalary', 'insurance',
  'bankBalance', 'wechatBalance',
  'fixedRepay', 'dailyExpense', 'rent', 'investment', 'saving', 'reserve',
];

/** ¥ 千分位 + 两位小数；负数显示 −¥ */
function fmt(n) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−¥' : '¥') + s;
}
/** 差额显示：正 +¥ / 负 −¥ */
function diffFmt(d) {
  const s = Math.abs(d).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (d >= 0 ? '+¥' : '−¥') + s;
}

/**
 * 单站点计算
 * @param vatPct 税率（百分比，如 5 或 15）
 */
function computeSite(sales, profit, vatPct, passed, total, ratePct) {
  const denom = total > 0 ? total : 1;
  const salesEst = passed > 0 ? (sales / passed) * denom : 0;
  const profitEst = passed > 0 ? (profit / passed) * denom : 0;
  const vat = salesEst * (vatPct / 100) / (1 + vatPct / 100);
  const commBase = profitEst - vat;
  const commission = commBase * (ratePct / 100);
  return { salesEst, profitEst, vat, commBase, commission };
}

export function render(container, { navigate, rerender }) {
  const state = load();
  // 首次进入时把自动天数落库，避免每次刷新重置
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}

  const g = (k) => Number(state[k]) || 0;

  function recalc() {
    const passed = g('passedDays');
    const total = g('totalDays') || 1;
    const rate = g('commissionRate');
    const ae = computeSite(g('aeSales'), g('aeProfit'), g('aeVatRate'), passed, total, rate);
    const sa = computeSite(g('saSales'), g('saProfit'), g('saVatRate'), passed, total, rate);
    const totalComm = ae.commission + sa.commission;
    const takeHome = g('baseSalary') - g('insurance') + totalComm;
    const planExpense = g('fixedRepay') + g('dailyExpense') + g('rent') + g('investment') + g('saving') + g('reserve');
    const available = takeHome + g('bankBalance') + g('wechatBalance') - planExpense;
    return { ae, sa, totalComm, takeHome, planExpense, available, passed, rate };
  }

  /** 抓取页面当前所有数据作为快照 */
  function snapshot() {
    const s = {};
    for (const k of SNAP_KEYS) s[k] = state[k];
    return s;
  }
  /** 把某月快照灌回页面（加载历史记录时使用） */
  function applySnapshot(s) {
    if (!s) return;
    for (const k of SNAP_KEYS) if (k in s) state[k] = s[k];
    container.querySelectorAll('[data-bind]').forEach((el) => {
      const v = state[el.dataset.bind];
      el.value = (v === '' || v == null) ? '' : v;
    });
    const r = recalc();
    paint(r);
    updateInfoBar();
    const r2 = container.querySelector('#ae-rate2'); if (r2) r2.textContent = `${g('commissionRate')}%`;
    const r3 = container.querySelector('#sa-rate2'); if (r3) r3.textContent = `${g('commissionRate')}%`;
    scheduleSave();
  }

  const set = (id, val) => { const el = container.querySelector('#' + id); if (el) el.textContent = val; };

  /** 当前所选月份的实际 vs 预估差额（从已有记录计算，不新增存储字段） */
  function currentMonthDiff() {
    const monthSel = container.querySelector('[data-month-select]');
    const month = monthSel ? monthSel.value : '';
    const rec = (state.records || []).find((x) => x.month === month);
    if (!rec || rec.actual == null || Number(rec.actual) === 0) return null;
    return Number(rec.actual) - Number(rec.est);
  }

  /** 刷新顶部信息条 */
  function updateInfoBar() {
    const monthSel = container.querySelector('[data-month-select]');
    const month = monthSel ? monthSel.value : '';
    const total = g('totalDays') || 1;
    const passed = g('passedDays');
    const bar = container.querySelector('#comm-info-bar');
    if (bar) bar.textContent = `历史月数据 ${month}-${String(total).padStart(2, '0')} 截止，共 ${passed}/${total} 天 · 不计入当天数据`;
  }

  function paint(r) {
    // 顶部概览
    set('ov-total', fmt(r.totalComm));
    set('ov-total-sub', `AE ${fmt(r.ae.commission)} · SA ${fmt(r.sa.commission)}`);
    set('ov-take', fmt(r.takeHome));
    set('ov-take-sub', `底薪 ${fmt(g('baseSalary'))} − 五险一金 ${fmt(g('insurance'))} + 提成`);
    set('ov-avail', fmt(r.available));
    set('ov-avail-sub', `计划支出 ${fmt(r.planExpense)}`);
    // 实际与预估差额（仅所选月有实际数据时显示）
    const diff = currentMonthDiff();
    set('ov-diff', diff == null ? '—' : diffFmt(diff));
    const diffSub = container.querySelector('#ov-diff-sub');
    if (diffSub) diffSub.textContent = diff == null ? '选择月份并填写实际提成后自动对比' : '该月实际 − 预估';
    // AE 看板
    set('ae-salesEst', fmt(r.ae.salesEst));
    set('ae-profitEst', fmt(r.ae.profitEst));
    set('ae-vat', fmt(r.ae.vat));
    set('ae-base', fmt(r.ae.commBase));
    set('ae-comm', fmt(r.ae.commission));
    set('ae-rate', `${g('commissionRate')}%`);
    // SA 看板
    set('sa-salesEst', fmt(r.sa.salesEst));
    set('sa-profitEst', fmt(r.sa.profitEst));
    set('sa-vat', fmt(r.sa.vat));
    set('sa-base', fmt(r.sa.commBase));
    set('sa-comm', fmt(r.sa.commission));
    set('sa-rate', `${g('commissionRate')}%`);
    // 已过天数提示
    const hint = container.querySelector('#passed-hint');
    if (hint) hint.style.display = r.passed > 0 ? 'none' : 'block';
    // 底部参数
    set('foot-params', `计算参数：提成 ${g('commissionRate')}% · AE VAT ${g('aeVatRate')}% · SA VAT ${g('saVatRate')}%`);
    // 同步信息条
    updateInfoBar();
  }

  // 自动保存状态
  let saveTimer = null;
  function setStatus(kind, text) {
    const el = container.querySelector('#comm-status');
    if (!el) return;
    el.className = 'comm-status comm-status--' + kind;
    el.textContent = text;
  }
  function scheduleSave() {
    setStatus('saving', '🟡 保存中…');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        setStatus('saved', '🟢 本地已保存');
      } catch (e) {
        setStatus('error', '🔴 保存失败，请重试');
        toastError('保存失败，请重试');
      }
    }, 400);
  }

  /** 输入行生成器 */
  function field(key, label, suffix = '') {
    return `
      <div class="field">
        <label class="field-label">${esc(label)}${suffix ? ` <span class="hint">${esc(suffix)}</span>` : ''}</label>
        <input class="input" type="number" inputmode="decimal" step="any" data-bind="${key}" placeholder="0">
      </div>`;
  }

  /** 单站点看板 HTML */
  function siteCard(prefix, flag, name, accent) {
    return `
      <div class="card card-pad site-card site-card-${accent}">
        <div class="section-head">
          <div class="site-flag">${flag}</div>
          <div>
            <div class="section-title">${name}</div>
            <div class="section-sub">填写截至统计日的累计数据</div>
          </div>
          <span style="flex:1"></span>
          <span class="vat-badge" id="${prefix}-rate">${prefix === 'ae' ? '5.0%' : '15.0%'} VAT</span>
        </div>
        <div class="form-grid">
          ${field(prefix + 'Sales', '当前累计销售额')}
          ${field(prefix + 'Profit', '当前累计利润')}
        </div>
        <div class="site-flow">
          <div class="sf-item">
            <span class="sf-label">销售额预估</span>
            <b class="sf-value" id="${prefix}-salesEst">¥0.00</b>
          </div>
          <span class="sf-arrow">→</span>
          <div class="sf-item">
            <span class="sf-label">整月利润预估</span>
            <b class="sf-value" id="${prefix}-profitEst">¥0.00</b>
          </div>
          <span class="sf-arrow">→</span>
          <div class="sf-item">
            <span class="sf-label">VAT</span>
            <b class="sf-value" id="${prefix}-vat">¥0.00</b>
          </div>
        </div>
        <div class="site-result-bar">
          <div class="sr-block sr-dark">
            <span>计提利润</span>
            <b id="${prefix}-base">¥0.00</b>
          </div>
          <div class="sr-block sr-accent">
            <span>提成预估</span>
            <b id="${prefix}-comm">¥0.00</b>
          </div>
        </div>
        <div class="site-foot">填写截至统计日的累计数据 · 提成 <span id="${prefix}-rate2"></span></div>
      </div>`;
  }

  const defaultMonth = lastMonths(24)[1]; // 默认选中上个月

  container.innerHTML = `
    <!-- 页面头部 -->
    <div class="comm-page-header">
      <div></div>
      <div class="comm-header-actions">
        <div class="comm-status comm-status--saved" id="comm-status">🟢 本地已保存</div>
        <select class="input input-sm month-select" data-month-select>
          ${lastMonths(24).map((m) => `<option value="${m}"${m === defaultMonth ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" data-save-month>${icon('save')} 保存本月记录</button>
      </div>
    </div>

    <!-- 信息条 -->
    <div class="comm-info-bar" id="comm-info-bar">历史月数据 ${defaultMonth}-31 截止，共 0/31 天 · 不计入当天数据</div>

    <!-- 顶部概览 -->
    <div class="ov-row">
      <div class="ov-card ov-card-green">
        <div class="ov-label">预计总提成</div>
        <div class="ov-value" id="ov-total">¥0.00</div>
        <div class="ov-sub" id="ov-total-sub">AE ¥0.00 · SA ¥0.00</div>
      </div>
      <div class="ov-card ov-card-blue">
        <div class="ov-label">预计到手工资</div>
        <div class="ov-value" id="ov-take">¥0.00</div>
        <div class="ov-sub" id="ov-take-sub">底薪 − 五险一金 + 提成</div>
      </div>
      <div class="ov-card ov-card-orange">
        <div class="ov-label">规划可用余额</div>
        <div class="ov-value" id="ov-avail">¥0.00</div>
        <div class="ov-sub" id="ov-avail-sub">计划支出 ¥0.00</div>
      </div>
      <div class="ov-card ov-card-pink">
        <div class="ov-label">实际与预估差额</div>
        <div class="ov-value" id="ov-diff">—</div>
        <div class="ov-sub" id="ov-diff-sub">选择月份并填写实际提成后自动对比</div>
      </div>
    </div>

    <!-- 双站点看板 -->
    <div class="site-grid">
      ${siteCard('ae', 'AE', 'AE 站点', 'blue')}
      ${siteCard('sa', 'SA', 'SA 站点', 'orange')}
    </div>

    <!-- 计算参数 + 工资规划 -->
    <div class="plan-grid">
      <div class="card card-pad plan-card">
        <div class="section-head">
          <div class="section-title">计算参数</div>
          <span style="flex:1"></span>
          <span class="tag tag-blue">实时生效</span>
        </div>
        <div class="form-grid">
          ${field('passedDays', '当月已过天数', '1日~昨天')}
          ${field('totalDays', '当月总天数', '自动')}
          ${field('commissionRate', '提成比例', '%')}
          ${field('aeVatRate', 'AE VAT 税率', '%')}
          ${field('saVatRate', 'SA VAT 税率', '%')}
          ${field('baseSalary', '底薪', '¥')}
          ${field('insurance', '五险一金', '¥')}
        </div>
        <div class="field-tip" id="passed-hint" style="display:none;color:var(--red)">⚠️ 已过天数为 0，请先填写截至统计日（或手动修改天数）</div>
      </div>

      <div class="card card-pad plan-card">
        <div class="section-head">
          <div class="section-title">工资与规划</div>
          <span style="flex:1"></span>
          <span class="tag tag-green">影响可用余额</span>
        </div>
        <div class="form-grid">
          ${field('bankBalance', '银行卡现有金额', '¥')}
          ${field('wechatBalance', '微信现有金额', '¥')}
          ${field('fixedRepay', '固定还款', '¥')}
          ${field('dailyExpense', '日常开销', '¥')}
          ${field('rent', '房租', '¥')}
          ${field('investment', '投资', '¥')}
          ${field('saving', '存钱', '¥')}
          ${field('reserve', '备用金', '¥')}
        </div>
        <div class="field-tip">计划支出 = 固定还款 + 日常开销 + 房租 + 投资 + 存钱 + 备用金</div>
      </div>
    </div>

    <!-- 月度记录与趋势 -->
    <div class="card card-pad comm-records-card">
      <div class="section-head">
        <div class="section-title">📈 月度记录与趋势</div>
        <span style="flex:1"></span>
        <button class="btn btn-soft btn-sm" data-export>${icon('download')} 导出历史数据</button>
      </div>
      <div class="field-tip" style="margin-bottom:12px">选择任意月份并保存，预计与实际提成会在这里对比；实际提成公布后直接填写即可自动算差额。点击记录行可把该月数据加载回页面。</div>
      <div data-records></div>
    </div>

    <!-- 底部状态栏 -->
    <div class="comm-footer">
      <span id="foot-params">计算参数：提成 3.0% · AE VAT 5.0% · SA VAT 15.0%</span>
      <span style="flex:1"></span>
      <span class="comm-footer-dev">产品开发者 · 本地已保存</span>
    </div>
  `;

  // 初始化输入值
  container.querySelectorAll('[data-bind]').forEach((el) => {
    const v = state[el.dataset.bind];
    el.value = (v === '' || v == null) ? '' : v;
  });
  // 站点看板底部费率回显
  container.querySelector('#ae-rate2').textContent = '3.0%';
  container.querySelector('#sa-rate2').textContent = '3.0%';

  function renderRecords() {
    const box = container.querySelector('[data-records]');
    if (!state.records.length) {
      box.innerHTML = `
        <div class="empty-state" style="padding:30px 20px">
          <div class="empty-icon">${icon('calendar')}</div>
          <div class="empty-title">暂无月度记录</div>
          <div class="empty-sub">选择月份后点击「保存该月数据」把当前预计提成归档</div>
        </div>`;
      return;
    }
    box.innerHTML = `
      <table class="comm-table">
        <thead>
          <tr><th>月份</th><th>预计提成</th><th>实际提成</th><th>差额</th><th></th></tr>
        </thead>
        <tbody>
          ${state.records.map((r) => {
            const diff = r.actual - r.est;
            const cls = diff >= 0 ? 'pos' : 'neg';
            return `
            <tr data-load="${r.id}" title="点击加载该月数据">
              <td class="mono">${esc(r.month)}</td>
              <td class="mono">${fmt(r.est)}</td>
              <td><input class="input input-sm comm-actual" type="number" inputmode="decimal" step="any" data-actual="${r.id}" value="${r.actual == null ? 0 : r.actual}"></td>
              <td class="mono ${cls}" data-diff="${r.id}">${diffFmt(diff)}</td>
              <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-del="${r.id}" title="删除">${icon('trash')}</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // 初始绘制
  paint(recalc());
  renderRecords();

  // 实时输入 → 重算 + 保存
  container.addEventListener('input', (e) => {
    const bindEl = e.target.closest('[data-bind]');
    if (bindEl) {
      const k = bindEl.dataset.bind;
      state[k] = bindEl.value === '' ? '' : Number(bindEl.value);
      const r = recalc();
      paint(r);
      // 站点卡片底部费率同步
      container.querySelector('#ae-rate2').textContent = `${g('commissionRate')}%`;
      container.querySelector('#sa-rate2').textContent = `${g('commissionRate')}%`;
      scheduleSave();
      return;
    }
    const actEl = e.target.closest('[data-actual]');
    if (actEl) {
      const rec = state.records.find((x) => x.id === actEl.dataset.actual);
      if (rec) {
        rec.actual = actEl.value === '' ? 0 : Number(actEl.value);
        const diff = rec.actual - rec.est;
        const dEl = container.querySelector(`[data-diff="${rec.id}"]`);
        if (dEl) { dEl.textContent = diffFmt(diff); dEl.className = 'mono ' + (diff >= 0 ? 'pos' : 'neg'); }
        // 同步刷新顶部差额卡（如果当前所选月就是该记录月）
        const ms = container.querySelector('[data-month-select]');
        if (ms && ms.value === rec.month) paint(recalc());
        scheduleSave();
      }
      return;
    }
  });

  // 月份选择器切换时刷新信息条与差额卡
  const monthSelect = container.querySelector('[data-month-select]');
  if (monthSelect) {
    monthSelect.addEventListener('change', () => {
      updateInfoBar();
      paint(recalc());
    });
  }

  // 删除 / 加载月度记录
  container.addEventListener('click', (e) => {
    const delEl = e.target.closest('[data-del]');
    if (delEl) {
      const id = delEl.dataset.del;
      state.records = state.records.filter((x) => x.id !== id);
      renderRecords();
      scheduleSave();
      return;
    }
    // 点击记录行加载该月数据（忽略表格内的输入框/按钮）
    const loadEl = e.target.closest('[data-load]');
    if (loadEl && !e.target.closest('input, button')) {
      const rec = state.records.find((x) => x.id === loadEl.dataset.load);
      if (rec && rec.snapshot) {
        applySnapshot(rec.snapshot);
        const ms = container.querySelector('[data-month-select]');
        if (ms) ms.value = rec.month;
        toastInfo(`已加载 ${rec.month} 的数据，可修改后重新保存`);
      }
      return;
    }
  });

  // 保存所选月份（支持任意月份 + 覆盖确认）
  container.querySelector('[data-save-month]').addEventListener('click', () => {
    const monthSel = container.querySelector('[data-month-select]');
    const month = monthSel ? monthSel.value : (() => {
      const n = new Date();
      return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
    })();
    const r = recalc();
    const est = Math.round(r.totalComm * 100) / 100;
    const ex = state.records.find((x) => x.month === month);
    const doSave = () => {
      if (ex) {
        ex.est = est;
        ex.snapshot = snapshot();
      } else {
        state.records.unshift({ id: uid('rec'), month, est, actual: 0, snapshot: snapshot() });
      }
      state.records.sort((a, b) => b.month.localeCompare(a.month));
      renderRecords();
      scheduleSave();
      toastSuccess(`✅ ${month} 数据已保存`);
      // 保存后刷新差额卡
      paint(r);
    };
    if (ex) {
      confirmDialog({
        title: '⚠️ 月份已存在',
        message: `${month} 已有保存记录，是否覆盖？\n覆盖后将用当前页面数据替换该月记录。`,
        confirmText: '覆盖',
        danger: true,
        onConfirm: doSave,
      });
    } else {
      doSave();
    }
  });

  // 导出历史数据
  container.querySelector('[data-export]').addEventListener('click', () => {
    const X = window.XLSX;
    if (!X) { toastError('导出组件未加载，请刷新后重试'); return; }
    if (!state.records.length) { toastInfo('暂无记录可导出'); return; }
    const rows = state.records.map((rr) => ({
      '月份': rr.month,
      '预计提成(¥)': Math.round(rr.est * 100) / 100,
      '实际提成(¥)': Math.round(rr.actual * 100) / 100,
      '差额(¥)': Math.round((rr.actual - rr.est) * 100) / 100,
    }));
    try {
      const ws = X.utils.json_to_sheet(rows);
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, '提成历史');
      X.writeFile(wb, `提成历史_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toastSuccess('已导出历史数据');
    } catch (err) {
      toastError('导出失败：' + (err && err.message ? err.message : '未知错误'));
    }
  });
}
