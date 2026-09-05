/**
 * 拾光柠工作台 · 应用入口
 * 负责：侧边导航渲染、路由分发、AI 服务状态、跨页状态联动
 */
import { icon } from './ui/icons.js';
import { esc } from './utils.js';
import { hasApiKey, getSettings, maskedKey, applyTheme, syncFollowSystem } from './store/settingsStore.js';
import { onProjectsChange } from './store/projectStore.js';
import { onProductsChange, countProducts, initProducts } from './store/productStore.js';
import { onScheduleChange } from './store/scheduleStore.js';
import { render as renderHome } from './pages/home.js';
import { render as renderLibrary } from './pages/library.js';
import { render as renderListing } from './pages/listing.js';
import { render as renderSettings } from './pages/settings.js';
import { render as renderCommission } from './pages/commission.js';
import { render as renderSchedule } from './pages/schedule.js';
import { render as renderAds } from './pages/ads.js';
import { render as renderAnalysis } from './pages/analysis.js';
import { render as renderStockAlert } from './pages/stockAlert.js';
import { render as renderProfit } from './pages/profit.js';
import { render as renderFba } from './pages/fba.js';

const NAV = [
  { id: 'library', label: '选品库', icon: 'box' },
  { id: 'listing', label: 'AI Listing 工坊', icon: 'sparkles' },
  { id: 'ads', label: '广告诊断', icon: 'target' },
  { id: 'analysis', label: '数据分析', icon: 'analytics' },
  { id: 'commission', label: '我的提成预估', icon: 'chart' },
  { id: 'stockalert', label: '库存预警', icon: 'alert' },
  { id: 'profit', label: '利润看板', icon: 'trending' },
  { id: 'fba', label: 'FBA利润计算', icon: 'trending' },
  { id: 'schedule', label: '日程计划', icon: 'calendar' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const TITLES = {
  home: { title: '首页', sub: '拾光柠工作台概览' },
  library: { title: '选品库', sub: '产品素材管理 · 一键导入 Listing 工坊' },
  listing: { title: 'AI Listing 工坊', sub: '亚马逊产品开发内容生成中心' },
  commission: { title: '我的提成预估', sub: '按昨天以前的完整数据推算提成' },
  schedule: { title: '日程计划', sub: '待办与计划时间管理' },
  ads: { title: '广告诊断', sub: '领星广告数据导入与诊断' },
  analysis: { title: '数据分析', sub: '领星数据 → 月度品牌产品分析报表' },
  stockalert: { title: '库存预警', sub: '基于领星数据自动扫描库存，结合运输时间生成补货建议' },
  profit: { title: '利润看板', sub: '领星利润报表 + 采购单 → 真实利润分析与成本维护' },
  fba: { title: 'FBA利润计算', sub: '单产品录入 → 自动算净利润 / 利润率 / 广告指标' },
  settings: { title: '设置', sub: '外观、AI 服务与偏好' },
};

let currentRoute = 'library';
const ROUTE_KEY = 'sgn.route';

function pageOf(route) {
  if (route === 'home' || route === 'library' || route === 'settings' || route === 'commission' || route === 'schedule' || route === 'ads' || route === 'analysis' || route === 'stockalert' || route === 'profit' || route === 'fba') return route;
  if (route.startsWith('listing')) return 'listing';
  return 'home';
}

/** 全局路由跳转 */
export function navigate(route) {
  currentRoute = route;
  try { localStorage.setItem(ROUTE_KEY, route); } catch (_) {}
  renderShell();
  renderPage();
}

function renderShell() {
  const page = pageOf(currentRoute);
  const settings = getSettings();

  // 侧边导航（仅显示文字名称，不显示项目数字徽标）
  const navEl = document.getElementById('sidebarNav');
  navEl.innerHTML = NAV.map((n) => {
    const active = page === n.id;
    return `
      <div class="nav-item ${active ? 'active' : ''}" data-nav="${n.id}">
        <span class="nav-icon">${icon(n.icon)}</span>
        <span class="nav-label">${n.label}</span>
      </div>`;
  }).join('');
  navEl.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  // AI 状态徽标
  const badge = document.getElementById('aiStatusBadge');
  const on = hasApiKey();
  badge.className = `ai-status ${on ? 'on' : 'off'}`;
  badge.innerHTML = `<span class="ai-status-dot"></span><span class="ai-status-text">${
    on ? `AI 服务已就绪 · ${esc(maskedKey(settings.apiKey))}` : '未配置 API Key，点击配置'
  }</span>`;
  badge.style.cursor = 'pointer';
  badge.onclick = () => navigate('settings');

  // 顶栏
  const meta = TITLES[page] || TITLES.home;
  const titleText = page === 'library' ? `选品库 (共${countProducts()}个产品)` : meta.title;
  const topbar = document.getElementById('topbar');
  topbar.innerHTML = `
    <div>
      <div class="topbar-title">${titleText}</div>
      <div class="topbar-sub">${meta.sub}</div>
    </div>
    <span class="topbar-spacer"></span>
    <div class="topbar-actions">
      ${page === 'listing' ? `<button class="btn btn-primary btn-sm" data-nav="listing:new">${icon('plus')} 创建 Listing</button>` : ''}
      ${page === 'library' ? `<button class="btn btn-soft btn-sm" data-nav="listing:new">${icon('sparkles')} 去创建 Listing</button>` : ''}
    </div>
  `;
  topbar.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
}

function renderPage() {
  const container = document.getElementById('pageContent');
  container.innerHTML = '';
  const page = pageOf(currentRoute);
  const ctx = {
    navigate,
    rerender: () => renderPage(),
  };
  if (page === 'home') renderHome(container, ctx);
  else if (page === 'library') renderLibrary(container, ctx);
  else if (page === 'listing') renderListing(container, currentRoute, ctx);
  else if (page === 'commission') renderCommission(container, ctx);
  else if (page === 'schedule') renderSchedule(container, ctx);
  else if (page === 'ads') renderAds(container, ctx);
  else if (page === 'analysis') renderAnalysis(container, ctx);
  else if (page === 'stockalert') renderStockAlert(container, ctx);
  else if (page === 'profit') renderProfit(container, ctx);
  else if (page === 'fba') renderFba(container, ctx);
  else if (page === 'settings') renderSettings(container, ctx);
}

/** 初始化 */
function init() {
  // 应用已保存的主题（明暗模式 + 主题色 + 密度/字号/圆角）
  applyTheme();
  syncFollowSystem();

  // 选品库数据迁移并预加载到 IndexedDB（异步，就绪后自动刷新当前页）
  initProducts();

  // 恢复上次停留的页面（刷新不跳回首页）
  try {
    const saved = localStorage.getItem(ROUTE_KEY);
    if (saved && pageOf(saved) === saved) currentRoute = saved;
    // 兼容 listing:open:xxx / listing:new 等子路由
    else if (saved && saved.startsWith('listing')) currentRoute = saved;
  } catch (_) {}

  renderShell();
  renderPage();

  // 数据变化时联动刷新当前页
  const refresh = () => {
    // 保持当前路由不变，重绘（listing 结果页有内部状态，不强行重绘）
    const page = pageOf(currentRoute);
    if (page === 'listing' && currentRoute.includes('open')) return;
    renderShell();
    renderPage();
  };
  onProjectsChange(refresh);
  onProductsChange(refresh);
  onScheduleChange(refresh);

  // 左上角品牌「拾光柠」点击回首页
  const logo = document.querySelector('.sidebar-logo');
  if (logo) logo.addEventListener('click', () => navigate('home'));
}

// 入口：确保挂载节点存在后再初始化（模块在 <body> 末尾加载，DOM 已就绪）
if (typeof document !== 'undefined' && document.getElementById('app')) {
  init();
}
