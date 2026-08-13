/**
 * 日程计划 / 待办存储（localStorage 持久化）
 *
 * 任务字段：
 * {
 *   id,
 *   title,         // 任务内容
 *   dueDate,       // 计划完成日期 'YYYY-MM-DD'（可选，未填则不同步到首页待办）
 *   note,          // 备注（可选）
 *   done,          // 是否完成
 *   createdAt,
 *   updatedAt,
 *   completedAt,   // 完成时间戳（可选）
 * }
 */
import { STORAGE_KEYS } from '../config.js';
import { uid } from '../utils.js';

let tasks = null;

function load() {
  if (tasks) return tasks;
  try {
    tasks = JSON.parse(localStorage.getItem(STORAGE_KEYS.SCHEDULE)) || [];
  } catch (_) {
    tasks = [];
  }
  return tasks;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE, JSON.stringify(tasks));
  } catch (_) { /* 存储超限时忽略，避免崩溃 */ }
}

export function listTasks() {
  return [...load()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * 待同步到首页的待办：已填写计划日期且未完成，按 dueDate 升序（越早越靠前）。
 */
export function listPendingWithDue() {
  return load()
    .filter((t) => !t.done && t.dueDate)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export function getTask(id) {
  return load().find((t) => t.id === id) || null;
}

export function addTask(data) {
  const now = Date.now();
  const item = {
    id: uid('task'),
    title: (data.title || '').trim(),
    dueDate: data.dueDate || '',
    note: data.note || '',
    done: false,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  load().push(item);
  persist();
  return item;
}

export function updateTask(id, data) {
  const list = load();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const patch = { ...data, updatedAt: Date.now() };
  if (data.done === true && !list[idx].done) patch.completedAt = Date.now();
  if (data.done === false) patch.completedAt = null;
  list[idx] = { ...list[idx], ...patch, id };
  persist();
  return list[idx];
}

export function removeTask(id) {
  load();
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length !== before) persist();
}

export function countPending() {
  return load().filter((t) => !t.done).length;
}

export function countPendingWithDue() {
  return load().filter((t) => !t.done && t.dueDate).length;
}

const listeners = new Set();
export function onScheduleChange(fn) { listeners.add(fn); }
export function notifyScheduleChange() { listeners.forEach((fn) => fn()); }

export function addTaskTracked(data) { const r = addTask(data); notifyScheduleChange(); return r; }
export function updateTaskTracked(id, data) { const r = updateTask(id, data); if (r) notifyScheduleChange(); return r; }
export function removeTaskTracked(id) { removeTask(id); notifyScheduleChange(); }
