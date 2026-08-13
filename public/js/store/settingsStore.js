/**
 * 设置存储（DeepSeek API Key / 模型等）
 * 持久化于 localStorage
 */
import { STORAGE_KEYS, DEEPSEEK_MODELS } from '../config.js';

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.9,
  // 生成完成后是否自动保存草稿
  autoSave: true,
  // 主题：mode = light(白底) | dark(黑底)；primary = default(荧光黄) | pink | rose | mistblue | green
  mode: 'light',
  primary: 'default',
  // 显示偏好
  density: 'comfortable', // compact | comfortable | cozy
  fontSize: 'normal',     // small | normal | large
  radius: 'soft',         // soft | sharp
  followSystem: false,    // 深色主题跟随系统
  // 利润测算默认参数（设置页可自定义；sites 为空时使用内置默认）
  quoteDefaults: {
    volWeightDivisor: 6000,
    seaFreightRate: '',
    sites: {},
  },
};

let cache = null;

/** 将主题设置应用到页面（html 根节点 data-mode / data-primary / data-density / data-font-size / data-radius） */
export function applyTheme() {
  const s = getSettings();
  const root = document.documentElement;
  root.dataset.mode = s.mode === 'dark' ? 'dark' : 'light';
  root.dataset.primary = ['default', 'pink', 'rose', 'mistblue', 'green'].includes(s.primary) ? s.primary : 'default';
  root.dataset.density = ['compact', 'comfortable', 'cozy'].includes(s.density) ? s.density : 'comfortable';
  root.dataset.fontSize = ['small', 'normal', 'large'].includes(s.fontSize) ? s.fontSize : 'normal';
  root.dataset.radius = ['soft', 'sharp'].includes(s.radius) ? s.radius : 'soft';
}

let systemThemeListener = null;

/** 监听/取消监听系统深色模式变化 */
export function syncFollowSystem() {
  const s = getSettings();
  const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (!mql) return;
  if (systemThemeListener) {
    mql.removeEventListener?.('change', systemThemeListener);
    systemThemeListener = null;
  }
  if (s.followSystem) {
    systemThemeListener = (e) => {
      saveTheme({ mode: e.matches ? 'dark' : 'light' });
    };
    mql.addEventListener?.('change', systemThemeListener);
    // 立即对齐一次
    saveTheme({ mode: mql.matches ? 'dark' : 'light' });
  }
}

export function getSettings() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    cache = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch (_) {
    cache = { ...DEFAULT_SETTINGS };
  }
  // quoteDefaults 深兜底（兼容旧数据缺字段）
  cache.quoteDefaults = { ...DEFAULT_SETTINGS.quoteDefaults, ...(cache.quoteDefaults || {}) };
  cache.quoteDefaults.sites = cache.quoteDefaults.sites || {};
  return cache;
}

export function saveSettings(patch) {
  const cur = getSettings();
  cache = { ...cur, ...patch };
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(cache));
  } catch (_) { /* 存储不可用时静默 */ }
  return cache;
}

/** 保存并立即应用主题 */
export function saveTheme({ mode, primary } = {}) {
  const cur = getSettings();
  const next = {
    mode: mode || cur.mode || 'light',
    primary: primary || cur.primary || 'default',
  };
  saveSettings(next);
  applyTheme();
  return next;
}

/** 是否已配置 API Key */
export function hasApiKey() {
  return Boolean(getSettings().apiKey?.trim());
}

/** 脱敏显示：sk-****abcd */
export function maskedKey(key) {
  const k = (key || '').trim();
  if (!k) return '';
  if (k.length <= 8) return '****';
  return `${k.slice(0, 3)}****${k.slice(-4)}`;
}

export function modelLabel(modelId) {
  const m = DEEPSEEK_MODELS.find((x) => x.id === modelId);
  return m ? m.label : modelId;
}
