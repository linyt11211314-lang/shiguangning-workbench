/**
 * 数据分析 · 报表模板与生成记录存储
 *
 * 双模式：
 *  - 桌面版（Electron）：window.__fs 存在 → 落盘为本地文件
 *      template： report/template.meta.json + report/template.bin
 *      history ： report/history/index.json（元信息数组）+ report/history/<id>.bin（字节）
 *  - Web / Render 版：沿用原 IndexedDB 实现（保持线上行为不变）
 *
 * 对外导出签名与旧版完全一致（isSupported / saveTemplate / getTemplate /
 * getTemplateMeta / clearTemplate / addHistory / listHistory / getHistoryData /
 * getHistoryMeta / deleteHistory / clearHistory / HISTORY_LIMIT）。
 */

const FS = typeof window !== 'undefined' ? window.__fs : null;
const FILE_MODE = !!FS;

/* ===================== 桌面版：文件存储 ===================== */

const TPL_META = 'report/template.meta.json';
const TPL_BIN = 'report/template.bin';
const HIS_DIR = 'report/history';
const HIS_INDEX = 'report/history/index.json';

/** 生成记录最多保留条数（超出自动淘汰最旧的） */
export const HISTORY_LIMIT = 20;

/** 当前环境是否支持存储（桌面版恒为 true） */
export function isSupported() {
  if (FILE_MODE) return true;
  return typeof indexedDB !== 'undefined' && indexedDB != null;
}

/* ---------- 模板 ---------- */

/**
 * 保存报表模板
 * @param {{ data: ArrayBuffer, name: string, size?: number, sheetNames: string[], headers: string[] }} tpl
 */
export async function saveTemplate(tpl) {
  if (FILE_MODE) {
    FS.writeJson(TPL_META, {
      name: tpl.name,
      size: tpl.size ?? (tpl.data ? tpl.data.byteLength : 0),
      sheetNames: tpl.sheetNames || [],
      headers: tpl.headers || [],
      savedAt: new Date().toISOString(),
    });
    FS.writeBuffer(TPL_BIN, tpl.data);
    return { ...tpl, data: undefined, hasData: true };
  }
  return _saveTemplateIDB(tpl);
}

/** 读取模板完整记录（含字节）；无模板返回 null */
export async function getTemplate() {
  if (FILE_MODE) {
    const meta = FS.readJson(TPL_META);
    if (!meta) return null;
    const data = FS.readBuffer(TPL_BIN);
    if (!data) return null;
    return { ...meta, data };
  }
  return _getTemplateIDB();
}

/** 只读模板元信息（不含字节，用于渲染卡片） */
export async function getTemplateMeta() {
  if (FILE_MODE) {
    const meta = FS.readJson(TPL_META);
    if (!meta) return null;
    const hasData = FS.exists(TPL_BIN);
    return { ...meta, hasData };
  }
  return _getTemplateMetaIDB();
}

/** 删除模板 */
export async function clearTemplate() {
  if (FILE_MODE) {
    FS.remove(TPL_META);
    FS.remove(TPL_BIN);
    return;
  }
  return _clearTemplateIDB();
}

/* ---------- 生成记录 ---------- */

/**
 * 新增一条生成记录
 * @param {{ data: ArrayBuffer, fileName: string, rowCount: number, sourceName: string, sheetNames?: string[] }} rec
 * @returns {Promise<number>} 记录 id
 */
export async function addHistory(rec) {
  if (FILE_MODE) {
    const id = Date.now();
    const meta = {
      id,
      fileName: rec.fileName,
      createdAt: new Date().toISOString(),
      rowCount: rec.rowCount || 0,
      sourceName: rec.sourceName || '',
      size: rec.data ? rec.data.byteLength : 0,
      sheetNames: rec.sheetNames || [],
    };
    FS.writeBuffer(`${HIS_DIR}/${id}.bin`, rec.data);
    const list = FS.readJson(HIS_INDEX) || [];
    list.push(meta);
    FS.writeJson(HIS_INDEX, list);
    await pruneHistory();
    return id;
  }
  return _addHistoryIDB(rec);
}

