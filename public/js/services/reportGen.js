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
import { prepRows, computeOverview, computeCases, computeCategory, categorySummary, MONTHLY_ROWS } from './reportCalc.js';

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

/** 解 XML 实体 */
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 打补丁：重写单个单元格的值，保留原有 s= 样式
 * 数字 → <v>；文本 → inlineStr；空 → 空单元格
 */
export function patchCell(sheetXml, ref, value) {
  const re = new RegExp(`<c\\s+r="${ref}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
  if (!re.test(sheetXml)) return { xml: sheetXml, ok: false };
  const xml = sheetXml.replace(re, (m, attrs) => {
    const a = String(attrs).replace(/\s*t="[^"]*"/g, '');
    if (value === '' || value == null) return `<c r="${ref}"${a}/>`;
    if (typeof value === 'number') return `<c r="${ref}"${a}><v>${value}</v></c>`;
    return `<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  });
  return { xml, ok: true };
}

/** 解析共享字符串表（兼容富文本多 <t>） */
export async function parseSharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml');
  if (!f) return [];
  const xml = await f.async('string');
  const arr = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    arr.push(unescapeXml(text));
  }
  return arr;
}

/** 解析指定 Sheet 的 A/B 两列文本（SKU → 品名），兼容共享字符串 / inlineStr / 直接值 */
export async function parseColsAB(zip, path, shared, minRow = 1, maxRow = 100000) {
  if (!path || !zip.file(path)) return {};
  const xml = await zip.file(path).async('string');
  const map = {};
  for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = Number(rm[1]);
    if (r < minRow || r > maxRow) continue;
    const vals = {};
    for (const cm of rm[2].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const L = cm[1];
      const attrs = cm[2] || '';
      const inner = cm[3] || '';
      const tM = attrs.match(/\bt="([^"]+)"/);
      const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
      let val = '';
      if (tM && tM[1] === 's' && vM) val = shared[Number(vM[1])] ?? '';
      else if (vM) val = vM[1];
      else if (tM && tM[1] === 'inlineStr') {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = t ? t[1] : '';
      }
      vals[L] = unescapeXml(val);
    }
    if (vals.A && vals.B) map[vals.A] = vals.B;
  }
  return map;
}

/** 解析 Sheet 单列文本列表（如类目汇总 A4:A24） */
export async function parseColumnList(zip, path, shared, refs) {
  if (!path || !zip.file(path)) return [];
  const xml = await zip.file(path).async('string');
  const out = [];
  for (const ref of refs) {
    const m = xml.match(new RegExp(`<c\\s+r="${ref}"([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`));
    if (!m) continue;
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const tM = attrs.match(/\bt="([^"]+)"/);
    const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
    let val = '';
    if (tM && tM[1] === 's' && vM) val = shared[Number(vM[1])] ?? '';
    else if (vM) val = vM[1];
    val = unescapeXml(val).trim();
    if (val) out.push(val);
  }
  return out;
}

/** 生成 A4..A24 这类引用列表 */
function rangeRefs(from, to, col) {
  const out = [];
  for (let r = from; r <= to; r++) out.push(`${col}${r}`);
  return out;
}

