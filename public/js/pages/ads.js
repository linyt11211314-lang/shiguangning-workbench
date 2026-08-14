/**
 * 广告诊断页
 * 第一阶段：数据导入与解析（领星 Excel/CSV → 字段映射 → 预览 → 去重存储）
 * 第二阶段：数据看板与趋势展示（概览 / 趋势折线图 / AE·SA 双站点对比 / 明细表联动）
 */
import { icon } from '../ui/icons.js';
import { esc, copyText } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import { renderLineChart } from '../ui/lineChart.js';
import { STORAGE_KEYS } from '../config.js';
import {
  listRecords,
  listImports,
  upsertRecords,
  clearAll,
  removeImport,
} from '../store/adsStore.js';
import {
  FIELD_DEFS,
  readWorkbook,
  detectFields,
  buildRecords,
  validateMapping,
} from '../services/adParse.js';
import {
  diagnose,
  suggestionToText,
  buildPauseList,
  pauseListToCSV,
  pauseListToText,
  computeSiteMetrics,
} from '../services/diagnose.js';
import {
  highlightTerms,
  buildKnowledgeCard,
  termForRule,
  GLOSSARY,
  TERM_ORDER,
} from '../services/knowledge.js';
import {
  markTerm,
  isMastered,
  learnedCount,
  lastLearned,
  levelLabel,
  masteredList,
} from '../store/learningStore.js';
import {
  addFeedback,
  listFeedback,
  feedbackStats,
  latestFeedback,
  feedbackById,
} from '../store/feedbackStore.js';

const MAX_FILE_MB = 10;
const ACCEPT = '.xlsx,.xls,.csv';
const PREVIEW_LIMIT = 50;

// —— 看板时间范围（模块级，跨重渲染保持）——
let viewRange = '7d'; // '7d' | '30d' | 'custom'
let viewStart = null; // 'YYYY-MM-DD'
let viewEnd = null;

// —— 诊断面板状态（模块级，跨重渲染保持）——
let isDiagnosing = false; // 刷新诊断时的加载态
let currentSuggestions = []; // 当前渲染的建议列表（供采纳/忽略按 id 查找）

// —— 折叠面板状态（默认：诊断展开，其余收起；持久化到 localStorage）——
const PANEL_DEFAULTS = { diagnosis: true, trend: false, compare: false, detail: false, learn: false };
function loadPanels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ADS_PANELS);
    if (!raw) return { ...PANEL_DEFAULTS };
    return { ...PANEL_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...PANEL_DEFAULTS };
  }
}
function savePanels(p) {
  try {
    localStorage.setItem(STORAGE_KEYS.ADS_PANELS, JSON.stringify(p));
  } catch (_) {
    /* 忽略 */
  }
}
let panelState = loadPanels();
function togglePanel(key) {
  panelState[key] = !panelState[key];
  savePanels(panelState);
}

// 各站点概览指标（供知识卡「你的数据」对比）
let lastSiteMetrics = {};
function siteMetricFor(site) {
  return lastSiteMetrics[site] || null;
}
// 趋势图重绘用（展开面板后重绘）
let lastRanged = [];
let lastDaily = null;

