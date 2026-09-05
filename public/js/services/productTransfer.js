/**
 * 产品库 Excel 导出 / 导入
 * 使用 SheetJS（window.XLSX，本地托管 /vendor/xlsx.full.min.js）
 * 导出：整齐美观的 .xlsx（中文表头 + 列宽 + 冻结首行）；导入：同一模板回读
 */
import { listProducts, addProductTracked } from '../store/productStore.js';
import { toastInfo } from '../ui/toast.js';
import { AMAZON_SITES, CATEGORY_IDS } from '../config.js';
import { calculateQuote, apply99 } from './pricing.js';

const r2 = (n) => (n === '' || n == null || isNaN(n)) ? '' : Math.round(Number(n) * 100) / 100;

/** 中文表头 → 内部字段 映射（导出与导入共用同一套模板） */
const HEADER_MAP = [
  ['产品名称', 'name'],
  ['Amazon链接', 'amazonUrl'],
  ['产品类目', 'productCategory'],
  ['分类', 'category'],
  ['目标站点', 'site'],
  ['货源1链接', 's1_link'],
  ['货源1规格颜色', 's1_spec'],
  ['货源2链接', 's2_link'],
  ['货源2规格颜色', 's2_spec'],
  ['货源3链接', 's3_link'],
  ['货源3规格颜色', 's3_spec'],
  ['长(cm)', 'lengthCm'],
  ['宽(cm)', 'widthCm'],
  ['高(cm)', 'heightCm'],
  ['重量(g)', 'weightG'],
  ['采购成本(¥)', 'cost'],
  ['汇率', 'exchangeRate'],
  ['目标利润率(%)', 'targetProfitRate'],
  ['广告费率(%)', 'adRate'],
  ['类目佣金率(%)', 'referralRate'],
  ['FBA费', 'fbaFee'],
  ['头程费', 'shippingPerUnit'],
  ['建议售价', 'price'],
  ['预计利润', 'profit'],
  ['利润率(%)', 'margin'],
  ['产品描述', 'description'],
  ['已上传', 'uploaded'],
];
const HEADERS = HEADER_MAP.map(([h]) => h);

/** 每列宽度（对齐美观） */
const COL_WIDTHS = [26, 34, 18, 10, 10, 30, 20, 30, 20, 30, 20, 10, 10, 10, 10, 12, 8, 12, 12, 12, 10, 10, 11, 11, 10, 34, 10];

function getXLSX() {
  const X = window.XLSX;
  if (!X) throw new Error('Excel 引擎未加载，请刷新页面重试');
  return X;
}

/** 组装导出行 */
function productToRow(p) {
  const q = p.quote || {};
  const r = q.result || {};
  // 建议售价用 .99 结尾的展示价，利润率按展示价对应实际值（>= 目标档位）
  const r99 = (r && !r.error && isFinite(r.price)) ? apply99(r) : null;
  const s = (i) => (p.supplies || [])[i] || {};
  return {
    产品名称: p.name || '',
    Amazon链接: p.amazonUrl || '',
    产品类目: p.productCategory || '',
    分类: p.category || '',
    目标站点: p.site || 'US',
    货源1链接: s(0).link || '',
    货源1规格颜色: s(0).specColor || '',
    货源2链接: s(1).link || '',
    货源2规格颜色: s(1).specColor || '',
    货源3链接: s(2).link || '',
    货源3规格颜色: s(2).specColor || '',
    '长(cm)': r2(q.lengthCm),
    '宽(cm)': r2(q.widthCm),
    '高(cm)': r2(q.heightCm),
    '重量(g)': r2(q.weightG),
    '采购成本(¥)': r2(q.cost),
    汇率: q.exchangeRate == null ? 7.2 : r2(q.exchangeRate),
    '目标利润率(%)': r2(q.targetProfitRate),
    '广告费率(%)': r2(q.adRate),
    '类目佣金率(%)': r2(q.referralRate),
    FBA费: r2(q.fbaFee),
    头程费: r2(q.shippingPerUnit),
    建议售价: r99 ? r2(r99.displayPrice) : (r.price == null ? '' : r2(r.price)),
    预计利润: r99 ? r2(r99.displayProfit) : (r.profit == null ? '' : r2(r.profit)),
    '利润率(%)': r99 ? r2(r99.displayMargin * 100) : (r.margin == null ? '' : r2(r.margin * 100)),
    产品描述: p.description || '',
    已上传: Boolean(p.uploaded),
  };
}

/** 导出产品库为 Excel。
 * @param {Array<object>} [products] 传入则只导出这些产品；不传则导全库（listProducts）。
 *   传入空数组视为无数据，提示后返回 0。
 */
