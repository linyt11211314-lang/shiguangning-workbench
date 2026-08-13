/**
 * 广告诊断 · 建议反馈存储（localStorage）
 * 记录用户对每条诊断建议的「采纳 / 忽略」反馈，用于统计与历史回看。
 * 反馈记录以「站点 + 规则 key」作为逻辑标识，便于在面板中标记已处理状态。
 */
import { STORAGE_KEYS } from '../config.js';

const KEY = STORAGE_KEYS.FEEDBACK;
const MAX = 200;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function save(arr) {
  try {
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) {
    throw new Error('本地存储空间不足，请清理旧数据后重试');
  }
}

/** 新增一条反馈记录 */
export function addFeedback(rec) {
  const arr = load();
  const item = {
    id: rec.id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    site: rec.site,
    ruleKey: rec.ruleKey,
    priority: rec.priority,
    content: rec.content || '',
    trigger: rec.trigger || '',
    feedback: rec.feedback, // 'accept' | 'ignore'
    at: rec.at || Date.now(),
  };
  arr.unshift(item);
  if (arr.length > MAX) arr.length = MAX;
  save(arr);
  return item;
}

/** 全部反馈（按时间倒序） */
export function listFeedback() {
  return load();
}

/** 统计：采纳 / 忽略 / 采纳率 */
export function feedbackStats() {
  const arr = load();
  const accept = arr.filter((x) => x.feedback === 'accept').length;
  const ignore = arr.filter((x) => x.feedback === 'ignore').length;
  const total = accept + ignore;
  const rate = total ? (accept / total) * 100 : 0;
  return { accept, ignore, total, rate };
}

/** 查询某站点某规则的最新一条反馈（用于面板标记已处理，按站点+规则维度） */
export function latestFeedback(site, ruleKey) {
  const arr = load();
  for (const x of arr) {
    if (x.site === site && x.ruleKey === ruleKey) return x;
  }
  return null;
}

/** 按建议 id 精确查询最新反馈（用于关键词/活动级：同站点同规则但不同对象需各自标记） */
export function feedbackById(id) {
  const arr = load();
  for (const x of arr) {
    if (x.id === id) return x;
  }
  return null;
}

/** 清空全部反馈记录 */
export function clearFeedback() {
  save([]);
}