function fmtNum(v, dec = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtInt(v) {
  return (Number(v) || 0).toLocaleString('zh-CN');
}
function siteLabel(s) {
  return s === 'AE' ? '中东站 AE' : s === 'SA' ? '沙特站 SA' : s;
}
function adTypeLabel(t) {
  if (t === 'SP') return 'SP广告';
  if (t === 'SB') return 'SB广告';
  if (t === 'SD') return 'SD广告';
  return t ? `${t}广告` : '—';
}
function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function eachDateRange(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard++ < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
/** 当前看板范围的可读描述（用于诊断面板文案） */
function rangeLabel() {
  if (viewRange === '7d') return '近7天';
  if (viewRange === '30d') return '近30天';
  return '自定义区间';
}
/** 数据粒度文案 */
function granularityText(g) {
  return { keyword: '关键词级', campaign: '广告活动级', site: '站点级汇总', mixed: '混合', none: '无' }[g] || '站点级汇总';
}
/** ACOS 健康度配色 */
function acosHealth(acos, hasSales) {
  if (!hasSales || acos == null) return { cls: 'gray', label: '无数据', dot: '⚪' };
  if (acos <= 25) return { cls: 'green', label: '健康', dot: '🟢' };
  if (acos <= 35) return { cls: 'yellow', label: '预警', dot: '🟡' };
  return { cls: 'red', label: '偏高', dot: '🔴' };
}
/** 当前看板的时间范围 */
function getRange(all) {
  if (viewRange === 'custom' && viewStart && viewEnd) return { start: viewStart, end: viewEnd };
  const dates = all.map((r) => r.date).sort();
  const maxD = dates[dates.length - 1] || todayStr();
  const n = viewRange === '30d' ? 30 : 7;
  return { start: addDays(maxD, -(n - 1)), end: maxD };
}
function filterByRange(all, start, end) {
  return all.filter((r) => r.date >= start && r.date <= end);
}
/** 按日期聚合（跨站点求和），生成趋势序列 */
function dailySeries(ranged, start, end) {
  const dates = eachDateRange(start, end);
  const byDate = new Map();
  for (const r of ranged) {
    const a = byDate.get(r.date) || { cost: 0, sales: 0 };
    a.cost += r.cost;
    a.sales += r.sales;
    byDate.set(r.date, a);
  }
  const cost = [];
  const sales = [];
  const acos = [];
  for (const d of dates) {
    const a = byDate.get(d) || { cost: 0, sales: 0 };
    cost.push(a.cost);
    sales.push(a.sales);
    acos.push(a.sales > 0 ? (a.cost / a.sales) * 100 : null);
  }
  return { dates: dates.map((d) => d.slice(5)), fullDates: dates, cost, sales, acos };
}
/** 聚合一组记录的指标 */
function summarize(recs) {
  const t = { cost: 0, sales: 0, impressions: 0, clicks: 0, orders: 0 };
  for (const r of recs) {
    t.cost += r.cost;
    t.sales += r.sales;
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.orders += r.orders;
  }
  const acos = t.sales > 0 ? (t.cost / t.sales) * 100 : null;
  const roas = t.cost > 0 ? t.sales / t.cost : 0;
  return { ...t, acos, roas };
}

export function render(container, { rerender } = {}) {
  const all = listRecords();
  const imports = listImports();

  // 顶部卡片（标题 + 导入/导出/清空）始终渲染
  const header = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:12px">
          <div class="section-title">广告诊断</div>
          <div class="section-actions">
            <button class="btn btn-primary btn-sm" data-import>${icon('upload')} 导入领星数据</button>
            ${all.length ? `<button class="btn btn-soft btn-sm" data-export>${icon('download')} 导出</button>` : ''}
            ${all.length ? `<button class="btn btn-ghost btn-sm" data-clear>${icon('trash')} 清空</button>` : ''}
          </div>
        </div>
        <div class="field-tip">数据来源：领星 ERP 手动导出的广告报表（Excel / CSV）。导入后按「站点 + 日期」自动去重。</div>
      </div>
    </div>`;

  if (!all.length) {
    container.innerHTML = header + renderEmpty();
    wireHeader(container, rerender);
    return;
  }

  const { start, end } = getRange(all);
  const ranged = filterByRange(all, start, end);
  const sites = [...new Set(all.map((r) => r.site))].sort();
  const daily = dailySeries(ranged, start, end);

  // 各站点概览指标（供知识卡对比用户数据）
  lastSiteMetrics = {};
  for (const s of ['AE', 'SA']) {
    lastSiteMetrics[s] = computeSiteMetrics(s, ranged.filter((r) => r.site === s), all, start, end, rangeLabel());
  }
  lastRanged = ranged;
  lastDaily = daily;

  // 诊断建议（刷新加载态时跳过重新计算，保留原结果）
  let diag = { suggestions: [] };
  if (!isDiagnosing) {
    diag = diagnose(ranged, { all, start, end, rangeLabel: rangeLabel() });
    currentSuggestions = diag.suggestions;
  }

  container.innerHTML =
    header + renderDashboard(ranged, imports, start, end, daily, sites, diag);

  wireHeader(container, rerender);
  wireFilter(container, rerender);
  wireDashboard(container, ranged, daily);
  wireDiagnosis(container, rerender);
  wireCollapse(container, rerender);
  wireGlossary(container, rerender);

  // 删除导入批次
  container.querySelectorAll('[data-del-import]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delImport;
      const imp = imports.find((i) => i.id === id);
      confirmDialog({
        title: '删除该导入批次',
        message: `将移除批次「${esc(imp?.fileName || id)}」写入的明细（若已被后续导入覆盖则保留）。确定？`,
        danger: true,
        confirmText: '删除',
        onConfirm: () => {
          removeImport(id);
          toastSuccess('已删除该导入批次');
          rerender();
        },
      });
    });
  });
}

function renderEmpty() {
  return `
    <div class="card">
      <div class="card-pad" style="text-align:center;padding:48px 20px">
        <div style="font-size:34px;margin-bottom:10px;opacity:.5">${icon('database')}</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">还没有广告数据</div>
        <div style="font-size:13px;color:var(--text-sub);line-height:1.6;max-width:380px;margin:0 auto">
          点击上方「导入领星数据」，上传从领星 ERP 导出的广告报表（.xlsx / .csv），系统会自动解析并保存。
        </div>
      </div>
    </div>`;
}

function wireHeader(container, rerender) {
  container.querySelector('[data-import]')?.addEventListener('click', () => openImportModal(rerender));
  container.querySelector('[data-export]')?.addEventListener('click', () => exportData(listRecords()));
  container.querySelector('[data-clear]')?.addEventListener('click', () => {
    confirmDialog({
      title: '清空广告数据',
      message: '将删除全部已导入的广告明细与导入记录，且不可恢复。确定继续？',
      danger: true,
      confirmText: '清空',
      onConfirm: () => {
        clearAll();
        toastSuccess('已清空全部广告数据');
        rerender();
      },
    });
  });
}

function renderDashboard(ranged, imports, start, end, daily, sites, diag) {
  const ov = summarize(ranged);
  const ovHealth = acosHealth(ov.acos, ov.sales > 0);
  const totalClicks = ov.clicks;
  const totalOrders = ov.orders;

  const importRows = imports
    .map(
      (i) => `
      <div class="imp-row">
        <div class="imp-info">
          <div class="imp-name">${esc(i.fileName)}</div>
          <div class="imp-meta">${siteLabel(i.site)} · ${esc(i.period)} · ${fmtInt(i.count)} 行 · ${new Date(i.at).toLocaleString('zh-CN')}</div>
        </div>
        <button class="task-act task-del" data-del-import="${i.id}">删除</button>
      </div>`
    )
    .join('');

  const chartInner = `
    <div class="section-head" style="margin-bottom:10px">
      <div class="section-title">📈 广告趋势</div>
      ${renderRangeFilter()}
    </div>
    <div id="adsChart" class="ads-chart" style="position:relative"></div>`;

  // 双站点对比
  const siteCards = ['AE', 'SA']
    .map((s) => {
      const recs = ranged.filter((r) => r.site === s);
      const has = recs.length > 0;
      const sm = summarize(recs);
      const h = acosHealth(sm.acos, sm.sales > 0);
      return `
      <div class="site-card">
        <div class="site-card-head">
          <span class="site-flag">${s === 'AE' ? '🇦🇪' : '🇸🇦'}</span>
          <span class="site-name">${s === 'AE' ? '中东站 AE' : '沙特站 SA'}</span>
        </div>
        ${
          has
            ? `<div class="site-metrics">
            <div class="sm-row"><span>花费</span><b>¥${fmtNum(sm.cost)}</b></div>
            <div class="sm-row"><span>销售额</span><b>¥${fmtNum(sm.sales)}</b></div>
            <div class="sm-row"><span>ACOS</span><b class="acos-${h.cls}">${sm.acos == null ? 'N/A' : sm.acos.toFixed(1) + '%'} ${h.dot} ${h.label}</b></div>
            <div class="sm-row"><span>ROAS</span><b>${fmtNum(sm.roas)}</b></div>
            <div class="sm-row"><span>曝光</span><b>${fmtInt(sm.impressions)}</b></div>
            <div class="sm-row"><span>点击</span><b>${fmtInt(sm.clicks)}</b></div>
            <div class="sm-row"><span>订单</span><b>${fmtInt(sm.orders)}</b></div>
          </div>
          <div class="site-tip ${h.cls === 'red' ? 'tip-red' : h.cls === 'yellow' ? 'tip-yellow' : h.cls === 'gray' ? 'tip-gray' : 'tip-green'}">
            ${
              sm.sales <= 0
                ? '💡 无广告收入数据'
                : h.cls === 'red'
                ? '💡 ACOS 偏高，建议优化关键词匹配与出价'
                : h.cls === 'yellow'
                ? '💡 ACOS 处于预警区间，关注转化与花费'
                : '💡 ACOS 健康，可适当扩量'
            }
          </div>`
            : `<div class="ads-empty" style="padding:18px 0">该站点在此时间范围内暂无数据</div>`
        }
      </div>`;
    })
    .join('');

  // 明细表（含关键词级字段时补充列）
  const hasKw = ranged.some((r) => r.keyword);
  const kwHead = hasKw ? `<th>关键词</th><th>广告类型</th><th class="num">出价</th><th class="num">匹配</th>` : '';
  const kwRow = (r) =>
    hasKw
      ? `<td>${esc(r.keyword || '—')}</td><td>${esc(r.adType ? adTypeLabel(r.adType) : '—')}</td><td class="num">${
          r.bid ? fmtNum(r.bid) : '—'
        }</td><td>${esc(r.matchType ? matchTypeLabelLocal(r.matchType) : '—')}</td>`
      : '';
  const tableRows = ranged
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.site.localeCompare(b.site)))
    .map(
      (r) => `
      <tr data-date="${esc(r.date)}">
        <td>${esc(r.date)}</td>
        <td>${esc(siteLabel(r.site))}</td>
        ${kwRow(r)}
        <td class="num">${fmtNum(r.cost)}</td>
        <td class="num">${fmtNum(r.sales)}</td>
        <td class="num">${fmtInt(r.impressions)}</td>
        <td class="num">${fmtInt(r.clicks)}</td>
        <td class="num">${fmtInt(r.orders)}</td>
      </tr>`
    )
    .join('');

  const compareInner = `<div class="site-grid">${siteCards}</div>`;
  const detailInner = `
    <div class="table-scroll ads-detail" style="max-height:520px">
      <table class="data-table">
        <thead>
          <tr><th>日期</th><th>站点</th>${kwHead}<th class="num">花费</th><th class="num">销售额</th><th class="num">曝光</th><th class="num">点击</th><th class="num">订单</th></tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="${hasKw ? 11 : 7}" style="text-align:center;color:var(--text-sub)">该时间范围内暂无数据</td></tr>`}</tbody>
      </table>
    </div>`;

  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:14px">
          <div class="section-title">数据概览</div>
          <span class="section-sub">${ranged.length ? `近 ${ranged.length} 条明细` : '该范围无数据'}</span>
        </div>
        <div class="ads-stats">
          <div class="ads-stat"><div class="ads-stat-v">¥${fmtNum(ov.cost)}</div><div class="ads-stat-l">总花费</div></div>
          <div class="ads-stat"><div class="ads-stat-v">¥${fmtNum(ov.sales)}</div><div class="ads-stat-l">总广告销售额</div></div>
          <div class="ads-stat"><div class="ads-stat-v acos-${ovHealth.cls}">${ov.acos == null ? 'N/A' : ov.acos.toFixed(1) + '%'} ${ovHealth.dot}</div><div class="ads-stat-l">整体 ACOS（${ovHealth.label}）</div></div>
        </div>
        <div class="ads-meta-line">覆盖站点：${sites.map(siteLabel).join('、') || '-'} ｜ 日期范围：${start} ~ ${end} ｜ 总点击 ${fmtInt(totalClicks)} ｜ 总订单 ${fmtInt(totalOrders)}</div>
        ${renderCognitiveCard()}
      </div>
      <div class="card-pad" style="border-top:1px solid var(--border);padding-top:14px">
        <div class="section-head" style="margin-bottom:10px"><div class="section-title">导入记录</div></div>
        <div class="imp-list">${importRows || '<div class="field-tip">暂无导入记录</div>'}</div>
      </div>
    </div>

    ${collapseCard('diagnosis', '🧠 诊断建议', renderDiagnosis(diag), {
      open: panelState.diagnosis,
      headExtra: diagnosisHeadHtml(diag),
      headSub: diag.suggestions.length ? `共 ${diag.suggestions.length} 条` : '',
    })}

    ${collapseCard('trend', '📈 广告趋势', chartInner, {
      open: panelState.trend,
      headSub: daily.fullDates ? `共 ${daily.fullDates.length} 天数据` : '',
    })}

    ${collapseCard('compare', '🇦🇪 🇸🇦 站点对比', compareInner, { open: panelState.compare })}

    ${collapseCard('detail', '📋 明细数据', detailInner, {
      open: panelState.detail,
      headSub: ranged.length ? `共 ${ranged.length} 条` : '无数据',
    })}

    ${collapseCard('learn', '📖 广告知识库', renderKnowledgeBase(ranged), { open: panelState.learn })}

    ${renderFeedbackFooter()}`;
}

/** 折叠卡片封装（头部点击展开/收起，状态持久化） */
function collapseCard(key, title, bodyHtml, { open, headExtra = '', headSub = '' } = {}) {
  return `
    <div class="collapse-wrap ${open ? 'open' : ''}" data-panel="${key}" style="margin-bottom:18px">
      <div class="collapse-head" data-panel-toggle="${key}">
        <span class="ch-title">${title}</span>
        ${headSub ? `<span class="ch-sub">${esc(headSub)}</span>` : ''}
        <span class="ch-actions">${headExtra}</span>
        <span class="ch-arrow">${icon('chevronDown')}</span>
      </div>
      <div class="collapse-body">${bodyHtml}</div>
    </div>`;
}

/** 认知水平评估卡 */
function renderCognitiveCard() {
  const n = learnedCount();
  const lv = levelLabel(n);
  const pct = Math.round((n / 8) * 100);
  const last = lastLearned();
  const lastTxt = last.term && last.at ? `最近学习：${new Date(last.at).toLocaleDateString('zh-CN')} 查看了「${GLOSSARY[last.term] ? GLOSSARY[last.term].name : last.term}」` : '还没有学习记录，点击诊断卡里的「❓」开始吧';
  return `
    <div class="cog-card">
      <div class="cog-head">📊 你的广告认知水平：<span class="cog-level">📍 ${esc(lv)}</span>（已掌握 ${n}/8 个概念）</div>
      <div class="cog-bar"><div class="cog-bar-fill" style="width:${pct}%"></div></div>
      <div class="cog-meta">${lastTxt}</div>
    </div>`;
}

/** 广告知识库面板 */
function renderKnowledgeBase(ranged) {
  const mastered = masteredList();
  const terms = TERM_ORDER.map((id) => {
    const t = GLOSSARY[id];
    const done = mastered.includes(id);
    return `<button class="kb-term ${done ? 'done' : ''}" data-kb-term="${id}">
        ${done ? '✅' : '🔲'} <b>${esc(t.name)}</b>${done ? '（已掌握）' : '（未学习）'}
      </button>`;
  }).join('');
  const last = lastLearned();
  return `
    <div class="kb">
      <div class="kb-section-title">📚 核心术语（点击查看详情）</div>
      <div class="kb-terms">${terms}</div>
      <div class="kb-section-title">📖 学习资源</div>
      <ul class="kb-resources">
        <li>第一章：广告基础概念 → 理解核心指标（ACOS / ROAS / CTR / CVR）</li>
        <li>第二章：广告匹配类型 → 广泛 / 词组 / 精准 什么时候用哪种</li>
        <li>第三章：广告优化流程 → 从诊断到操作的完整指南</li>
        <li>FAQ：常见问题解答</li>
      </ul>
      <div class="kb-section-title">📝 我的学习记录</div>
      <div class="kb-record">已学习 ${mastered.length}/8 个概念 ｜ ${last.term ? `最近学习：${new Date(last.at).toLocaleString('zh-CN')} 查看了「${GLOSSARY[last.term] ? GLOSSARY[last.term].name : last.term}」` : '还没有学习记录'}</div>
    </div>`;
}

function matchTypeLabelLocal(t) {
  if (t === 'broad') return '广泛匹配';
  if (t === 'phrase') return '词组匹配';
  if (t === 'exact') return '精准匹配';
  return '—';
}

function renderRangeFilter() {
  const btn = (val, label) =>
    `<button class="ads-range-btn ${viewRange === val ? 'active' : ''}" data-range="${val}">${label}</button>`;
  const custom = viewRange === 'custom' && viewStart && viewEnd
    ? `<span class="ads-range-custom">
        <input type="date" class="input ads-range-date" data-cstart value="${viewStart}">
        <span class="ads-range-tilde">~</span>
        <input type="date" class="input ads-range-date" data-cend value="${viewEnd}">
      </span>`
    : '';
  return `<div class="ads-range">${btn('7d', '近7天')}${btn('30d', '近30天')}${btn('custom', '自定义')}${custom}</div>`;
}

function wireFilter(container, rerender) {
  container.querySelectorAll('[data-range]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.range;
      if (v === 'custom') {
        if (!(viewRange === 'custom' && viewStart && viewEnd)) {
          const today = todayStr();
          viewRange = 'custom';
          viewStart = addDays(today, -6);
          viewEnd = today;
        }
      } else {
        viewRange = v;
      }
      rerender();
    });
  });
  const cs = container.querySelector('[data-cstart]');
  const ce = container.querySelector('[data-cend]');
  if (cs && ce) {
    const apply = () => {
      const s = cs.value;
      const e = ce.value;
      if (!s || !e) {
        toastError('请选择完整的开始与结束日期');
        return;
      }
      if (s > e) {
        toastError('开始日期不能晚于结束日期');
        return;
      }
      viewStart = s;
      viewEnd = e;
      rerender();
    };
    cs.addEventListener('change', apply);
    ce.addEventListener('change', apply);
  }
}

function wireDashboard(container, ranged, daily) {
  const chartEl = container.querySelector('#adsChart');
  if (!chartEl) return;
  if (ranged.length) {
    renderLineChart(chartEl, {
      dates: daily.dates,
      fullDates: daily.fullDates,
      series: { cost: daily.cost, sales: daily.sales, acos: daily.acos },
      onPointClick: (fullDate) => {
        const tbl = container.querySelector('.ads-detail tbody');
        if (!tbl) return;
        tbl.querySelectorAll('tr.row-highlight').forEach((r) => r.classList.remove('row-highlight'));
        const rows = tbl.querySelectorAll(`tr[data-date="${fullDate}"]`);
        if (rows.length) {
          rows.forEach((r) => r.classList.add('row-highlight'));
          if (rows[0].scrollIntoView) rows[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
          toastInfo(`已定位 ${fullDate} 的 ${rows.length} 条明细`);
        } else {
          toastInfo(`已定位 ${fullDate}（该日无明细）`);
        }
      },
    });
  } else {
    chartEl.innerHTML = '<div class="ads-empty">该时间范围内暂无数据可绘制趋势</div>';
  }
}

function renderDiagnosis(diag) {
  if (isDiagnosing) {
    return `<div class="diag-loading"><span class="diag-spin"></span> 正在分析数据并生成诊断建议…</div>`;
  }
  const n = diag.suggestions.length;
  const pauseRows = buildPauseList(diag.suggestions);
  const sub = n
    ? `<div class="diag-sub">基于${rangeLabel()}数据自动生成 · 共 ${n} 条建议（按优先级排序）· 数据粒度：${granularityText(
        diag.dataGranularity
      )}</div>`
    : '';
  const body =
    n === 0
      ? `<div class="diag-nodata">🎉 当前区间数据未触发任何风险项，各项指标处于健康范围，继续保持关注即可。</div>`
      : diag.suggestions.map(renderDiagCard).join('');
  let pauseSummary = '';
  if (pauseRows.length > 0) {
    const waste = pauseRows.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    pauseSummary = `<div class="diag-pause-summary">含高花费无转化关键词，建议查看暂停清单：<b>${pauseRows.length}</b> 个关键词待暂停，累计浪费 <b>¥${fmtNum(waste)}</b></div>`;
  }
  return `${sub}${body}${pauseSummary}`;
}

/** 诊断面板头部操作按钮（放入折叠头，不重复渲染标题） */
function diagnosisHeadHtml(diag) {
  const pauseRows = buildPauseList(diag.suggestions);
  const pauseBtn =
    pauseRows.length > 0
      ? `<button class="btn btn-danger-soft btn-sm" data-diag-pause title="导出可粘贴到领星后台批量暂停的关键词清单">${icon(
          'copy'
        )} 批量暂停清单（${pauseRows.length}）</button>`
      : '';
  return `
    <button class="btn btn-soft btn-sm" data-diag-refresh>${icon('refresh')} 刷新诊断</button>
    ${pauseBtn}
    <button class="btn btn-ghost btn-sm" data-diag-stats>${icon('chart')} 反馈统计</button>`;
}

function renderDiagCard(sug) {
  const prioCfg = {
    high: { cls: 'high', icon: '🔴', label: '高优先级' },
    mid: { cls: 'mid', icon: '🟡', label: '中优先级' },
    low: { cls: 'low', icon: '🟢', label: '低优先级' },
  }[sug.priority];
  const dataRows = sug.dataSupport.map((d) => `<li>${highlightTerms(d)}</li>`).join('');
  const points = sug.points.map((p) => `<li>${highlightTerms(p)}</li>`).join('');
  const fb = feedbackById(sug.id);
  const termId = termForRule(sug.ruleKey);
  const copyKwBtn = sug.pauseAction
    ? `<button class="btn btn-ghost btn-sm" data-copy-kw="${esc(sug.id)}">${icon('copy')} 复制关键词</button>`
    : '';
  const askBtn = `<button class="btn btn-ghost btn-sm" data-ask-term="${esc(termId)}" data-sug-id="${esc(
    sug.id
  )}" title="查看这个术语的通俗解释">${icon('help')} 我不懂这个词</button>`;
  const actions = fb
    ? `<div class="diag-resolved ${fb.feedback === 'accept' ? 'ok' : 'no'}">${
        fb.feedback === 'accept' ? '✅ 已采纳' : '❌ 已忽略'
      } · ${new Date(fb.at).toLocaleString('zh-CN')}</div>`
    : `<div class="diag-card-actions">
        <button class="btn btn-soft btn-sm" data-accept="${esc(sug.id)}">👍 采纳</button>
        <button class="btn btn-ghost btn-sm" data-ignore="${esc(sug.id)}">👎 忽略</button>
        ${copyKwBtn}
        ${askBtn}
      </div>`;
  const impactLine = sug.impact
    ? `<div class="diag-impact-inline">💰 ${highlightTerms(sug.impact)}</div>`
    : '';
  return `
    <div class="diag-card diag-${prioCfg.cls}" data-site="${esc(sug.site)}">
      <div class="diag-card-head">
        <span class="diag-prio prio-${prioCfg.cls}">${prioCfg.icon} ${prioCfg.label}</span>
        <span class="diag-site">${esc(sug.siteLabel)}</span>
      </div>
      <div class="diag-object">📍 ${esc(sug.objectLabel)}</div>
      <div class="diag-issue">${esc(sug.problem)}</div>

      <div class="diag-plain">
        <div class="diag-plain-title">💡 这是什么意思？</div>
        <div class="diag-plain-body">${sug.plainExplain ? highlightTerms(sug.plainExplain) : '—'}</div>
        ${impactLine}
      </div>

      <div class="diag-ops" data-ops-toggle>
        <div class="diag-ops-head"><span class="diag-ops-arrow">${icon('chevronRight')}</span> 🎯 推荐操作（点击展开）</div>
        <div class="diag-ops-body">
          <ol class="diag-points">${points}</ol>
          ${sug.expected ? `<div class="diag-expected-block">📈 预期效果：${highlightTerms(sug.expected)}</div>` : ''}
        </div>
      </div>

      ${sug.granularityNote ? `<div class="diag-note">💡 ${esc(sug.granularityNote)}</div>` : ''}
      ${actions}
    </div>`;
}

