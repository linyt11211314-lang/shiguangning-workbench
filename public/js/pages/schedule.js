/**
 * 日程计划页：待办任务管理（含计划时间 + 完成状态）
 * - 未填写计划日期或已完成的任务不会同步到首页待办
 * - 已完成项可一键取消完成
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import { toastSuccess } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import {
  listTasks,
  addTaskTracked,
  updateTaskTracked,
  removeTaskTracked,
} from '../store/scheduleStore.js';

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function dueText(due) {
  if (!due) return '';
  const t = todayStr();
  if (due === t) return '今天';
  const d1 = new Date(`${t}T00:00:00`);
  const d2 = new Date(`${due}T00:00:00`);
  const diff = Math.round((d2 - d1) / 86400000);
  const [y, mo, da] = due.split('-').map(Number);
  if (diff === 1) return '明天';
  if (diff === -1) return '昨天';
  if (diff < -1) return `已逾期 ${-diff} 天`;
  if (diff > 1) return `${mo}月${da}日（${diff}天后）`;
  return due;
}

function isOverdue(due) {
  return !!due && due < todayStr();
}

export function render(container, { rerender } = {}) {
  container.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:10px">
          <div class="section-title">添加日程 / 待办</div>
        </div>
        <form data-add-form class="task-add">
          <input class="input" data-title placeholder="要做的事，例如：回复供应商邮件" maxlength="120" autocomplete="off">
          <input type="date" class="input task-date" data-due title="计划完成日期（选填，填写后会同步到首页待办）">
          <button class="btn btn-primary btn-sm" type="submit">${icon('plus')} 添加</button>
        </form>
        <div class="field-tip">填写「计划完成日期」的待办会自动同步到首页；在首页点击即可一键完成。</div>
      </div>
    </div>

    <div class="card">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:8px">
          <div class="section-title">我的日程计划</div>
          <span class="section-sub" data-count></span>
        </div>
        <div data-list></div>
      </div>
    </div>
  `;

  const form = container.querySelector('[data-add-form]');
  const titleInput = form.querySelector('[data-title]');
  const dueInput = form.querySelector('[data-due]');
  const listBox = container.querySelector('[data-list]');
  const countEl = container.querySelector('[data-count]');

  function renderList() {
    const tasks = listTasks();
    const pending = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);
    countEl.textContent = tasks.length ? `共 ${tasks.length} 项 · 未完成 ${pending.length}` : '';

    if (!tasks.length) {
      listBox.innerHTML = `
        <div class="empty-state" style="padding:26px 16px">
          <div class="empty-icon">${icon('calendar')}</div>
          <div class="empty-sub">还没有日程计划，在上方添加第一项吧</div>
        </div>`;
      return;
    }

    const row = (t) => {
      const ov = isOverdue(t.dueDate) && !t.done;
      return `
      <div class="task-item ${t.done ? 'done' : ''} ${ov ? 'overdue' : ''}" data-id="${t.id}">
        <button class="task-check" data-toggle title="${t.done ? '标记为未完成' : '一键完成'}">${t.done ? '✓' : ''}</button>
        <div class="flex-1" style="min-width:0">
          <div class="task-title ${t.done ? 'task-title-done' : ''}">${esc(t.title)}</div>
          <div class="task-meta">
            ${t.dueDate ? `<span class="task-due ${ov ? 'task-due-over' : ''}">📅 ${dueText(t.dueDate)}</span>` : '<span class="task-due task-due-none">无计划日期</span>'}
            ${t.note ? `<span class="task-note">${esc(t.note)}</span>` : ''}
          </div>
        </div>
        <button class="task-act" data-edit title="编辑">${icon('edit')}</button>
        <button class="task-act task-del" data-del title="删除">${icon('trash')}</button>
      </div>`;
    };

    let html = '';
    if (pending.length) {
      html += `<div class="task-group-label">未完成（${pending.length}）</div>`;
      html += pending
        .slice()
        .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1)
        .map(row).join('');
    }
    if (done.length) {
      html += `<div class="task-group-label">已完成（${done.length}）</div>`;
      html += done.map(row).join('');
    }
    listBox.innerHTML = html;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    addTaskTracked({ title, dueDate: dueInput.value || '' });
    titleInput.value = '';
    dueInput.value = '';
    titleInput.focus();
    renderList();
  });

  listBox.addEventListener('click', (e) => {
    const itemEl = e.target.closest('[data-id]');
    if (!itemEl) return;
    const id = itemEl.dataset.id;
    const t = listTasks().find((x) => x.id === id);
    if (!t) return;

    if (e.target.closest('[data-toggle]')) {
      updateTaskTracked(id, { done: !t.done });
      renderList();
      return;
    }
    if (e.target.closest('[data-del]')) {
      confirmDialog({
        title: '删除日程',
        message: `确定删除「${t.title}」吗？`,
        confirmText: '删除',
        danger: true,
        onConfirm: () => { removeTaskTracked(id); renderList(); },
      });
      return;
    }
    if (e.target.closest('[data-edit]')) {
      openEditModal(t, renderList);
    }
  });

  renderList();
}

export function openEditModal(t, onSaved) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">任务内容</label>
      <input class="input" data-e-title value="${esc(t.title)}" maxlength="120" autocomplete="off">
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">计划完成日期</label>
      <input type="date" class="input task-date" data-e-due value="${esc(t.dueDate || '')}">
    </div>
    <div class="field" style="margin-bottom:4px">
      <label class="field-label">备注</label>
      <input class="input" data-e-note value="${esc(t.note || '')}" maxlength="200" autocomplete="off">
    </div>`;
  const titleInput = body.querySelector('[data-e-title]');
  const dueInput = body.querySelector('[data-e-due]');
  const noteInput = body.querySelector('[data-e-note]');

  const m = openModal({
    title: '编辑日程',
    body,
    footer: `
      <button class="btn btn-ghost" data-m-cancel>取消</button>
      <button class="btn btn-primary" data-m-save>保存</button>`,
  });
  const foot = m.el.querySelector('.modal-foot');
  foot.querySelector('[data-m-cancel]').addEventListener('click', m.close);
  foot.querySelector('[data-m-save]').addEventListener('click', () => {
    const v = titleInput.value.trim();
    if (!v) { titleInput.focus(); return; }
    updateTaskTracked(t.id, { title: v, dueDate: dueInput.value || '', note: noteInput.value || '' });
    toastSuccess('已保存');
    onSaved();
    m.close();
  });
  setTimeout(() => titleInput.focus(), 50);
}
