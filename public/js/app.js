/**
 * 拾光柠工作台 · 应用入口
 * 负责：侧边导航渲染、路由分发、AI 服务状态、跨页状态联动
 */
import { icon } from './ui/icons.js';
import { esc } from './utils.js';
import { hasApiKey, getSettings, maskedKey, applyTheme } from './store/settingsStore.js';
import { onProjectsChange } from './store/projectStore.js';
import { onProductsChange, countProducts } from './store/productStore.js';
import { render as renderHome } from './pages/home.js';
import { render as renderLibrary } from './pages/library.js';
import { render as renderListing } from './pages/listing.js';
import { render as renderSettings } from './pages/settings.js';
import { render as renderCommission } from './pages/commission.js';

const NAV = [
  { id: 'home', label: '首页', icon: 'home' },
  { id: 'library', label: '选品库', icon: 'box' },
  { id: 'listing', label: 'AI Listing 工坊', icon: 'sparkles' },
  { id: 'commission', label: '我的提成预估', icon: 'chart' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const TITLES = {
  home: { title: '首页', sub: '拾光柠工作台概览' },
  library: { title: '选品库', sub: '产品素材管理 · 一键导入 Listing 工坊' },
  listing: { title: 'AI Listing 工坊', sub: '亚马逊产品开发内容生成中心' },
  commission: { title: '我的提成预估', sub: '按昨天以前的完整数据推算提成' },
  settings: { title: '设置', sub: 'DeepSeek AI 服务与偏好' },
};

let currentRoute = 'home';

function pageOf(route) {
  if (route === 'home' || route === 'library' || route === 'settings' || route === 'commission') return route;
  if (route.startsWith('listing')) return 'listing';
  return 'home';
}

/** 全局路由跳转 */
export function navigate(route) {
  currentRoute = route;
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
  else if (page === 'settings') renderSettings(container, ctx);
}

/** 初始化 */
function init() {
  // 应用已保存的主题（明暗模式 + 主题色）
  applyTheme();
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
}

init();
