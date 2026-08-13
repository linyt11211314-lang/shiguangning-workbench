/**
 * 首页：固定指标卡组 + 快捷入口 + 最近项目
 */
import { icon } from '../ui/icons.js';
import { esc, timeAgo } from '../utils.js';
import { countProjects, countGeneratedToday, listProjects } from '../store/projectStore.js';
import { countProducts } from '../store/productStore.js';
import { listPendingWithDue, updateTaskTracked } from '../store/scheduleStore.js';
import { aiCallsCount } from '../store/statsStore.js';
import { hasApiKey } from '../store/settingsStore.js';
import { toastSuccess } from '../ui/toast.js';

function homeTodayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function homeIsOverdue(due) {
  return !!due && due < homeTodayStr();
}
function homeDueText(due) {
  if (!due) return '';
  const t = homeTodayStr();
  if (due === t) return '今天';
  const diff = Math.round((new Date(`${due}T00:00:00`) - new Date(`${t}T00:00:00`)) / 86400000);
  if (diff === 1) return '明天';
  if (diff < 0) return `逾期${-diff}天`;
  const [, mo, da] = due.split('-').map(Number);
  return `${mo}/${da}`;
}

export function render(container, { navigate }) {
  const metrics = [
    { label: 'Listing 项目总数', value: countProjects(), sub: '已保存的 Listing 项目' },
    { label: '今日生成', value: countGeneratedToday(), sub: '今日完成的 AI 生成' },
    { label: '选品库产品', value: countProducts(), sub: '可导入工坊的产品' },
    { label: 'AI 调用次数', value: aiCallsCount(), sub: '累计 DeepSeek 调用' },
  ];

  container.innerHTML = `
    <!-- 指标卡组：固定高度，不随页面滚动 -->
    <div class="metrics-row" data-metrics>
      ${metrics.map((m, i) => `
        <div class="metric-card">
          <div class="metric-body">
            <div class="metric-value" data-metric="${i}">${m.value}</div>
            <div class="metric-label">${m.label}</div>
            <div class="metric-trend">${m.sub}</div>
          </div>
        </div>`).join('')}
    </div>

    <div class="home-quick-grid">
      <div class="card home-quick" data-nav="listing">
        <div>
          <div class="hq-title">创建 AI Listing</div>
          <div class="hq-sub">填写产品信息，AI 生成标题、五点、描述与关键词</div>
        </div>
        <span class="hq-arrow">→</span>
      </div>
      <div class="card home-quick" data-nav="library">
        <div>
          <div class="hq-title">选品库</div>
          <div class="hq-sub">管理产品素材，一键导入 Listing 工坊</div>
        </div>
        <span class="hq-arrow">→</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:6px">
          <div class="section-title">待办事项</div>
          <span class="section-sub">来自日程计划 · 有计划日期且未完成</span>
          <span class="flex-1"></span>
          <button class="btn btn-soft btn-sm" data-nav="schedule">全部日程</button>
        </div>
        <div data-todos></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:6px">
          <div class="section-title">最近项目</div>
          <span class="section-sub">${hasApiKey() ? 'AI 服务已就绪' : '尚未配置 AI 服务，请前往设置'}</span>
          <span class="flex-1"></span>
          <button class="btn btn-soft btn-sm" data-nav="listing">全部项目</button>
        </div>
        <div data-recent></div>
      </div>
    </div>
  `;

  // 最近项目
  const recentBox = container.querySelector('[data-recent]');
  const projects = listProjects().slice(0, 4);
  if (!projects.length) {
    recentBox.innerHTML = `
      <div class="empty-state" style="padding:30px 20px">
        <div class="empty-icon">${icon('file')}</div>
        <div class="empty-title">还没有 Listing 项目</div>
        <div class="empty-sub">点击「创建 AI Listing」，从填写产品信息开始</div>
        <div class="mt-12"><button class="btn btn-primary" data-nav="listing:new">${icon('plus')} 创建第一个 Listing</button></div>
      </div>`;
  } else {
    recentBox.innerHTML = projects.map((p) => {
      const info = p.productInfo || {};
      const statusTag = p.status === 'saved'
        ? '<span class="tag tag-green">已保存</span>'
        : p.status === 'generated' ? '<span class="tag tag-blue">已生成</span>'
        : '<span class="tag">草稿</span>';
      return `
      <div class="list-row" data-open="${p.id}">
        ${info.image
          ? `<img class="project-thumb" src="${esc(info.image)}" alt="">`
          : `<div class="project-thumb no-img">无图</div>`}
        <div class="flex-1" style="min-width:0">
          <div class="truncate" style="font-size:14px;font-weight:600">${esc(info.name || '未命名产品')}</div>
          <div class="mt-8" style="font-size:12.5px;color:var(--text-sub);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${statusTag}
            <span>${esc(info.site || 'US')} 站</span>
            <span>·</span>
            <span>${timeAgo(p.updatedAt)}</span>
          </div>
        </div>
        <span class="hq-arrow" style="color:var(--text-faint)">→</span>
      </div>`;
    }).join('');
  }

  // 待办事项（来自日程计划：有计划日期且未完成，按时间升序）
  const todosBox = container.querySelector('[data-todos]');
  const todos = listPendingWithDue().slice(0, 6);
  if (!todos.length) {
    todosBox.innerHTML = `
      <div class="empty-state" style="padding:18px 14px">
        <div class="empty-sub">暂无待办，已完成或没填计划日期的不显示在这里。</div>
        <div class="mt-12"><button class="btn btn-soft btn-sm" data-nav="schedule">去日程计划添加</button></div>
      </div>`;
  } else {
    todosBox.innerHTML = todos.map((t) => {
      const ov = homeIsOverdue(t.dueDate);
      return `
      <div class="todo-item ${ov ? 'overdue' : ''}" data-todo="${t.id}" title="点击一键完成">
        <button class="todo-check" data-done>○</button>
        <div class="flex-1" style="min-width:0">
          <div class="todo-title">${esc(t.title)}</div>
          <div class="todo-due ${ov ? 'todo-due-over' : ''}">📅 ${homeDueText(t.dueDate)}</div>
        </div>
        <span class="hq-arrow" style="color:var(--text-faint)">→</span>
      </div>`;
    }).join('');
  }

  // 事件
  todosBox.addEventListener('click', (e) => {
    const el = e.target.closest('[data-todo]');
    if (!el) return;
    const id = el.dataset.todo;
    const t = listPendingWithDue().find((x) => x.id === id);
    if (!t) return;
    updateTaskTracked(id, { done: true });
    toastSuccess(`已完成：${t.title}`);
  });

  container.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  container.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`listing:open:${el.dataset.open}`));
  });
}
