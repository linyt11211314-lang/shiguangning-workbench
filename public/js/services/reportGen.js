/**
 * 数据分析 · 保真报表生成（OOXML 原样手术）
 * 依赖全局 JSZip（/vendor/jszip.min.js）
 *
 * 为什么不用 SheetJS 写出：
 *   SheetJS 写 xlsx 会丢弃数据透视表、图表、条件格式与图片。
 *   本模块把 .xlsx 当作 zip 包直接改内部 XML，只重写「领星数据源」的
 *   <sheetData>，其余零改动，因此公式 / 图表 / 4 个透视表 / DISPIMG 图片
 *   100% 保留，与模板格式完全一致。
 *
 * 手术清单：
 *   1. xl/worksheets/sheetN.xml（领星数据源）：保留表头行原样，重写数据行
 *      —— 每列的单元格类型与样式索引沿用模板第一条数据行，数字格式不变
 *   2. <dimension> 更新为实际数据范围
 *   3. 数据行数超出模板容量时，同步扩展所有 VLOOKUP 引用范围、
 *      autoFilter 与 _FilterDatabase 定义名称
 *   4. xl/workbook.xml：<calcPr fullCalcOnLoad="1"/> 打开即全表重算
 *   5. xl/pivotCache/pivotCacheDefinition*.xml：refreshOnLoad="1" 打开即刷新透视表
 */

import { DATA_SHEET } from './reportTemplate.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 校验 JSZip 依赖 */
function ensureJSZip() {
  if (typeof JSZip === 'undefined' || !JSZip || !JSZip.loadAsync) {
    throw new Error('报表打包组件未加载，请刷新页面后重试');
  }
  return JSZip;
}

/* ===================== 基础工具 ===================== */

/** 列序号 → 列字母（1 → A，27 → AA） */
export function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** XML 文本转义 */
function xmlEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 正则元字符转义（用于按 Sheet 名构造正则） */
function reEsc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把单元格取值转成数字；支持千分位、百分号、货币符号
 * @returns {number|null} 无法转成数字返回 null
 */
export function toNumber(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === '' || v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  const pct = /%$/.test(s);
  s = s.replace(/[,\s¥$￥€£]/g, '').replace(/%$/, '');
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/* ===================== 模板列信息提取 ===================== */

/**
 * 从模板数据行解析每列的「类型 + 样式」，用于生成时保持格式
 * @param {string} sheetXml
 * @param {string[]} colLetters 表头列字母
 * @returns {Object<string, { style: string|null, mode: 'text'|'num'|'auto' }>}
 */
function readColumnStyles(sheetXml, colLetters) {
  const info = {};
  colLetters.forEach((L) => {
    info[L] = { style: null, mode: 'auto' };
  });

  // 找模板第一条数据行（r=2；若无则退回 r=3）
  let rowXml = null;
  for (const r of [2, 3, 4]) {
    const m = sheetXml.match(new RegExp(`<row r="${r}"[^>]*>[\\s\\S]*?</row>`));
    if (m) {
      rowXml = m[0];
      break;
    }
  }
  if (!rowXml) return info;

  const cells = [...rowXml.matchAll(/<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)];
  for (const c of cells) {
    const attrs = c[1] || '';
    const inner = c[3] || '';
    const refM = attrs.match(/r="([A-Z]+)\d+"/);
    if (!refM) continue;
    const L = refM[1];
    if (!info[L]) continue;
    const sM = attrs.match(/\bs="(\d+)"/);
    const tM = attrs.match(/\bt="([^"]+)"/);
    const t = tM ? tM[1] : '';
    let mode = 'auto';
    if (t === 's' || t === 'str' || t === 'inlineStr') mode = 'text';
    else if (!t && /<v>/.test(inner)) mode = 'num';
    info[L] = { style: sM ? sM[1] : null, mode };
  }
  return info;
}

/** 提取模板数据行的行属性（行高等），生成行时沿用 */
function readRowAttrs(sheetXml, colCount) {
  const m = sheetXml.match(/<row r="2"([^>]*)>/);
  let attrs = m ? m[1] : '';
  // 去掉可能存在的 spans，改为按实际列数重建
  attrs = attrs.replace(/\s*spans="[^"]*"/, '');
  return `${attrs} spans="1:${colCount}"`;
}

