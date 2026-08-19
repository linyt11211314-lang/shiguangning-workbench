/**
 * Electron 预加载脚本（在渲染进程页面脚本之前执行，与页面共享同一个 window）
 *
 * 关键职责：把浏览器的 localStorage 重定向到本地硬盘文件，
 * 让原本写 localStorage 的全部 store（设置 / 选品库 / Listing / 广告 / 统计 / 日程 等）
 * 自动持久化到「文档/拾光柠工作台数据」下的 <key>.json 文件。
 *
 * 同时暴露 window.__fs（二进制/目录级文件句柄），供 reportStore 把报表模板与
 * 生成记录（含 10MB 模板字节）落盘为真实文件。
 *
 * 设计取舍：本应用仅加载本机 localhost 内容、无第三方远程脚本，
 * 故采用 contextIsolation:false，使预加载可直接覆盖 window.localStorage。
 */
const fs = require('fs');
const path = require('path');
const core = require('./storage-core.js');

const dataDir = process.env.SGN_DATA_DIR || path.join(process.cwd(), 'sgn-data');
try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (_) {
  /* 忽略 */
}

const jsonStore = core.createJsonStore(dataDir);

const shim = {
  getItem(k) {
    return jsonStore.get(k);
  },
  setItem(k, v) {
    jsonStore.set(k, String(v));
  },
  removeItem(k) {
    jsonStore.remove(k);
  },
  clear() {
    jsonStore.clear();
  },
  key(i) {
    return jsonStore.key(i);
  },
  get length() {
    return jsonStore.length();
  },
};

// 覆盖 window.localStorage：用 data 属性遮蔽原型上的访问器
try {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    enumerable: true,
    get() {
      return shim;
    },
    set() {
      /* 忽略业务代码对 localStorage 的赋值尝试 */
    },
  });
} catch (_) {
  try {
    window.localStorage = shim;
  } catch (e) {
    console.warn('[preload] 无法覆盖 window.localStorage，将沿用 Chromium 默认实现', e && e.message);
  }
}

// 二进制/目录级文件句柄（报表模板、生成记录）
window.__fs = core.createFsHandle(dataDir);
window.__SGN_FILE_STORAGE = true;
