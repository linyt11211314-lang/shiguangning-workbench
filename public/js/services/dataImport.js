/**
 * 数据分析 · 领星原始数据解析与列映射
 * 依赖全局 XLSX（/vendor/xlsx.full.min.js）
 *
 * 职责：
 *   1. 读取用户上传的 .xlsx / .csv，取出表头与数据行
 *   2. 自动把上传文件的列名映射到模板「领星数据源」的表头列
 *   3. 识别 SKU（MSKU）列，缺失时交给 UI 手动指定
 *   4. 产出「数据概览」统计
 */

import { DATA_SHEET } from './reportTemplate.js';

/** 允许的上传格式 */
export const ACCEPT = '.xlsx,.xls,.csv';

/** 产品表现表允许的格式 */
export const PRODUCT_ACCEPT = '.xlsx,.xls,.csv';

/** 上传文件体积上限（MB） */
export const MAX_UPLOAD_MB = 30;

/** 超过此行数提示「数据量较大」 */
export const SLOW_ROWS = 10000;

/** 模板中作为主键的列名 */
export const SKU_HEADER = 'MSKU';

/**
 * 列名别名表（键为模板表头，值为可能出现在领星导出文件中的写法）
 * 匹配时全部走 normHeader 归一化（小写、去空格/下划线/括号等）
 */
export const COLUMN_ALIASES = {
  MSKU: ['msku', 'sku', '卖家sku', 'sellersku', '商品编码', '本地sku', 'localsku', '产品sku', 'msku编码'],
  店铺: ['店铺', '店铺名称', '店铺简称', 'shop', 'store', 'shopname', '销售店铺'],
  创建时间: ['创建时间', '创建日期', '上架时间', '首次上架时间', 'createtime', 'createdate', '录入时间'],
  一级分类: ['一级分类', '一级类目', '分类一', '一级品类', 'category1', '大类'],
  二级分类: ['二级分类', '二级类目', '分类二', '二级品类', 'category2', '中类'],
  三级分类: ['三级分类', '三级类目', '分类三', '三级品类', 'category3', '小类', '品类'],
  '30天销量': ['30天销量', '近30天销量', '30日销量', '销量30天', '近30日销量', '最近30天销量'],
  销量: ['销量', '总销量', '销售量', '近一年销量', '年销量', '累计销量'],
  大类排名: ['大类排名', '大类目排名', '主排名', 'bsr大类', '大类bsr', '大排名'],
  小类排名: ['小类排名', '小类目排名', '子排名', '类目排名', 'bsr小类', '小类bsr'],
  退款量: ['退款量', '退款数', '退货量', '退款订单量', '退货数'],
  退款率: ['退款率', '退货率', '退款比例'],
  评分: ['评分', '星级', 'rating', '评分星级', '产品评分'],
  评论数: ['评论数', '评价数', '评论数量', '评价数量', 'reviews', '评论总数'],
  订单毛利润: ['订单毛利润', '毛利润', '利润', '订单利润', 'grossprofit', '毛利'],
  'FBA-可售': ['fba可售', 'fba-可售', '可售库存', 'fba可用', 'fba可售库存', 'fba在库'],
  'FBA-在途': ['fba在途', 'fba-在途', '在途库存', '在途', 'fba在途库存'],
  断货时间: ['断货时间', '预计断货时间', '断货日期', '可售天数', '预计断货'],
  广告花费: ['广告花费', '广告费', '花费', 'adspend', 'cost', '广告支出'],
  采购量: ['采购量', '采购数量', '采购件数', '采购数'],
  订单毛利率: ['订单毛利率', '毛利率', '利润率', '订单利润率'],
  销售额: ['销售额', '销售金额', '营业额', 'sales', '总销售额', '销售总额'],
  品名: ['品名', '产品名称', '商品名称', '产品名', '名称', '产品标题', '标题', 'name', 'productname'],
  采购成本: ['采购成本', '成本', '成本价', '采购价', '采购单价', '单价', 'cost', 'price'],
};

/** 表头归一化：小写 + 去掉空白与常见分隔符 */
export function normHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-－—()（）\[\]【】:：,，.。/、*#%]/g, '')
    .trim();
}

/** 校验 XLSX 依赖 */
function ensureXLSX() {
  if (typeof XLSX === 'undefined' || !XLSX || !XLSX.read) {
    throw new Error('Excel 解析组件未加载，请刷新页面后重试');
  }
}

/**
 * 读取上传文件
 * @param {File} file
 * @returns {Promise<{ sheetName, sheetNames, headers, rows, rowCount }>} rows 为二维数组（不含表头）
 */