function renderFeedbackFooter() {
  const st = feedbackStats();
  if (st.total === 0) return '';
  return `
    <div class="card diag-footer">
      <div class="card-pad fb-footer-inner">
        📊 诊断反馈统计：采纳 <b>${st.accept}</b> 条 · 忽略 <b>${st.ignore}</b> 条 · 采纳率 <b>${st.rate.toFixed(1)}%</b>
        <button class="btn btn-soft btn-sm fb-footer-link" data-diag-stats>查看全部反馈</button>
      </div>
    </div>`;
}

function wireDiagnosis(container, rerender) {
  // 刷新诊断（带加载态）
  container.querySelectorAll('[data-diag-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (isDiagnosing) return;
      isDiagnosing = true;
      rerender(); // 显示「诊断中…」
      setTimeout(() => {
        isDiagnosing = false;
        rerender();
        toastSuccess('✅ 诊断已刷新');
      }, 550);
    });
  });

  // 反馈统计入口（面板头部 / 底部 footer 共用）
  container.querySelectorAll('[data-diag-stats]').forEach((btn) => {
    btn.addEventListener('click', () => openFeedbackModal(rerender));
  });

  // 批量暂停清单（领星可粘贴）
  const pauseBtn = container.querySelector('[data-diag-pause]');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      const rows = buildPauseList(currentSuggestions);
      if (!rows.length) {
        toastInfo('暂无可批量暂停的关键词（需导入关键词级报表）');
        return;
      }
      openPauseListModal(rows);
    });
  }

  // 单条：复制关键词
  container.querySelectorAll('[data-copy-kw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sug = currentSuggestions.find((s) => s.id === btn.dataset.copyKw);
      if (!sug || !sug.target) return;
      const row = {
        siteLabel: siteLabelOf(sug.target.site),
        campaign: sug.target.campaign || '未命名活动',
        keyword: sug.target.keyword || '未命名关键词',
        adTypeLabel: sug.target.adTypeLabel || sug.target.adType || '',
      };
      const ok = await copyText(pauseListToText([row]));
      if (ok) toastSuccess(`已复制关键词：${row.keyword}`);
      else toastError('复制失败，请手动框选复制');
    });
  });

  // 采纳 / 忽略
  container.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sug = currentSuggestions.find((s) => s.id === btn.dataset.accept);
      if (!sug) return;
      confirmDialog({
        title: '采纳诊断建议',
        message: `${sug.siteLabel}\n${sug.problem}\n\n建议：\n${sug.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`,
        confirmText: '采纳',
        onConfirm: () => {
          addFeedback({
            id: sug.id,
            site: sug.site,
            ruleKey: sug.ruleKey,
            priority: sug.priority,
            content: suggestionToText(sug),
            trigger: sug.trigger,
            feedback: 'accept',
            at: Date.now(),
          });
          toastSuccess('✅ 已记录你的反馈，感谢！');
          rerender();
        },
      });
    });
  });
  container.querySelectorAll('[data-ignore]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sug = currentSuggestions.find((s) => s.id === btn.dataset.ignore);
      if (!sug) return;
      confirmDialog({
        title: '忽略诊断建议',
        message: '确认忽略该建议？此操作仅记录你的反馈，不影响已导入的数据。',
        confirmText: '忽略',
        onConfirm: () => {
          addFeedback({
            id: sug.id,
            site: sug.site,
            ruleKey: sug.ruleKey,
            priority: sug.priority,
            content: suggestionToText(sug),
            trigger: sug.trigger,
            feedback: 'ignore',
            at: Date.now(),
          });
          toastInfo('已忽略该建议');
          rerender();
        },
      });
    });
  });

  // 「❓ 我不懂这个词」→ 打开知识卡（标记已掌握）
  container.querySelectorAll('[data-ask-term]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const termId = btn.dataset.askTerm;
      const sug = currentSuggestions.find((s) => s.id === btn.dataset.sugId);
      const site = sug ? sug.site : '';
      openKnowledgeCard(termId, buildTermData(site), rerender);
    });
  });

  // 知识库面板中的术语 → 打开知识卡
  container.querySelectorAll('[data-kb-term]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openKnowledgeCard(btn.dataset.kbTerm, buildTermData(''), rerender);
    });
  });

  // 推荐操作折叠（默认收起，点击展开）
  container.querySelectorAll('[data-ops-toggle]').forEach((box) => {
    const head = box.querySelector('.diag-ops-head');
    head.addEventListener('click', () => box.classList.toggle('open'));
  });
}