/** 生成单个单元格 XML */
function cellXML(ref, value, colInfo) {
  const st = colInfo && colInfo.style ? ` s="${colInfo.style}"` : '';
  if (value === '' || value == null) return `<c r="${ref}"${st}/>`;
  const mode = (colInfo && colInfo.mode) || 'auto';
  if (mode === 'text') {
    return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  }
  const n = toNumber(value);
  if (n != null) return `<c r="${ref}"${st}><v>${n}</v></c>`;
  // 数字列里出现文本（如「-」「暂无」）：按文本写入，保留样式不报错
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}

/* ===================== 主流程 ===================== */

/**
 * 生成报表
 * @param {Object} opt
 * @param {Blob|ArrayBuffer} opt.templateBlob 模板文件
 * @param {string[]} opt.headers 模板「领星数据源」表头（顺序与列一致）
 * @param {Object[]} opt.rows 数据行（键为模板表头）
 * @param {(p: { pct: number, text: string }) => void} [opt.onProgress]
 * @returns {Promise<{ blob: Blob, rowCount: number, dimension: string, lookupEnd: number, expanded: boolean, pivotCount: number }>}
 */
export async function generateReport({ templateBlob, headers, rows, onProgress }) {
  const Z = ensureJSZip();
  const say = (pct, text) => {
    if (typeof onProgress === 'function') onProgress({ pct, text });
  };

  if (!templateBlob) throw new Error('未找到报表模板，请先加载模板');
  if (!headers || !headers.length) throw new Error('模板表头为空，无法写入数据');
  if (!rows || !rows.length) throw new Error('没有可写入的数据行，请先上传领星数据');

  say(5, '正在读取模板包…');
  // 统一转成 ArrayBuffer：Blob / File / ArrayBuffer / Uint8Array 都能吃
  const bin = typeof templateBlob.arrayBuffer === 'function' ? await templateBlob.arrayBuffer() : templateBlob;
  let zip;
  try {
    zip = await Z.loadAsync(bin);
  } catch (_) {
    throw new Error('模板文件无法解析，请重新加载模板');
  }

  const wbPath = 'xl/workbook.xml';
  const relPath = 'xl/_rels/workbook.xml.rels';
  if (!zip.file(wbPath) || !zip.file(relPath)) throw new Error('模板结构异常：缺少 workbook 主文件');

  const wbXml = await zip.file(wbPath).async('string');
  const relsXml = await zip.file(relPath).async('string');

  // Sheet 名 → rId → 实际 xml 路径
  const sheetEls = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  const rid2tgt = {};
  [...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].forEach((m) => {
    rid2tgt[m[1]] = m[2];
  });
  const sheetPath = (nm) => {
    for (const m of sheetEls) {
      if (m[1] === nm) {
        const t = rid2tgt[m[2]];
        if (!t) return null;
        return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
      }
    }
    return null;
  };

  const dsPath = sheetPath(DATA_SHEET);
  if (!dsPath || !zip.file(dsPath)) throw new Error(`模板中找不到「${DATA_SHEET}」工作表`);

  say(18, '正在定位数据源表头…');
  let sheet = await zip.file(dsPath).async('string');

  const row1 = sheet.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
  if (!row1) throw new Error(`「${DATA_SHEET}」缺少表头行，模板不完整`);
  const headerRowXML = row1[0];

  const colLetters = [...headerRowXML.matchAll(/<c\s+[^>]*r="([A-Z]+)1"/g)].map((m) => m[1]);
  if (!colLetters.length) throw new Error(`「${DATA_SHEET}」表头行没有单元格，模板不完整`);

  const colCount = Math.min(colLetters.length, headers.length);
  const colInfo = readColumnStyles(sheet, colLetters);
  const rowAttrs = readRowAttrs(sheet, colCount);

  // 模板原始数据容量（用于判断是否需要扩展公式引用范围）
  const dimM = sheet.match(/<dimension[^>]*ref="([A-Z]+\d+:[A-Z]+(\d+))"/);
  const tplEnd = dimM ? Number(dimM[2]) : 0;

  say(30, `正在写入 ${rows.length.toLocaleString('zh-CN')} 行数据…`);
  const parts = [headerRowXML];
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2;
    const src = rows[i] || {};
    let cells = '';
    for (let c = 0; c < colCount; c++) {
      const L = colLetters[c];
      cells += cellXML(L + r, src[headers[c]], colInfo[L]);
    }
    parts.push(`<row r="${r}"${rowAttrs}>${cells}</row>`);
    if (i % 2000 === 0 && i > 0) {
      say(30 + Math.round((i / rows.length) * 35), `正在写入第 ${i.toLocaleString('zh-CN')} 行…`);
      await tick();
    }
  }
  const body = parts.join('');

  if (/<sheetData\s*\/>/.test(sheet)) sheet = sheet.replace(/<sheetData\s*\/>/, `<sheetData>${body}</sheetData>`);
  else sheet = sheet.replace(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${body}</sheetData>`);

  const lastRow = rows.length + 1;
  const dimension = `A1:${colLetter(colLetters.length)}${lastRow}`;
  if (/<dimension[^>]*\/>/.test(sheet)) sheet = sheet.replace(/<dimension[^>]*\/>/, `<dimension ref="${dimension}"/>`);

  say(68, '正在同步公式引用范围…');
  // 数据超出模板容量 → 扩展 VLOOKUP 引用范围 / autoFilter / 定义名称
  const lookupEnd = Math.max(tplEnd, lastRow);
  const expanded = tplEnd > 0 && lastRow > tplEnd;
  if (expanded) {
    sheet = sheet.replace(
      new RegExp(`(<autoFilter[^>]*ref=")([A-Z]+\\d+:[A-Z]+)${tplEnd}(")`),
      (m, a, b, c) => `${a}${b}${lookupEnd}${c}`
    );
  }
  zip.file(dsPath, sheet);

  let wbMod = wbXml;
  if (expanded) {
    const rangeRe = new RegExp(`((?:'${reEsc(DATA_SHEET)}'|${reEsc(DATA_SHEET)})!\\$?[A-Z]+\\$?1:\\$?[A-Z]+\\$?)${tplEnd}\\b`, 'g');
    wbMod = wbMod.replace(rangeRe, (m, p1) => `${p1}${lookupEnd}`);
    for (const m of sheetEls) {
      const p = sheetPath(m[1]);
      if (!p || p === dsPath || !zip.file(p)) continue;
      let s = await zip.file(p).async('string');
      if (!rangeRe.test(s)) continue;
      rangeRe.lastIndex = 0;
      s = s.replace(rangeRe, (mm, p1) => `${p1}${lookupEnd}`);
      zip.file(p, s);
    }
  }

  say(80, '正在设置打开即重算…');
  if (/<calcPr\b/.test(wbMod)) {
    wbMod = wbMod.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => {
      const attrs = String(a).replace(/\s*fullCalcOnLoad="[^"]*"/g, '').replace(/\s*forceFullCalc="[^"]*"/g, '');
      return `<calcPr${attrs} fullCalcOnLoad="1"/>`;
    });
  } else if (/<\/sheets>/.test(wbMod)) {
    wbMod = wbMod.replace('</sheets>', '</sheets><calcPr fullCalcOnLoad="1"/>');
  }
  zip.file(wbPath, wbMod);

  say(88, '正在标记数据透视表刷新…');
  // 透视表刷新：refreshOnLoad 属性属于 pivotCacheDefinition（非 pivotTableDefinition）
  let pivotCount = 0;
  const cacheFiles = Object.keys(zip.files).filter((n) => /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(n));
  for (const cf of cacheFiles) {
    let p = await zip.file(cf).async('string');
    p = p.replace(/<pivotCacheDefinition\b([^>]*?)(\/?)>/, (m, a, slash) => {
      const attrs = String(a)
        .replace(/\s*refreshOnLoad="[^"]*"/g, '')
        .replace(/\s*enableRefresh="[^"]*"/g, '');
      return `<pivotCacheDefinition${attrs} refreshOnLoad="1" enableRefresh="1"${slash}>`;
    });
    zip.file(cf, p);
    pivotCount += 1;
  }

  say(93, '正在打包 Excel 文件…');
  await tick();
  // 输出 ArrayBuffer：既能直接存 IndexedDB，也能包成 Blob 下载
  const data = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  say(100, '报表生成完成');

  return { data, blob: toXlsxBlob(data), rowCount: rows.length, dimension, lookupEnd, expanded, pivotCount };
}

/** 字节 → 可下载的 xlsx Blob */
export function toXlsxBlob(data) {
  return new Blob([data], { type: XLSX_MIME });
}

/** 让出主线程，避免大数据量写入时页面卡死 */
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

/** 触发浏览器下载 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 默认报表文件名：模板名 + 年月 */
export function defaultReportName(templateName) {
  const base = String(templateName || 'AE品牌产品分析').replace(/\.xlsx$/i, '').replace(/^\d+月/, '');
  const d = new Date();
  const ym = `${d.getFullYear()}年${d.getMonth() + 1}月`;
  return `${ym}${base}.xlsx`;
}