export async function readSourceFile(file) {
  ensureXLSX();
  const name = file.name || '';
  if (!/\.(xlsx|xls|csv)$/i.test(name)) {
    throw new Error('仅支持 .xlsx / .xls / .csv 格式，请检查文件后重新上传');
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`文件超过 ${MAX_UPLOAD_MB}MB，请在领星导出时缩小时间范围或分批上传`);
  }

  const buf = await file.arrayBuffer();
  const ext = (name.split('.').pop() || '').toLowerCase();
  let wb;
  try {
    if (ext === 'csv') {
      const text = decodeText(buf);
      wb = XLSX.read(text, { type: 'string', raw: false });
    } else {
      wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    }
  } catch (_) {
    throw new Error('文件解析失败，可能不是有效的 Excel/CSV 文件');
  }

  // 优先挑选包含 SKU 列的 Sheet，其次取第一个非空 Sheet
  const sheetNames = wb.SheetNames.slice();
  let picked = null;
  for (const sn of sheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;
    const hdr = (aoa[0] || []).map((v) => String(v ?? '').trim());
    const hasSku = hdr.some((h) => COLUMN_ALIASES.MSKU.includes(normHeader(h)));
    if (!picked || hasSku) picked = { sheetName: sn, aoa, hdr };
    if (hasSku) break;
  }
  if (!picked) throw new Error('文件里没有任何数据，请确认导出内容非空');

  let headers = picked.hdr;
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  const rows = picked.aoa.slice(1).filter((r) => (r || []).some((c) => c !== '' && c != null));

  if (!headers.length) throw new Error('文件第 1 行没有表头，无法识别数据列');

  return { sheetName: picked.sheetName, sheetNames, headers, rows, rowCount: rows.length };
}

/** CSV 文本解码（优先 UTF-8，乱码则退回 GBK 常见场景的 latin1 兜底） */
function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  let text = new TextDecoder('utf-8').decode(u8);
  // UTF-8 解码失败会产生大量替换字符，尝试 gbk（部分浏览器支持）
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 5) {
    try {
      text = new TextDecoder('gbk').decode(u8);
    } catch (_) {
      /* 浏览器不支持 gbk 时保持 utf-8 结果 */
    }
  }
  // 去掉 BOM
  return text.replace(/^\uFEFF/, '');
}

/**
 * 自动列映射
 * @param {string[]} tplHeaders 模板「领星数据源」表头
 * @param {string[]} fileHeaders 上传文件表头
 * @returns {{ map: Object<string, number>, matched: string[], unmatched: string[], skuCol: number }}
 *          map[模板表头] = 上传文件列索引（未匹配则不存在该键）
 */
export function autoMap(tplHeaders, fileHeaders) {
  const normFile = fileHeaders.map((h) => normHeader(h));
  const pairs = [];

  tplHeaders.forEach((tpl) => {
    const nt = normHeader(tpl);
    if (!nt) return;
    const aliases = COLUMN_ALIASES[tpl] || [];
    normFile.forEach((nf, idx) => {
      if (!nf) return;
      let score = 0;
      if (nf === nt) score = 100;
      else if (aliases.includes(nf)) score = 90;
      else if (aliases.some((a) => nf === a)) score = 90;
      else if (nf.includes(nt) && nt.length >= 2) score = 65;
      else if (nt.includes(nf) && nf.length >= 2) score = 60;
      else if (aliases.some((a) => a.length >= 3 && (nf.includes(a) || a.includes(nf)))) score = 55;
      if (score > 0) pairs.push({ tpl, idx, score });
    });
  });

  pairs.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const map = {};
  const usedCols = new Set();
  for (const p of pairs) {
    if (map[p.tpl] != null || usedCols.has(p.idx)) continue;
    map[p.tpl] = p.idx;
    usedCols.add(p.idx);
  }

  const matched = tplHeaders.filter((h) => map[h] != null);
  const unmatched = tplHeaders.filter((h) => map[h] == null && normHeader(h));
  const skuCol = map[SKU_HEADER] != null ? map[SKU_HEADER] : -1;
  return { map, matched, unmatched, skuCol };
}

/**
 * 按映射把上传数据整理成「模板表头 → 值」的对象数组
 * @param {string[]} tplHeaders
 * @param {any[][]} rows 上传文件数据行（二维数组）
 * @param {Object<string, number>} map
 * @returns {Object[]}
 */
export function buildRows(tplHeaders, rows, map) {
  const out = [];
  for (const r of rows) {
    const o = {};
    let empty = true;
    for (const h of tplHeaders) {
      const idx = map[h];
      let v = idx == null ? '' : r[idx];
      if (v instanceof Date) v = fmtDate(v);
      if (v == null) v = '';
      if (typeof v === 'string') v = v.trim();
      o[h] = v;
      if (v !== '') empty = false;
    }
    if (!empty && String(o[SKU_HEADER] ?? '') !== '') out.push(o);
  }
  return out;
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function num(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,%¥$￥\s]/g, ''));
  return isFinite(n) ? n : 0;
}

/**
 * 数据概览统计
 * @param {Object[]} objRows buildRows 的结果
 * @returns {{ rowCount, skuCount, shopCount, shops, totalQty, totalSales, totalProfit, avgRating, catCount, negativeProfit }}
 */