function openFeedbackModal(rerender) {
  const fb = listFeedback();
  const st = feedbackStats();
  const rows = fb.length
    ? fb
        .map((f, i) => {
          const date = new Date(f.at).toLocaleString('zh-CN');
          const summary = (f.content || '').slice(0, 42);
          const fbBadge =
            f.feedback === 'accept'
              ? '<span class="fb-accept">✅ 采纳</span>'
              : '<span class="fb-ignore">❌ 忽略</span>';
          return `
          <tr>
            <td>${esc(date)}</td>
            <td>${esc(f.site)}</td>
            <td class="fb-summary">${esc(summary)}…</td>
            <td>${fbBadge}</td>
            <td><button class="btn btn-ghost btn-sm" data-fb-view="${i}">查看</button></td>
          </tr>
          <tr class="fb-detail-row" data-fb-detail="${i}" hidden>
            <td colspan="5"><div class="fb-detail">${esc(f.content || '')}</div></td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--text-sub)">暂无反馈记录</td></tr>';

  const body = `
    <div class="fb-stat-bar">
      <span>采纳：<b class="fb-accept">${st.accept}</b> 条</span>
      <span>忽略：<b class="fb-ignore">${st.ignore}</b> 条</span>
      <span>采纳率：<b>${st.rate.toFixed(1)}%</b></span>
    </div>
    <div class="table-scroll" style="max-height:420px">
      <table class="data-table">
        <thead><tr><th>日期</th><th>站点</th><th>建议摘要</th><th>反馈</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const m = openModal({
    title: '诊断反馈历史',
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-close>关闭</button>`,
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelectorAll('[data-fb-view]').forEach((b) => {
    b.addEventListener('click', () => {
      const row = m.el.querySelector(`[data-fb-detail="${b.dataset.fbView}"]`);
      if (row) row.hidden = !row.hidden;
    });
  });
}

/** 构造知识卡所需的用户数据（取某站点概览指标） */
function buildTermData(site) {
  const m = (site && siteMetricFor(site)) || lastSiteMetrics.AE || lastSiteMetrics.SA || null;
  if (!m) return {};
  return { acos: m.acos, roas: m.roas, ctr: m.ctr, cvr: m.convRate };
}

/** 知识卡弹窗（点击「❓ 我不懂这个词」/术语悬浮词/知识库术语触发） */
function openKnowledgeCard(termId, data, rerender) {
  const t = GLOSSARY[termId];
  if (!t) return;
  markTerm(termId); // 标记已掌握（不重复计数）
  const body = buildKnowledgeCard(termId, data || {});
  const m = openModal({
    title: `广告小课堂 · ${t.name}`,
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-more>📚 查看更多广告知识</button><button class="btn btn-primary" data-close>👌 明白了，继续操作</button>`,
  });
  m.el.querySelector('[data-close]').onclick = () => {
    m.close();
    if (rerender) rerender(); // 刷新认知水平卡 / 知识库勾选
  };
  m.el.querySelector('[data-more]').onclick = () => {
    m.close();
    panelState.learn = true;
    savePanels(panelState);
    if (rerender) rerender();
  };
}

/** 折叠面板：点击头部展开/收起，状态持久化；展开趋势时重绘图表 */
function wireCollapse(container, rerender) {
  container.querySelectorAll('[data-panel-toggle]').forEach((head) => {
    head.addEventListener('click', () => {
      const key = head.dataset.panelToggle;
      const wrap = head.closest('.collapse-wrap');
      const willOpen = !wrap.classList.contains('open');
      togglePanel(key);
      wrap.classList.toggle('open', willOpen);
      if (willOpen && key === 'trend' && lastRanged.length) {
        setTimeout(() => wireDashboard(container, lastRanged, lastDaily), 60);
      }
    });
  });
}

/** 术语悬浮解释（tooltip）+ 点击打开知识卡 */
function wireGlossary(container, rerender) {
  let pop = null;
  const ensurePop = () => {
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'gloss-pop';
      pop.setAttribute('role', 'tooltip');
      document.body.appendChild(pop);
    }
    return pop;
  };
  const show = (el) => {
    const t = GLOSSARY[el.dataset.term];
    if (!t) return;
    const p = ensurePop();
    p.textContent = t.short;
    p.style.display = 'block';
    const r = el.getBoundingClientRect();
    const ph = p.offsetHeight || 80;
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - (p.offsetWidth || 200) - 8));
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  };
  const hide = () => {
    if (pop) pop.style.display = 'none';
  };
  container.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('.gloss-term');
    if (el) show(el);
  });
  container.addEventListener('mouseout', (e) => {
    const el = e.target.closest && e.target.closest('.gloss-term');
    if (el) hide();
  });
  container.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('.gloss-term');
    if (el) show(el);
  });
  container.addEventListener('focusout', (e) => {
    const el = e.target.closest && e.target.closest('.gloss-term');
    if (el) hide();
  });
  container.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.gloss-term');
    if (!el) return;
    e.preventDefault();
    const card = el.closest('.diag-card');
    const site = card ? card.dataset.site : '';
    openKnowledgeCard(el.dataset.term, buildTermData(site), rerender);
  });
}

