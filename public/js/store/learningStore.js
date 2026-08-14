/**
 * 广告诊断 · 新手学堂学习进度（localStorage）
 * 记录用户已"掌握"的广告术语，用于认知水平评估卡与知识库面板标记。
 * 约定：仅在用户主动点击「❓ 我不懂这个词」或知识库中的术语时才计为已掌握。
 */
import { STORAGE_KEYS } from '../config.js';

const KEY = STORAGE_KEYS.ADS_LEARN;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { mastered: [], lastTerm: '', lastAt: 0 };
    const o = JSON.parse(raw);
    return { mastered: Array.isArray(o.mastered) ? o.mastered : [], lastTerm: o.lastTerm || '', lastAt: o.lastAt || 0 };
  } catch (_) {
    return { mastered: [], lastTerm: '', lastAt: 0 };
  }
}
function save(o) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch (_) {
    /* 忽略写入失败 */
  }
}

/** 标记某术语为已掌握（不重复计数） */
export function markTerm(termId) {
  const o = load();
  if (!o.mastered.includes(termId)) o.mastered.push(termId);
  o.lastTerm = termId;
  o.lastAt = Date.now();
  save(o);
  return o;
}

export function isMastered(termId) {
  return load().mastered.includes(termId);
}

export function masteredList() {
  return load().mastered;
}

export function learnedCount() {
  return load().mastered.length;
}

export function lastLearned() {
  const o = load();
  return { term: o.lastTerm, at: o.lastAt };
}

/** 认知水平标签：按已掌握数量分级 */
export function levelLabel(n) {
  if (n <= 1) return '新手';
  if (n <= 3) return '入门';
  if (n <= 5) return '进阶';
  if (n <= 7) return '熟练';
  return '精通';
}

export function clearLearning() {
  save({ mastered: [], lastTerm: '', lastAt: 0 });
}