export function buildOverview(objRows) {
  const skuSet = new Set();
  const shopSet = new Set();
  const catSet = new Set();
  let totalQty = 0;
  let totalSales = 0;
  let totalProfit = 0;
  let ratingSum = 0;
  let ratingCnt = 0;
  let negativeProfit = 0;

  for (const r of objRows) {
    const sku = String(r[SKU_HEADER] ?? '').trim();
    if (sku) skuSet.add(sku);
    const shop = String(r['店铺'] ?? '').trim();
    if (shop) shopSet.add(shop);
    const cat = String(r['三级分类'] ?? r['二级分类'] ?? r['一级分类'] ?? '').trim();
    if (cat) catSet.add(cat);
    totalQty += num(r['销量']);
    totalSales += num(r['销售额']);
    const profit = num(r['订单毛利润']);
    totalProfit += profit;
    if (profit < 0) negativeProfit += 1;
    const rate = num(r['评分']);
    if (rate > 0) {
      ratingSum += rate;
      ratingCnt += 1;
    }
  }

  return {
    rowCount: objRows.length,
    skuCount: skuSet.size,
    shopCount: shopSet.size,
    shops: [...shopSet].slice(0, 8),
    totalQty,
    totalSales,
    totalProfit,
    avgRating: ratingCnt ? ratingSum / ratingCnt : 0,
    catCount: catSet.size,
    negativeProfit,
  };
}

/** 生成「未识别到 SKU 列」提示 */
export function noSkuMessage() {
  return `未能自动识别 SKU 列（模板主键为「${SKU_HEADER}」）。请手动指定上传文件中代表 SKU 的列，否则「${DATA_SHEET}」无法与产品表现表关联。`;
}

/* ===================== 产品表现表解析 ===================== */

/** 产品表现表 SKU 列表上限 */
export const PRODUCT_LIMIT = 5000;

/** SKU 列表长度上限提示 */
export function productLimitMessage() {
  return `产品表现 SKU 数量超过 ${PRODUCT_LIMIT}，请精简当月有效 SKU 清单`;
}

/** 识别产品表现表的 SKU 列 / 品名列 */
function detectProductCols(headers) {
  let skuIdx = -1;
  let nameIdx = -1;
  headers.forEach((h, i) => {
    const nh = normHeader(h);
    if (!nh) return;
    if (skuIdx < 0 && /(sku|msku|商品编码|本地编码)/.test(nh) && !/(数量|库存)/.test(nh)) skuIdx = i;
    if (nameIdx < 0 && /(产品名称|品名|商品名称|name|标题|productname|商品标题)/.test(nh)) nameIdx = i;
  });
  return { skuIdx, nameIdx };
}

/**
 * 解析用户上传的「产品表现」表（当月 SKU 清单）
 * @param {File} file
 * @returns {Promise<{ fileName, sheetName, skuCount, nameCount, skuList: string[], nameMap: Object<string,string>, headers: string[] }>}
 */
export async function readProductSheet(file) {
  ensureXLSX();
  const name = file.name || '';
  if (!/\.(xlsx|xls|csv)$/i.test(name)) {
    throw new Error('产品表现仅支持 .xlsx / .xls / .csv 格式');
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`文件超过 ${MAX_UPLOAD_MB}MB，请检查后重新上传`);
  }

  const buf = await file.arrayBuffer();
  const ext = (name.split('.').pop() || '').toLowerCase();
  let wb;
  try {
    if (ext === 'csv') wb = XLSX.read(decodeText(buf), { type: 'string', raw: false });
    else wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  } catch (_) {
    throw new Error('产品表现文件解析失败，可能不是有效的 Excel/CSV 文件');
  }

  // 挑含 SKU 列的 Sheet
  let picked = null;
  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;
    const hdr = (aoa[0] || []).map((v) => String(v ?? '').trim());
    const { skuIdx } = detectProductCols(hdr);
    if (skuIdx >= 0) {
      picked = { sheetName: sn, aoa, hdr, skuIdx };
      break;
    }
  }
  if (!picked) {
    throw new Error('未能识别产品表现表：请确认表头包含 SKU 列（如 MSKU / SKU / AE sku）');
  }

  const { aoa, hdr, skuIdx } = picked;
  const { nameIdx } = detectProductCols(hdr);
  const skuList = [];
  const nameMap = {};
  for (const row of aoa.slice(1)) {
    const sku = String(row[skuIdx] ?? '').trim();
    if (!sku) continue;
    if (!nameMap[sku]) {
      skuList.push(sku);
      const nm = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '';
      nameMap[sku] = nm;
    } else if (nameIdx >= 0 && !nameMap[sku] && String(row[nameIdx] ?? '').trim()) {
      nameMap[sku] = String(row[nameIdx]).trim();
    }
    if (skuList.length > PRODUCT_LIMIT) break;
  }

  if (!skuList.length) throw new Error('产品表现表中没有有效的 SKU 数据（SKU 列均为空）');

  const nameCount = Object.values(nameMap).filter((v) => v).length;
  return { fileName: name, sheetName: picked.sheetName, skuCount: skuList.length, nameCount, skuList, nameMap, headers: hdr };
}
