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

  const set = (id, val) => { const el = container.querySelector('#' + id); if (el) el.textContent = val; };

  function paint(r) {
    // 顶部概览
    set('ov-total', fmt(r.totalComm));
    set('ov-total-sub', `AE ${fmt(r.ae.commission)} · SA ${fmt(r.sa.commission)}`);
    set('ov-take', fmt(r.takeHome));
    set('ov-take-sub', `底薪 ${fmt(g('baseSalary'))} − 五险一金 ${fmt(g('insurance'))} + 提成`);
    set('ov-avail', fmt(r.available));
    set('ov-avail-sub', `计划支出 ${fmt(r.planExpense)}`);
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
  function siteCard(prefix, flag, name) {
    return `
      <div class="card card-pad site-card">
        <div class="section-head">
          <div class="site-flag">${flag}</div>
          <div class="section-title">${name}</div>
          <span style="flex:1"></span>
          <span class="rate-badge" id="${prefix}-rate">3.0%</span>
        </div>
        <div class="form-grid">
          ${field(prefix + 'Sales', '当前累计销售额', '¥')}
          ${field(prefix + 'Profit', '当前累计利润', '¥')}
        </div>
        <div class="site-stats">
          <div class="ss-row"><span>销售额预估</span><b id="${prefix}-salesEst">¥0.00</b></div>
          <div class="ss-row"><span>整月利润预估</span><b id="${prefix}-profitEst">¥0.00</b></div>
          <div class="ss-row"><span>VAT</span><b id="${prefix}-vat">¥0.00</b></div>
          <div class="ss-row"><span>计提成利润</span><b id="${prefix}-base">¥0.00</b></div>
          <div class="ss-row ss-strong"><span>提成预估</span><b id="${prefix}-comm">¥0.00</b></div>
        </div>
        <div class="site-foot">填写截至统计日的累计数据 · 提成 <span id="${prefix}-rate2"></span></div>
      </div>`;
  }

  container.innerHTML = `
    <div class="comm-intro">
      <div class="comm-intro-icon">${icon('target')}</div>
      <div>
        <div class="comm-intro-title">我的提成预估</div>
        <div class="comm-intro-sub">按昨天以前的完整数据推算提成 · 所有数据本地保存</div>
      </div>
      <span style="flex:1"></span>
      <span class="comm-status comm-status--saved" id="comm-status">🟢 本地已保存</span>
    </div>

    <!-- 顶部概览 -->
    <div class="ov-row">
      <div class="ov-card ov-primary">
        <div class="ov-icon" style="background:linear-gradient(135deg,var(--grad-a1),var(--grad-a2));color:var(--grad-afg)">${icon('chart')}</div>
        <div class="ov-label">预计总提成</div>
        <div class="ov-value" id="ov-total">¥0.00</div>
        <div class="ov-sub" id="ov-total-sub">AE ¥0.00 · SA ¥0.00</div>
      </div>
      <div class="ov-card ov-green">
        <div class="ov-icon" style="background:linear-gradient(135deg,var(--grad-g1),var(--grad-g2));color:var(--grad-gfg)">${icon('briefcase')}</div>
        <div class="ov-label">预计到手工资</div>
        <div class="ov-value" id="ov-take">¥0.00</div>
        <div class="ov-sub" id="ov-take-sub">底薪 − 五险一金 + 提成</div>
      </div>
      <div class="ov-card ov-blue">
        <div class="ov-icon" style="background:linear-gradient(135deg,var(--grad-b1),var(--grad-b2));color:var(--grad-bfg)">${icon('database')}</div>
        <div class="ov-label">规划可用余额</div>
        <div class="ov-value" id="ov-avail">¥0.00</div>
        <div class="ov-sub" id="ov-avail-sub">计划支出 ¥0.00</div>
      </div>
    </div>

    <!-- 双站点看板 -->
    <div class="site-grid">
      ${siteCard('ae', '🇦🇪', 'AE 站点')}
      ${siteCard('sa', '🇸🇦', 'SA 站点')}
    </div>

    <!-- 计算参数 + 工资规划 -->
    <div class="plan-grid">
      <div class="card card-pad">
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

      <div class="card card-pad">
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
    <div class="card card-pad">
      <div class="section-head">
        <div class="section-title">📈 月度记录与趋势</div>
        <span style="flex:1"></span>
        <button class="btn btn-primary btn-sm" data-save-month>${icon('save')} 保存当前月份</button>
        <button class="btn btn-soft btn-sm" data-export>${icon('download')} 导出历史数据</button>
      </div>
      <div class="field-tip" style="margin-bottom:12px">保存月份后，预计与实际提成会在这里对比；实际提成公布后直接填写即可自动算差额。</div>
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
          <div class="empty-sub">点击「保存当前月份」把当前预计提成归档</div>
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
            <tr>
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
        scheduleSave();
      }
      return;
    }
  });

  // 删除月度记录
  container.addEventListener('click', (e) => {
    const delEl = e.target.closest('[data-del]');
    if (delEl) {
      const id = delEl.dataset.del;
      state.records = state.records.filter((x) => x.id !== id);
      renderRecords();
      scheduleSave();
    }
  });

  // 保存当前月份
  container.querySelector('[data-save-month]').addEventListener('click', () => {
    const r = recalc();
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const est = Math.round(r.totalComm * 100) / 100;
    const ex = state.records.find((x) => x.month === month);
    if (ex) ex.est = est;
    else state.records.unshift({ id: uid('rec'), month, est, actual: 0 });
    state.records.sort((a, b) => b.month.localeCompare(a.month));
    renderRecords();
    scheduleSave();
    toastSuccess(`已保存 ${month} 预计提成 ${fmt(est)}`);
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