/** 生成记录列表（按时间倒序，仅元信息） */
export async function listHistory() {
  if (FILE_MODE) {
    const list = FS.readJson(HIS_INDEX) || [];
    return [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  return _listHistoryIDB();
}

/** 取某条记录的文件字节（ArrayBuffer） */
export async function getHistoryData(id) {
  if (FILE_MODE) {
    return FS.readBuffer(`${HIS_DIR}/${id}.bin`);
  }
  return _getHistoryDataIDB(id);
}

/** 取某条记录的元信息 */
export async function getHistoryMeta(id) {
  if (FILE_MODE) {
    const list = FS.readJson(HIS_INDEX) || [];
    return list.find((r) => String(r.id) === String(id)) || null;
  }
  return _getHistoryMetaIDB(id);
}

/** 删除一条生成记录（元信息 + 文件） */
export async function deleteHistory(id) {
  if (FILE_MODE) {
    FS.remove(`${HIS_DIR}/${id}.bin`);
    const list = FS.readJson(HIS_INDEX) || [];
    FS.writeJson(HIS_INDEX, list.filter((r) => String(r.id) !== String(id)));
    return;
  }
  return _deleteHistoryIDB(id);
}

/** 清空全部生成记录 */
export async function clearHistory() {
  if (FILE_MODE) {
    const list = FS.readJson(HIS_INDEX) || [];
    for (const r of list) FS.remove(`${HIS_DIR}/${r.id}.bin`);
    FS.writeJson(HIS_INDEX, []);
    return;
  }
  return _clearHistoryIDB();
}

/** 超出上限时淘汰最旧记录 */
async function pruneHistory() {
  const list = await listHistory();
  if (list.length <= HISTORY_LIMIT) return;
  const extra = list.slice(HISTORY_LIMIT);
  for (const r of extra) await deleteHistory(r.id);
}

/* ===================== Web / Render 版：IndexedDB（原实现，保持不变） ===================== */

const DB_NAME = 'sgn-analysis';
const DB_VER = 1;
const S_TPL = 'template';
const S_HIS = 'history';
const S_BLOB = 'historyBlob';
const TPL_KEY = 'current';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('当前浏览器不支持 IndexedDB，无法保存报表模板'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_TPL)) db.createObjectStore(S_TPL);
      if (!db.objectStoreNames.contains(S_HIS)) db.createObjectStore(S_HIS, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(S_BLOB)) db.createObjectStore(S_BLOB);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开本地数据库失败'));
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  return { t, stores: stores.map((s) => t.objectStore(s)) };
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'));
  });
}

async function _saveTemplateIDB(tpl) {
  const db = await openDB();
  const rec = {
    data: tpl.data,
    name: tpl.name,
    size: tpl.size ?? (tpl.data ? tpl.data.byteLength : 0),
    sheetNames: tpl.sheetNames || [],
    headers: tpl.headers || [],
    savedAt: new Date().toISOString(),
  };
  const { t, stores } = tx(db, [S_TPL], 'readwrite');
  await wrap(stores[0].put(rec, TPL_KEY));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  return { ...rec, data: undefined, hasData: true };
}

async function _getTemplateIDB() {
  const db = await openDB();
  const { stores } = tx(db, [S_TPL], 'readonly');
  const rec = await wrap(stores[0].get(TPL_KEY));
  return rec || null;
}

async function _getTemplateMetaIDB() {
  const rec = await _getTemplateIDB();
  if (!rec) return null;
  const { data, ...meta } = rec;
  return { ...meta, hasData: !!(data && data.byteLength) };
}

async function _clearTemplateIDB() {
  const db = await openDB();
  const { t, stores } = tx(db, [S_TPL], 'readwrite');
  await wrap(stores[0].delete(TPL_KEY));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

async function _addHistoryIDB(rec) {
  const db = await openDB();
  const meta = {
    fileName: rec.fileName,
    createdAt: new Date().toISOString(),
    rowCount: rec.rowCount || 0,
    sourceName: rec.sourceName || '',
    size: rec.data ? rec.data.byteLength : 0,
    sheetNames: rec.sheetNames || [],
  };
  const { t, stores } = tx(db, [S_HIS, S_BLOB], 'readwrite');
  const id = await wrap(stores[0].add(meta));
  await wrap(stores[1].put(rec.data, id));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  await _pruneHistoryIDB();
  return id;
}

async function _listHistoryIDB() {
  const db = await openDB();
  const { stores } = tx(db, [S_HIS], 'readonly');
  const all = await wrap(stores[0].getAll());
  return (all || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function _getHistoryDataIDB(id) {
  const db = await openDB();
  const { stores } = tx(db, [S_BLOB], 'readonly');
  return (await wrap(stores[0].get(Number(id)))) || null;
}

async function _getHistoryMetaIDB(id) {
  const db = await openDB();
  const { stores } = tx(db, [S_HIS], 'readonly');
  return (await wrap(stores[0].get(Number(id)))) || null;
}

async function _deleteHistoryIDB(id) {
  const db = await openDB();
  const { t, stores } = tx(db, [S_HIS, S_BLOB], 'readwrite');
  await wrap(stores[0].delete(Number(id)));
  await wrap(stores[1].delete(Number(id)));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

async function _clearHistoryIDB() {
  const db = await openDB();
  const { t, stores } = tx(db, [S_HIS, S_BLOB], 'readwrite');
  await wrap(stores[0].clear());
  await wrap(stores[1].clear());
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

async function _pruneHistoryIDB() {
  const list = await _listHistoryIDB();
  if (list.length <= HISTORY_LIMIT) return;
  const extra = list.slice(HISTORY_LIMIT);
  for (const r of extra) await _deleteHistoryIDB(r.id);
}