export function exportProductsExcel(products) {
  const items = Array.isArray(products) ? products : listProducts();
  if (!items.length) {
    const emptySel = Array.isArray(products) && products.length === 0;
    toastInfo(emptySel ? '当前未勾选产品' : '产品库为空，暂无可导出的数据');
    return 0;
  }
  products = items;
  try {
    const X = getXLSX();
    const rows = products.map(productToRow);
    const ws = X.utils.json_to_sheet(rows, { header: HEADERS });
    ws['!cols'] = COL_WIDTHS.map((wch) => ({ wch }));
    // 冻结首行（表头固定）
    try { ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomRight', state: 'frozen' }; } catch (_) { /* 忽略 */ }
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, '产品库');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fname = `拾光柠产品库_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`;
    X.writeFile(wb, fname);
    return products.length;
  } catch (e) {
    throw new Error(`导出失败：${e.message}`);
  }
}

const num = (v) => {
  if (v === '' || v == null) return '';
  let s = String(v).trim().replace(/%/g, '');
  if (s === '') return '';
  const n = Number(s);
  return isNaN(n) ? '' : n;
};

const siteFromExcel = (v) => {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return 'US';
  const hit = AMAZON_SITES.find((x) => x.code === s || x.label.includes(s) || (s.length === 2 && x.code === s));
  return hit ? hit.code : 'US';
};

/** 导入 Excel 行 → 产品数据（重新测算报价保证一致）
 * @param {Object} row 行数据
 * @param {string} defaultCategory 分类列缺失/不匹配时的默认分类（当前激活 Tab）
 */
function rowToProduct(row, defaultCategory = 'niuma') {
  const g = (h) => (row[h] == null ? '' : row[h]);
  const supplies = [];
  for (let i = 1; i <= 3; i++) {
    const link = String(g(`货源${i}链接`)).trim();
    const specColor = String(g(`货源${i}规格颜色`)).trim();
    if (link || specColor) supplies.push({ link, specColor });
  }
  const name = String(g('产品名称')).trim();
  if (!name) return null;

  const q = {
    lengthCm: num(g('长(cm)')),
    widthCm: num(g('宽(cm)')),
    heightCm: num(g('高(cm)')),
    weightG: num(g('重量(g)')),
    cost: num(g('采购成本(¥)')),
    exchangeRate: num(g('汇率')) || 7.2,
    targetProfitRate: num(g('目标利润率(%)')) === '' ? 30 : num(g('目标利润率(%)')),
    adRate: num(g('广告费率(%)')) === '' ? 1 : num(g('广告费率(%)')),
    referralRate: num(g('类目佣金率(%)')) === '' ? 15 : num(g('类目佣金率(%)')),
    fbaFee: num(g('FBA费')),
    shippingPerUnit: num(g('头程费')) === '' ? 0 : num(g('头程费')),
  };
  const site = siteFromExcel(g('目标站点'));

  // 重新测算报价（与页面计算一致；FBA 费手动填写，不自动计算）
  let quote = null;
  if (q.cost !== '' && Number(q.cost) > 0) {
    const fba = q.fbaFee === '' ? 0 : Number(q.fbaFee);
    const siteInfo = AMAZON_SITES.find((x) => x.code === site) || AMAZON_SITES[0];
    const result = calculateQuote({
      cost: q.cost, exchangeRate: q.exchangeRate,
      targetProfitRate: Number(q.targetProfitRate) / 100,
      adRate: Number(q.adRate) / 100, referralRate: Number(q.referralRate) / 100,
      fbaFee: fba, shippingPerUnit: Number(q.shippingPerUnit) || 0,
      symbol: siteInfo.symbol || '$',
    });
    quote = {
      site,
      ...q,
      fbaFee: q.fbaFee === '' ? '' : fba,
      result: result && !result.error ? result : null,
    };
  }

  // 分类列：合法则用之，否则归入默认分类（当前激活 Tab）
  const catRaw = String(g('分类')).trim().toLowerCase();
  const category = CATEGORY_IDS.includes(catRaw) ? catRaw : (defaultCategory || 'niuma');

  return {
    name,
    amazonUrl: String(g('Amazon链接')).trim(),
    category,
    productCategory: String(g('产品类目')).trim(),
    site,
    supplies,
    quote,
    description: String(g('产品描述')).trim(),
    uploaded: Boolean(g('已上传')),
  };
}

/** 从 Excel 文件导入产品（返回 { count, skipped }）
 * @param {File} file
 * @param {string} defaultCategory 分类列缺失/不匹配时的默认分类
 */
export async function importProductsExcel(file, defaultCategory = 'niuma') {
  const X = getXLSX();
  const buf = await file.arrayBuffer();
  const wb = X.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = X.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) throw new Error('模板中没有数据行');

  let count = 0;
  let skipped = 0;
  for (const row of rows) {
    const data = rowToProduct(row, defaultCategory);
    if (!data) { skipped++; continue; }
    addProductTracked(data);
    count++;
  }
  return { count, skipped };
}
