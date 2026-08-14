/**
 * 数据分析 · 报表模板与生成记录存储（IndexedDB）
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 *   模板 xlsx 含图片/图表，体积约 10MB，远超 localStorage 5MB 上限。
 *
 * 为什么存 ArrayBuffer 而不是 Blob：
 *   ArrayBuffer 是结构化克隆的一等公民，在各浏览器与测试环境下行为一致；
 *   Blob 在部分实现里存取会退化，且生成报表时本来就需要拿到字节。
 *
 * 对象仓库：
 *   template     模板本体（固定 key = 'current'）：{ data, name, size, savedAt, sheetNames, headers }
 *   history      生成记录元信息（自增 id）：{ id, fileName, createdAt, rowCount, sourceName, size, sheetNames }
 *   historyBlob  生成记录文件字节（key = history.id）：ArrayBuffer
 */

const DB_NAME = 'sgn-analysis';
const DB_VER = 1;
const S_TPL = 'template';
const S_HIS = 'history';
const S_BLOB = 'historyBlob';
const TPL_KEY = 'current';

/** 生成记录最多保留条数（超出自动淘汰最旧的） */
export const HISTORY_LIMIT = 20;

let dbPromise = null;

/** 当前环境是否支持 IndexedDB */
export function isSupported() {
  return typeof indexedDB !== 'undefined' && indexedDB != null;
}

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

/* ===================== 模板 ===================== */

/**
 * 保存报表模板
 * @param {{ data: ArrayBuffer, name: string, size?: number, sheetNames: string[], headers: string[] }} tpl
 */
export async function saveTemplate(tpl) {
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

/** 读取模板完整记录（含字节）；无模板返回 null */
export async function getTemplate() {
  const db = await openDB();
  const { stores } = tx(db, [S_TPL], 'readonly');
  const rec = await wrap(stores[0].get(TPL_KEY));
  return rec || null;
}

/** 只读模板元信息（不含字节，用于渲染卡片） */
export async function getTemplateMeta() {
  const rec = await getTemplate();
  if (!rec) return null;
  const { data, ...meta } = rec;
  return { ...meta, hasData: !!(data && data.byteLength) };
}

/** 删除模板 */
export async function clearTemplate() {
  const db = await openDB();
  const { t, stores } = tx(db, [S_TPL], 'readwrite');
  await wrap(stores[0].delete(TPL_KEY));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/* ===================== 生成记录 ===================== */

/**
 * 新增一条生成记录
 * @param {{ data: ArrayBuffer, fileName: string, rowCount: number, sourceName: string, sheetNames?: string[] }} rec
 * @returns {Promise<number>} 记录 id
 */
export async function addHistory(rec) {
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
  await pruneHistory();
  return id;
}

/** 生成记录列表（按时间倒序，仅元信息） */
export async function listHistory() {
  const db = await openDB();
  const { stores } = tx(db, [S_HIS], 'readonly');
  const all = await wrap(stores[0].getAll());
  return (all || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 取某条记录的文件字节（ArrayBuffer） */
export async function getHistoryData(id) {
  const db = await openDB();
  const { stores } = tx(db, [S_BLOB], 'readonly');
  return (await wrap(stores[0].get(Number(id)))) || null;
}

/** 取某条记录的元信息 */
export async function getHistoryMeta(id) {
  const db = await openDB();
  const { stores } = tx(db, [S_HIS], 'readonly');
  return (await wrap(stores[0].get(Number(id)))) || null;
}

/** 删除一条生成记录（元信息 + 文件） */
export async function deleteHistory(id) {
  const db = await openDB();
  const { t, stores } = tx(db, [S_HIS, S_BLOB], 'readwrite');
  await wrap(stores[0].delete(Number(id)));
  await wrap(stores[1].delete(Number(id)));
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/** 清空全部生成记录 */
export async function clearHistory() {
  const db = await openDB();
  const { t, stores } = tx(db, [S_HIS, S_BLOB], 'readwrite');
  await wrap(stores[0].clear());
  await wrap(stores[1].clear());
  await new Promise((res, rej) => {
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/** 超出上限时淘汰最旧记录 */
async function pruneHistory() {
  const list = await listHistory();
  if (list.length <= HISTORY_LIMIT) return;
  const extra = list.slice(HISTORY_LIMIT);
  for (const r of extra) await deleteHistory(r.id);
}
