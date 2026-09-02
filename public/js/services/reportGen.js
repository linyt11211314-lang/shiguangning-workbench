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
import { SKU_HEADER } from './dataImport.js';

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
    if (typeof value === 'string' && value.startsWith('=')) {
      // 公式：保留 <f>，v 占位 0 由 Excel/WPS 打开时 fullCalcOnLoad 自动重算
      return `<c r="${ref}"${a}><f>${xmlEsc(value.slice(1))}</f><v>0</v></c>`;
    }
    return `<c r="${ref}"${a} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  });
  return { xml, ok: true };
}

/**
 * 在 afterRow 行之后插入 count 个空行（克隆 afterRow 行的 D~M 单元格样式、清空值），
 * 并把 afterRow 以下的所有行号与单元格引用整体下移 count（同步 mergedCell / dimension）。
 * 用于概况月度表超过模板 9 行容量时动态扩容，保证最旧的上架月份（如 2025-10）不被静默丢弃。
 */
export function insertSheetRows(sheetXml, afterRow, count) {
  if (!count || count <= 0) return sheetXml;
  const after = Number(afterRow);
  const rowOf = (ref) => Number(String(ref).match(/\d+/)[0]);
  const colOf = (ref) => String(ref).match(/[A-Z]+/)[0];
  // 1) afterRow 以下行号与单元格引用整体 +count（先平移，避免与新插入行号冲突）
  sheetXml = sheetXml.replace(/<row\b([^>]*?)\br="(\d+)"([^>]*)>/g, (m, pre, r, post) => {
    const R = Number(r);
    return R > after ? `<row${pre}r="${R + count}"${post}>` : m;
  });
  sheetXml = sheetXml.replace(/<c\b([^>]*?)\br="([A-Z]+)(\d+)"([^>]*)>/g, (m, pre, col, r, post) => {
    const R = Number(r);
    return R > after ? `<c${pre}r="${col}${R + count}"${post}>` : m;
  });
  sheetXml = sheetXml.replace(/<mergeCell\b([^>]*?)\bref="([A-Z]+\d+):([A-Z]+\d+)"/g, (m, pre, a, b) => {
    const ra = rowOf(a), rb = rowOf(b);
    if (ra > after || rb > after) return `<mergeCell${pre}ref="${colOf(a)}${ra + count}:${colOf(b)}${rb + count}"`;
    return m;
  });
  // 2) 克隆 afterRow 行生成新行（保留样式、清空值）
  const lastRowM = sheetXml.match(new RegExp(`(<row\\b[^>]*?\\br="${after}"[^>]*>)([^]*?)<\\/row>`));
  let newRowsXml = '';
  if (lastRowM) {
    const openTag = lastRowM[1].replace(`r="${after}"`, 'TMPROW');
    for (let k = 1; k <= count; k++) {
      const r = after + k;
      const rowInner = lastRowM[2]
        .replace(/<v>[\s\S]*?<\/v>/g, '')
        .replace(/<is>[\s\S]*?<\/is>/g, '')
        .replace(/<f>[\s\S]*?<\/f>/g, '')
        .replace(/\s+t="[^"]*"/g, '')
        .replace(new RegExp(`r="([A-Z]+)${after}"`, 'g'), `r="$1${r}"`);
      newRowsXml += `${openTag.replace('TMPROW', `r="${r}"`)}${rowInner}</row>`;
    }
  } else {
    const cols = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    for (let k = 1; k <= count; k++) {
      const r = after + k;
      newRowsXml += `<row r="${r}">${cols.map((c) => `<c r="${c}${r}"/>`).join('')}</row>`;
    }
  }
  // 3) 新行插入到 afterRow 行之后
  sheetXml = sheetXml.replace(new RegExp(`(<row\\b[^>]*?\\br="${after}"[^>]*>[^]*?<\\/row>)`), `$1${newRowsXml}`);
  // 4) 更新 dimension 末行
  sheetXml = sheetXml.replace(/<dimension\b([^>]*?)\bref="([A-Z]+)1:([A-Z]+)(\d+)"/g, (m, pre, c1, c2, end) => {
    const newEnd = Math.max(Number(end), 24 + count);
    return `<dimension${pre}ref="${c1}1:${c2}${newEnd}"`;
  });
  return sheetXml;
}

/** 同步概况月度趋势图引用：概况!$D$5:$M$<旧末行> / 概况!$D$5:$D$<旧末行> → 新末行 */
export async function syncChartMonthlyRange(zip, sheetName, oldEnd, newEnd) {
  if (oldEnd === newEnd) return;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const files = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d*\.xml$/.test(n));
  // sheet 名兼容带/不带单引号两种写法（'概况'! 或 概况!）
  const sheetPart = `(?:'?)${esc(sheetName)}(?:'?)!`;
  const reM = new RegExp(`(${sheetPart}\\$D\\$5:\\$M\\$)${oldEnd}\\b`, 'g');
  const reD = new RegExp(`(${sheetPart}\\$D\\$5:\\$D\\$)${oldEnd}\\b`, 'g');
  for (const f of files) {
    let x = await zip.file(f).async('string');
    const before = x;
    x = x.replace(reM, `$1${newEnd}`).replace(reD, `$1${newEnd}`);
    if (x !== before) zip.file(f, x);
  }
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
  if (!path || !zip.file(path)) return { map: {}, skuList: [] };
  const xml = await zip.file(path).async('string');
  const map = {};
  const skuList = [];
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
    if (vals.A) skuList.push(vals.A);
  }
  return { map, skuList };
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

/**
 * 产品表现 sheet 动态重建（上传了当月产品表现表时）
 * 保留 row1（标题）/ row2（表头），数据行按新 SKU 清单重建：
 *   A=SKU、B=品名（inlineStr，样式沿用模板）、C=空（DISPIMG 图片无法从普通表移植）、
 *   D~P=复制模板第 3 行公式并把本表相对行号替换为新行号（P 列共享公式展开为独立公式）
 * @returns {Promise<{ endRow: number }>} endRow = 最后一行行号
 */
export async function rebuildProductSheet(zip, path, product, lookupEnd) {
  let s2 = await zip.file(path).async('string');
  const row1 = s2.match(/<row r="1"[^>]*>[\s\S]*?<\/row>/);
  const row2 = s2.match(/<row r="2"[^>]*>[\s\S]*?<\/row>/);
  const row3 = s2.match(/<row r="3"[^>]*>[\s\S]*?<\/row>/);
  if (!row1 || !row2 || !row3) throw new Error('产品表现 sheet 结构异常，无法重建');
  const rowAttrs = (row3[0].match(/<row r="3"([^>]*)>/) || [])[1] || '';

  // 从 row3 提取每列：样式 + 公式体（含 &quot; 实体原样）
  const colDefs = {};
  for (const cm of row3[0].matchAll(/<c r="([A-P])\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const L = cm[1];
    const attrs = cm[2] || '';
    const inner = cm[3] || '';
    const sM = attrs.match(/\bs="(\d+)"/);
    const fM = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/);
    colDefs[L] = { style: sM ? sM[1] : null, formula: fM ? fM[1] : null };
  }

  // 修正 I 列 VLOOKUP 第4参数 3(近似匹配)→FALSE(精确匹配)。原公式形如
  // VLOOKUP($A3,领星数据源!$A:$AY$39109,3,3,FALSE) —— 第4参数写成 3 会被 Excel 当作 TRUE(近似)，
  // 导致个别 SKU 在升序不严格的列上取到错误行、归错月份，与概况口径错位。改为精确匹配，与概况一致。
  if (colDefs.I && colDefs.I.formula) {
    colDefs.I.formula = colDefs.I.formula.replace(/,\s*3\s*,\s*3\s*,\s*FALSE\b/, ',3,FALSE');
  }

  // 公式行号替换：
  //   本表引用 $A3 / O3 / $A$3 → 行号 = r（当前产品表现行，列范围仅限 [A-P]，产品表现只有 A~P 列）
  //   外部 sheet 引用 sheet!$A$1:$V$8601 → 范围末行 = lookupEnd（领星数据源总行数），保持 sheet 名前缀
  //   旧版只覆盖 [A-P] 单字符列 → 模板实际列范围是 V（22）整段根本不命中，所以外部尾行号从不同步
  const relink = (formula, r, lookupEnd) => {
    if (!formula) return '';
    let f = String(formula);
    if (lookupEnd != null) {
      // 外部 sheet 整段范围 sheet!$A$1:$V$8601 → sheet!$A$1:$V$lookupEnd（只改末行，起始行保持）
      //   注意：必须按整段范围匹配，不能再用单点 sheet!$X$N 兜底——否则会把上面已经替换好的起始行 $A$1
      //   又改写成 $A$lookupEnd，导致整段范围两端都被改。
      f = f.replace(
        new RegExp(`([\\u4e00-\\u9fff\\w]+!)\\$([A-Z]+)\\$(\\d+):\\$([A-Z]+)\\$(\\d+)`, 'g'),
        (m, sh, c1, r1, c2, r2) => `${sh}$${c1}$${r1}:$${c2}$${lookupEnd}`
      );
    }
    // 本表引用 $A3 / O3 / $A$3 → 行号 = r，列锁 $ 前缀原样保留
    f = f.replace(/(\$?)([A-P])(\d+)/g, (m, dollar, col, rn) => `${dollar}${col}${r}`);
    return f;
  };

  const skuList = (product && product.skuList) || [];
  const nameMap = (product && product.nameMap) || {};
  const rows = [];
  for (let i = 0; i < skuList.length; i++) {
    const r = i + 3;
    const sku = String(skuList[i] || '').trim();
    const nm = String(nameMap[sku] || '').trim();
    let cells = '';
    cells += sku ? `<c r="A${r}" s="${colDefs.A.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(sku)}</t></is></c>` : `<c r="A${r}" s="${colDefs.A.style}"/>`;
    cells += nm ? `<c r="B${r}" s="${colDefs.B.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(nm)}</t></is></c>` : `<c r="B${r}" s="${colDefs.B.style}"/>`;
    cells += `<c r="C${r}" s="${colDefs.C.style}"/>`;
    for (const L of ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']) {
      const d = colDefs[L];
      const st = d && d.style ? ` s="${d.style}"` : '';
      if (d && d.formula) cells += `<c r="${L}${r}"${st}><f>${relink(d.formula, r, lookupEnd)}</f></c>`;
      else cells += `<c r="${L}${r}"${st}/>`;
    }
    rows.push(`<row r="${r}"${rowAttrs}>${cells}</row>`);
  }
  const body = `${row1[0]}${row2[0]}${rows.join('')}`;

  if (/<sheetData\s*\/>/.test(s2)) s2 = s2.replace(/<sheetData\s*\/>/, `<sheetData>${body}</sheetData>`);
  else s2 = s2.replace(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/, `<sheetData>${body}</sheetData>`);

  const endRow = skuList.length + 2;
  s2 = s2.replace(/<dimension[^>]*\/>/, `<dimension ref="A1:P${endRow}"/>`);
  if (/<autoFilter[^>]*\/>/.test(s2)) {
    s2 = s2.replace(/<autoFilter[^>]*\/>/, `<autoFilter ref="A2:P${endRow}" xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" etc:filterBottomFollowUsedRange="0"/>`);
  } else {
    s2 = s2.replace(/<autoFilter[^>]*ref="[^"]*"/, `<autoFilter ref="A2:P${endRow}"`);
  }
  zip.file(path, s2);
  return { endRow };
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
 * 复刻产品表现 I 列 VLOOKUP(领星数据源!..., 3, FALSE) 的精确匹配语义：
 * 在「写入领星数据源 sheet 的原始行 rows（顺序与 sheet 完全一致）」中，对每个 SKU 找
 * 列 A(MSKU) 首次精确匹配的行，取列 C(创建时间) 的 ym(YYYY-MM)。
 *
 * 关键：必须在 rows（即实际写入 sheet 的那份数据）上取首匹配，不能遍历 prepped——
 * prepRows 会重排/去重，使同一 SKU 的「首匹配行」与 Excel 在 sheet 上的首匹配行不同，
 * 导致上架月份错位、月度 SKU 数差 1（如概况 55 / 产品表现 56）。
 * @param {Object[]} rows 写入领星数据源 sheet 的原始数据行（buildRows 输出，键为模板表头）
 * @param {Set<string>} allowedSkuSet 产品 SKU 集合（概况口径）
 * @param {string} [skuHeader] SKU 列名，默认 SKU_HEADER('MSKU')
 * @param {string} [dateHeader] 创建时间列名，默认 '创建时间'
 * @returns {Map<string,string>} SKU -> ym(YYYY-MM)
 */