function downloadPauseCSV(rows) {
  const csv = pauseListToCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `领星批量暂停清单_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function siteLabelOf(s) {
  return s === 'AE' ? '中东站 AE' : s === 'SA' ? '沙特站 SA' : s || '';
}

/** 批量暂停清单弹窗：预览 + 复制 TSV + 下载 CSV（领星后台可粘贴） */
function openPauseListModal(rows) {
  const preview = rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.siteLabel)}</td><td>${esc(r.campaign)}</td><td>${esc(
          r.keyword
        )}</td><td>${esc(r.adTypeLabel)}</td><td>${esc(r.matchTypeLabel)}</td><td class="num">¥${fmtNum(
          r.cost
        )}</td><td class="num">${fmtInt(r.clicks)}</td></tr>`
    )
    .join('');
  const body = `
    <p class="field-tip" style="margin:0 0 10px">以下关键词近 ${rangeLabel()} 高花费无转化（单个关键词花费 ≥ 15 元、订单 0），建议批量暂停。清单可直接粘贴到<b>领星后台 → 广告 → 批量操作</b>的「暂停/否定关键词」框，或下载 CSV 后在批量模板中导入。</p>
    <div class="table-scroll" style="max-height:360px">
      <table class="data-table">
        <thead><tr><th>#</th><th>站点</th><th>广告活动</th><th>关键词</th><th>广告类型</th><th>匹配</th><th class="num">花费</th><th class="num">点击</th></tr></thead>
        <tbody>${preview}</tbody>
      </table>
    </div>
    <div class="field-tip" style="margin-top:8px">共 <b>${rows.length}</b> 个关键词待暂停，累计浪费 <b>¥${fmtNum(
      rows.reduce((s, r) => s + (Number(r.cost) || 0), 0)
    )}</b>。复制结果为 TSV（关键词 / 活动 / 类型 / 匹配 / 站点），便于在表格中粘贴；下载为 UTF-8 CSV（含 BOM，Excel 可直接打开）。</div>`;
  const m = openModal({
    title: `批量暂停清单（${rows.length} 个关键词）`,
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-close>关闭</button><button class="btn btn-soft" data-copy>${icon(
      'copy'
    )} 复制清单(TSV)</button><button class="btn btn-primary" data-csv>${icon('download')} 下载 CSV</button>`,
  });
  m.el.querySelector('[data-close]').onclick = m.close;
  m.el.querySelector('[data-copy]').onclick = async () => {
    const ok = await copyText(pauseListToText(rows));
    if (ok) toastSuccess(`已复制 ${rows.length} 个关键词，可粘贴到领星后台`);
    else toastError('复制失败，请手动框选清单复制');
  };
  m.el.querySelector('[data-csv]').onclick = () => {
    downloadPauseCSV(rows);
    toastSuccess('已开始下载 CSV');
  };
}

function openImportModal(rerender) {
  const body = `
    <div class="imp-step">
      <div class="field" style="margin-bottom:14px">
        <label class="field-label">选择文件（.xlsx / .xls / .csv，≤10MB）</label>
        <input type="file" accept="${ACCEPT}" class="input" data-file>
        <div class="field-tip" data-file-tip>支持领星 ERP 导出的广告报表。</div>
      </div>
      <div class="imp-opts" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div class="field" style="min-width:150px">
          <label class="field-label">站点</label>
          <select class="input" data-site>
            <option value="AE">中东站 AE</option>
            <option value="SA">沙特站 SA</option>
            <option value="ALL">全部（按文件内站点列）</option>
          </select>
        </div>
        <div class="field" style="min-width:150px">
          <label class="field-label">数据周期</label>
          <select class="input" data-period>
            <option value="近7天">近 7 天</option>
            <option value="近30天">近 30 天</option>
            <option value="自定义">自定义</option>
          </select>
        </div>
      </div>
      <div data-parse-area></div>
    </div>`;

  const m = openModal({
    title: '导入领星广告数据',
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary" data-confirm disabled>确认导入</button>`,
  });

  const fileInput = m.el.querySelector('[data-file]');
  const parseArea = m.el.querySelector('[data-parse-area]');
  const confirmBtn = m.el.querySelector('[data-confirm]');
  const cancelBtn = m.el.querySelector('[data-cancel]');
  cancelBtn.onclick = m.close;

  const state = {
    rawRows: null,
    headers: [],
    mapping: {},
    site: 'AE',
    period: '近7天',
  };

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toastError('仅支持 .xlsx / .xls / .csv 文件');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toastError(`文件超过 ${MAX_FILE_MB}MB，请分批导入`);
      return;
    }
    parseArea.innerHTML = `<div class="field-tip">正在解析「${esc(file.name)}」…</div>`;
    try {
      const rows = await readWorkbook(file);
      if (!rows.length) {
        parseArea.innerHTML = `<div class="field-tip" style="color:var(--red)">文件无数据或表头为空，请检查文件。</div>`;
        return;
      }
      state.rawRows = rows;
      state.headers = Object.keys(rows[0]);
      state.mapping = detectFields(state.headers);
      renderMappingAndPreview();
    } catch (err) {
      parseArea.innerHTML = `<div class="field-tip" style="color:var(--red)">解析失败：${esc(err.message || String(err))}</div>`;
    }
  });

  function renderMappingAndPreview() {
    const missing = validateMapping(state.mapping);
    const showSiteWarn = state.site === 'ALL' && !state.mapping.site;

    const mapHtml = FIELD_DEFS.map((def) => {
      const opts = ['<option value="">（未匹配）</option>']
        .concat(
          state.headers.map(
            (h) => `<option value="${esc(h)}" ${state.mapping[def.key] === h ? 'selected' : ''}>${esc(h)}</option>`
          )
        )
        .join('');
      const sample = state.mapping[def.key] ? state.rawRows[0][state.mapping[def.key]] : '';
      return `
        <div class="map-row">
          <div class="map-label">${def.label}${def.required ? ' <span class="req">*</span>' : ''}</div>
          <select class="input map-select" data-map="${def.key}">${opts}</select>
          <div class="map-sample">示例：${esc(String(sample ?? '').slice(0, 20))}</div>
        </div>`;
    }).join('');

    const recs = buildRecords(state.rawRows, state.mapping, state.site, 'preview');
    const previewRows = recs
      .slice(0, PREVIEW_LIMIT)
      .map(
        (r) => `
      <tr>
        <td>${esc(r.date)}</td><td>${esc(siteLabel(r.site))}</td>
        <td class="num">${fmtNum(r.cost)}</td><td class="num">${fmtNum(r.sales)}</td>
        <td class="num">${fmtInt(r.impressions)}</td><td class="num">${fmtInt(r.clicks)}</td>
        <td class="num">${fmtInt(r.orders)}</td>
      </tr>`
      )
      .join('');

    parseArea.innerHTML = `
      <div class="map-grid">${mapHtml}</div>
      ${showSiteWarn ? `<div class="field-tip" style="color:var(--red);margin:6px 0">站点选择为「全部」，但文件未匹配到站点列，请手动映射站点列，或将上方站点改为 AE / SA。</div>` : ''}
      ${missing.length ? `<div class="field-tip" style="color:var(--red);margin:6px 0">请先匹配必填字段：${missing.join('、')}</div>` : ''}
      <div class="section-head" style="margin:14px 0 8px">
        <div class="section-title" style="font-size:14px">数据预览</div>
        <span class="section-sub">${recs.length} 行有效${recs.length > PREVIEW_LIMIT ? `（仅显示前 ${PREVIEW_LIMIT} 行）` : ''}</span>
      </div>
      <div class="table-scroll" style="max-height:280px">
        <table class="data-table">
          <thead><tr><th>日期</th><th>站点</th><th class="num">花费</th><th class="num">销售额</th><th class="num">曝光</th><th class="num">点击</th><th class="num">订单</th></tr></thead>
          <tbody>${previewRows || '<tr><td colspan="7" style="text-align:center;color:var(--text-sub)">无有效数据，请检查映射</td></tr>'}</tbody>
        </table>
      </div>`;

    parseArea.querySelectorAll('[data-map]').forEach((sel) => {
      sel.addEventListener('change', () => {
        state.mapping[sel.dataset.map] = sel.value || null;
        renderMappingAndPreview();
      });
    });

    confirmBtn.disabled = missing.length > 0 || recs.length === 0;
    confirmBtn.onclick = () => doConfirm(recs);
  }

  function doConfirm(previewRecs) {
    const site = m.el.querySelector('[data-site]').value;
    const period = m.el.querySelector('[data-period]').value;
    const importId = 'imp_' + Date.now();
    const finalRecs = buildRecords(state.rawRows, state.mapping, site, importId);
    if (!finalRecs.length) {
      toastError('没有可导入的有效数据');
      return;
    }
    const fileName = fileInput.files[0]?.name || '未命名文件';
    try {
      const res = upsertRecords(finalRecs, { site, period, fileName, importId });
      m.close();
      toastSuccess(`导入完成：新增 ${res.added} 条，覆盖更新 ${res.updated} 条，共 ${res.total} 条`);
      rerender();
    } catch (err) {
      toastError(err.message || '保存失败');
    }
  }
}

function exportData(records) {
  if (!records.length) return;
  const hasTotal = records.some((r) => r.totalSales > 0);
  const hasKw = records.some((r) => r.keyword);
  const rows = records.map((r) => {
    const row = {
      日期: r.date,
      站点: r.site,
      花费: r.cost,
      销售额: r.sales,
      曝光: r.impressions,
      点击: r.clicks,
      订单: r.orders,
    };
    if (hasKw) {
      row['关键词'] = r.keyword || '';
      row['广告类型'] = r.adType || '';
      row['广告活动'] = r.campaign || '';
      row['出价'] = r.bid || '';
      row['建议竞价'] = r.suggestedBidText || (r.suggestedBid || '');
    }
    if (hasTotal) {
      row['总销售额'] = r.totalSales || 0;
      row['广告占比'] = r.totalSales > 0 ? `${((r.sales / r.totalSales) * 100).toFixed(1)}%` : '';
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '广告明细');
  const d = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `拾光柠广告明细_${d}.xlsx`);
}