/** 打 5 行案例块补丁（A~H），空行清空 */
function patchCaseBlock(sheetXml, rows, startRow) {
  let s = sheetXml;
  for (let i = 0; i < 5; i++) {
    const r = startRow + i;
    const d = rows[i];
    if (d) {
      s = patchCell(s, `A${r}`, d.sku).xml;
      s = patchCell(s, `B${r}`, d.name).xml;
      s = patchCell(s, `C${r}`, d.shop).xml;
      s = patchCell(s, `D${r}`, d.qty).xml;
      s = patchCell(s, `E${r}`, d.qty30).xml;
      s = patchCell(s, `F${r}`, d.profit).xml;
      s = patchCell(s, `G${r}`, d.refundRate).xml;
      s = patchCell(s, `H${r}`, d.advice || '').xml;
    } else {
      for (const L of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) s = patchCell(s, `${L}${r}`, '').xml;
    }
  }
  return s;
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

  say(68, '正在同步公式引用范围…');  // 数据超出模板容量 → 扩展 VLOOKUP 引用范围 / autoFilter / 定义名称
  const lookupEnd = Math.max(tplEnd, lastRow);
  const expanded = tplEnd > 0 && lastRow > tplEnd;
  if (expanded) {
    sheet = sheet.replace(
      new RegExp(`(<autoFilter[^>]*ref=")([A-Z]+\\d+:[A-Z]+)${tplEnd}(")`),
      (m, a, b, c) => `${a}${b}${lookupEnd}${c}`
    );
  }
  zip.file(dsPath, sheet);

  // ===== 三 Sheet 重算补丁：概况 / 案例分析 / 全店铺全SKU类目汇总 =====
  // 这三个 Sheet 在模板里是硬编码快照（无公式），必须用上传数据重算后写回
  say(70, '正在重算概况 / 案例分析 / 类目汇总…');
  const patched = { overview: false, cases: false, category: false };
  try {
    const shared = await parseSharedStrings(zip);
    const perfPath = sheetPath('产品表现');
    const ovPath = sheetPath('概况');
    const casePath = sheetPath('案例分析');
    const catPath = sheetPath('全店铺全SKU类目汇总');

    const skuNameMap = await parseColsAB(zip, perfPath, shared, 3);
    const prepped = prepRows(rows);
    const ov = computeOverview(prepped);
    const cases = computeCases(prepped, skuNameMap);

    if (ovPath && zip.file(ovPath)) {
      let s3 = await zip.file(ovPath).async('string');
      for (const [ref, v] of Object.entries(ov.kpis)) s3 = patchCell(s3, ref, v).xml;
      for (let i = 0; i < MONTHLY_ROWS; i++) {
        const row = 5 + i;
        const m = ov.monthly[i];
        if (m) {
          s3 = patchCell(s3, `D${row}`, m.ym).xml;
          s3 = patchCell(s3, `E${row}`, m.skuCount).xml;
          s3 = patchCell(s3, `F${row}`, m.qty).xml;
          s3 = patchCell(s3, `G${row}`, m.qty30).xml;
          s3 = patchCell(s3, `H${row}`, m.sales).xml;
          s3 = patchCell(s3, `I${row}`, m.profit).xml;
          s3 = patchCell(s3, `J${row}`, m.margin).xml;
          s3 = patchCell(s3, `K${row}`, m.refundQty).xml;
          s3 = patchCell(s3, `L${row}`, m.refundRate).xml;
          s3 = patchCell(s3, `M${row}`, m.adSpend).xml;
        } else {
          for (const L of ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) s3 = patchCell(s3, `${L}${row}`, '').xml;
        }
      }
      s3 = patchCell(s3, 'E15', ov.profitState.pos).xml;
      s3 = patchCell(s3, 'E16', ov.profitState.neg).xml;
      s3 = patchCell(s3, 'E22', ov.summary[0]).xml;
      s3 = patchCell(s3, 'E23', ov.summary[1]).xml;
      s3 = patchCell(s3, 'E24', ov.summary[2]).xml;
      zip.file(ovPath, s3);
      patched.overview = true;
    }

    if (casePath && zip.file(casePath)) {
      let s4 = await zip.file(casePath).async('string');
      s4 = patchCaseBlock(s4, cases.topSales, 6);
      s4 = patchCell(s4, 'H6', cases.topAdvice).xml;
      s4 = patchCaseBlock(s4, cases.lossLeaders, 15);
      s4 = patchCaseBlock(s4, cases.refundTop, 24);
      s4 = patchCaseBlock(s4, cases.zeroSales, 33);
      s4 = patchCell(s4, 'H33', cases.zeroSales.length ? '零销量产品，建议检查链接状态、优化主图或清库存' : '').xml;
      zip.file(casePath, s4);
      patched.cases = true;
    }

    if (catPath && zip.file(catPath)) {
      const tplCats = await parseColumnList(zip, catPath, shared, rangeRefs(4, 24, 'A'));
      const catRows = computeCategory(prepped, tplCats.length ? tplCats : ['未识别类目']);
      let s6 = await zip.file(catPath).async('string');
      for (let i = 0; i < catRows.length; i++) {
        const row = 4 + i;
        const d = catRows[i];
        s6 = patchCell(s6, `A${row}`, d.cat).xml;
        s6 = patchCell(s6, `B${row}`, d.skuCount).xml;
        s6 = patchCell(s6, `C${row}`, d.qty).xml;
        s6 = patchCell(s6, `D${row}`, d.qty30).xml;
        s6 = patchCell(s6, `E${row}`, d.sales).xml;
        s6 = patchCell(s6, `F${row}`, d.profit).xml;
        s6 = patchCell(s6, `G${row}`, d.margin).xml;
        s6 = patchCell(s6, `H${row}`, d.refundQty).xml;
        s6 = patchCell(s6, `I${row}`, d.refundRate).xml;
        s6 = patchCell(s6, `J${row}`, d.adSpend).xml;
      }
      s6 = patchCell(s6, 'A28', categorySummary(catRows)).xml;
      zip.file(catPath, s6);
      patched.category = true;
    }
  } catch (err) {
    // 补丁失败不影响主数据写入（领星数据源已成功），仅记录
    say(71, `提示：概况/案例/类目重算失败（${err.message}），其余部分照常生成`);
    await tick();
  }

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

  return {
    data,
    blob: toXlsxBlob(data),
    rowCount: rows.length,
    dimension,
    lookupEnd,
    expanded,
    pivotCount,
    patched,
  };
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