export function buildLaunchYmMap(rows, allowedSkuSet, skuHeader = SKU_HEADER, dateHeader = '创建时间') {
  const map = new Map();
  for (const sku of allowedSkuSet) {
    const target = String(sku);
    for (const r of rows) {
      if (String(r[skuHeader] ?? '').trim() === target) {
        const ymM = String(r[dateHeader] ?? '').match(/^(\d{4}-\d{2})/);
        if (ymM) map.set(sku, ymM[1]);
        break; // 首个精确匹配即止 = VLOOKUP(FALSE) 语义
      }
    }
  }
  return map;
}

/**
 * 生成报表
 * @param {Object} opt
 * @param {Blob|ArrayBuffer} opt.templateBlob 模板文件
 * @param {string[]} opt.headers 模板「领星数据源」表头（顺序与列一致）
 * @param {Object[]} opt.rows 数据行（键为模板表头）
 * @param {Object} [opt.product] 当月产品表现清单 { skuList: string[], nameMap: Object<string,string> }
 * @param {(p: { pct: number, text: string }) => void} [opt.onProgress]
 * @returns {Promise<{ blob: Blob, data: ArrayBuffer, rowCount: number, dimension: string, lookupEnd: number, expanded: boolean, pivotCount: number, patched: Object, productUsed: boolean, productSkuCount: number }>}
 */
export async function generateReport({ templateBlob, headers, rows, product: productOpt, onProgress }) {
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

  // ===== 产品表现 sheet 重建（上传了当月产品表现表时） =====
  const product = productOpt && productOpt.skuList && productOpt.skuList.length ? productOpt : null;
  let productUsed = false;
  let perfEnd = null;
  if (product) {
    const perfPath = sheetPath('产品表现');
    if (perfPath && zip.file(perfPath)) {
      try {
        say(71, `正在按上传清单重建产品表现（${product.skuList.length} 个 SKU）…`);
        const r = await rebuildProductSheet(zip, perfPath, product, lookupEnd);
        perfEnd = r.endRow;
        productUsed = true;
        // 同步透视缓存源（产品表现!A2:P{旧} → 新行数）；definedNames 统一在下方 wbMod 阶段处理
        const cacheFiles2 = Object.keys(zip.files).filter((n) => /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(n));
        for (const cf of cacheFiles2) {
          let p = await zip.file(cf).async('string');
          p = p.replace(/(<worksheetSource[^>]*ref="A2:P)\d+(")/, `$1${perfEnd}$2`);
          zip.file(cf, p);
        }
      } catch (err2) {
        say(72, `提示：产品表现重建失败（${err2.message}），按模板原清单生成`);
        await tick();
      }
    }
  }

  // ===== 三 Sheet 重算补丁：概况 / 案例分析 / 全店铺全SKU类目汇总 =====
  // 这三个 Sheet 在模板里是硬编码快照（无公式），必须用上传数据重算后写回
  say(73, '正在重算概况 / 案例分析 / 类目汇总…');
  const patched = { overview: false, cases: false, category: false };
  try {
    const shared = await parseSharedStrings(zip);
    const perfPath = sheetPath('产品表现');
    // 修正产品表现 I 列 VLOOKUP 第4参数 3(近似)→FALSE(精确)：让 Excel 端产品表现与概况口径一致（幂等，重建路径已处理）
    if (perfPath && zip.file(perfPath)) {
      const ps = await zip.file(perfPath).async('string');
      const fixedPs = ps.replace(/,\s*3\s*,\s*3\s*,\s*FALSE/g, ',3,FALSE');
      if (fixedPs !== ps) zip.file(perfPath, fixedPs);
    }
    const ovPath = sheetPath('概况');
    const casePath = sheetPath('案例分析');
    const catPath = sheetPath('全店铺全SKU类目汇总');

    // 分析口径：上传产品表现 → 用上传清单；否则用模板内产品表现 A 列清单
    const tpl = perfPath ? await parseColsAB(zip, perfPath, shared, 3) : { map: {}, skuList: [] };
    const allowedSkuSet = product ? new Set(product.skuList) : new Set(tpl.skuList);
    const skuNameMap = product ? { ...tpl.map, ...product.nameMap } : tpl.map;

    const prepped = prepRows(rows);

    // 概况严格按产品表现 sheet 口径：每个产品 SKU 在领星数据源精确匹配首次出现行的「创建时间」(C列=I列VLOOKUP第3列)，
    // 用 JS 端复刻 VLOOKUP(...,FALSE) 的精确匹配语义，保证概况月度表与产品表现 I 列完全一致。
    // 概况严格按产品表现 sheet 口径：在写入领星数据源 sheet 的原始行(rows，顺序与 sheet 一致)
    // 上复刻 Excel VLOOKUP(...,FALSE) 精确匹配，取列C(创建时间) ym —— 与产品表现 I 列公式完全等价。
    const launchYmMap = buildLaunchYmMap(rows, allowedSkuSet);

    const ov = computeOverview(prepped, allowedSkuSet, launchYmMap);
    const cases = computeCases(prepped, skuNameMap, allowedSkuSet);

    if (ovPath && zip.file(ovPath)) {
      let s3 = await zip.file(ovPath).async('string');
      const monthCount = ov.monthly.length;
      const shift = Math.max(0, monthCount - MONTHLY_ROWS);
      // 上架月份超过模板 9 行容量 → 在月度表（第 13 行）后插入行，平移下方 profitState/总结/图表，
      // 保证最旧的上架月份（如 2025-10）也显示在概况里——整张概况都按产品表现 sheet 来。
      if (shift > 0) s3 = insertSheetRows(s3, 4 + MONTHLY_ROWS, shift);
      // 先写公式（KPI 里被映射成 Excel 公式的项，如 B4=COUNTA(产品表现!A3:A1000)）
      for (const [ref, formula] of Object.entries(ov.formulas || {})) s3 = patchCell(s3, ref, formula).xml;
      // 再写硬数字 KPI，但跳过已被公式覆盖的 ref（避免数字覆盖公式）
      for (const [ref, v] of Object.entries(ov.kpis)) {
        if (ov.formulas && ref in ov.formulas) continue;
        s3 = patchCell(s3, ref, v).xml;
      }
      // 写入「全部」上架月份（不再截断）：行 5..(5+monthCount-1)
      for (let i = 0; i < monthCount; i++) {
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
      s3 = patchCell(s3, `E${15 + shift}`, ov.profitState.pos).xml;
      s3 = patchCell(s3, `E${16 + shift}`, ov.profitState.neg).xml;
      s3 = patchCell(s3, `E${22 + shift}`, ov.summary[0]).xml;
      s3 = patchCell(s3, `E${23 + shift}`, ov.summary[1]).xml;
      s3 = patchCell(s3, `E${24 + shift}`, ov.summary[2]).xml;
      zip.file(ovPath, s3);
      // 同步引用月度表的图表（末行 13 → 13+shift）
      if (shift > 0) await syncChartMonthlyRange(zip, '概况', 4 + MONTHLY_ROWS, 4 + MONTHLY_ROWS + shift);
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
      // 类目名从「大类排名」冒号前字段提取（动态 TOP20 + 未识别兜底，行数固定 21）
      const catRows = computeCategory(prepped);
      let s6 = await zip.file(catPath).async('string');
      for (let i = 0; i < catRows.length && i < 21; i++) {
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
  // 产品表现 sheet 重建后：同步 definedNames 里的 _FilterDatabase / 打印区域行数
  if (productUsed && perfEnd) {
    wbMod = wbMod
      .replace(/(产品表现!\$A\$2:\$P\$)\d+/, `$1${perfEnd}`)
      .replace(/(产品表现!\$A\$1:\$P\$)\d+/, `$1${perfEnd}`);
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
    productUsed,
    productSkuCount: product ? product.skuList.length : 0,
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
