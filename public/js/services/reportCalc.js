/**
 * 数据分析 · 报告计算层
 * 模板的「概况 / 案例分析 / 全店铺全SKU类目汇总」三个 Sheet 是硬编码快照（无公式），
 * 因此必须由系统用上传的领星数据重新计算，再写回报告。本模块是纯函数计算器：
 *   输入：buildRows 后的对象行（键 = 模板 22 列表头）
 *   输出：三个 Sheet 的完整补丁值
 */

import { SKU_HEADER } from './dataImport.js';

/** 每行数据 → 计算友好结构 */
export function prepRows(rows) {
  return (rows || []).map((r) => ({
    sku: String(r[SKU_HEADER] ?? '').trim(),
    shop: String(r['店铺'] ?? '').trim(),
    ym: (String(r['创建时间'] ?? '').match(/^(\d{4}-\d{2})/) || [])[1] || '',
    cat: firstNonEmpty(r['三级分类'], r['二级分类'], r['一级分类']),
    bigRank: String(r['大类排名'] ?? '').trim(),
    qty: num(r['销量']),
    qty30: num(r['30天销量']),
    sales: num(r['销售额']),
    profit: num(r['订单毛利润']),
    refundQty: num(r['退款量']),
    refundRate: num(r['退款率']),
    adSpend: num(r['广告花费']),
    marginRate: num(r['订单毛利率']),
    outOfStock: String(r['断货时间'] ?? '').trim() !== '',
  }));
}

/**
 * 从「大类排名」提取类目名：冒号（全角/半角）前的字段
 * 'Home：256' → 'Home'；'Toys & Games: 10' → 'Toys & Games'；无冒号/纯数字/空 → ''
 */
export function extractCat(bigRank) {
  const s = String(bigRank ?? '').trim();
  if (!s) return '';
  const i = s.search(/[：:]/);
  if (i <= 0) return ''; // 无冒号或冒号在首位（视为纯排名）
  const head = s.slice(0, i).trim();
  // 冒号前必须含字母（类目名），否则视为排名串
  return /[A-Za-z\u4e00-\u9fa5]/.test(head) ? head : '';
}

/** 第一个非空值 */
function firstNonEmpty(...vs) {
  for (const v of vs) {
    const s = String(v ?? '').trim();
    if (s && s !== '0') return s;
  }
  return '';
}

/**
 * 数值归一化：'1,234.5' → 1234.5；'12.5%' → 0.125；'AED 100' → 100；空/非数字 → 0
 */
export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === '' || v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  const pct = /%$/.test(s);
  s = s.replace(/[,\s¥$￥€£]/g, '').replace(/%$/, '');
  if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return 0;
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return pct ? n / 100 : n;
}

/** 类目名归一化（小写去空白标点） */
export function normCat(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-—()（）\[\]【】:：,，.。/、]/g, '');
}

/** 判断数据类目是否命中模板类目（包含/被包含/相等，忽略极短词） */
export function catMatch(cat, tplCat) {
  const a = normCat(cat);
  const b = normCat(tplCat);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) && b.length >= 3) return true;
  if (b.includes(a) && a.length >= 3) return true;
  return false;
}

/* ===================== 概况 ===================== */

/** 月度表最多行数（模板固定 9 行：第 5~13 行） */
export const MONTHLY_ROWS = 9;

/**
 * 计算概况补丁
 * @returns {{
 *   kpis: { B4:number, B5:number, B6:number, B7:number, B8:number },
 *   monthly: Array<{ ym:string, skuCount:number, qty:number, qty30:number, sales:number, profit:number, margin:number, refundQty:number, refundRate:number, adSpend:number }>,
 *   profitState: { pos:number, neg:number },
 *   summary: [string, string, string]
 * }}
 */
export function computeOverview(prepped, allowedSkuSet = null) {
  // 按产品表现 cohort 视角：每个 SKU 的「上架月份」= 它在领星源里出现过的最早 ym
  // 之后所有指标（销量/毛利润/广告费/退款）都归属到该 SKU 的上架月份，而不是销售月份
  const skuYms = new Map();
  for (const r of prepped) {
    if (!r.sku || !r.ym) continue;
    const prev = skuYms.get(r.sku);
    if (!prev || r.ym < prev) skuYms.set(r.sku, r.ym);
  }

  const rows = allowedSkuSet ? prepped.filter((r) => allowedSkuSet.has(r.sku)) : prepped;

  // SKU 总数：上传产品清单时 = 产品表现 SKU 数（与 B4 公式对齐）；否则 = 领星源 prepped 中 distinct SKU 数
  const skus = new Set();
  if (allowedSkuSet) for (const s of allowedSkuSet) skus.add(s);

  let totalQty = 0;
  let qty30 = 0;
  let totalProfit = 0;
  let totalSales = 0;
  let outOfStockRows = 0;

  const bySkuProfit = new Map(); // sku -> 毛利润合计
  const monthlyMap = new Map(); // cohort ym -> { skuSet, qty, qty30, sales, profit, refundQty, adSpend }

  for (const r of rows) {
    if (!allowedSkuSet && r.sku) skus.add(r.sku);
    totalQty += r.qty;
    qty30 += r.qty30;
    totalProfit += r.profit;
    totalSales += r.sales;
    if (r.outOfStock) outOfStockRows += 1;
    bySkuProfit.set(r.sku, (bySkuProfit.get(r.sku) || 0) + r.profit);

    // 上传产品清单时：把该 SKU 的所有销售数据归属到它的「上架月份」（cohort）
    // 未上传时：按销售月份（保留原行为）
    const cohortYm = allowedSkuSet ? skuYms.get(r.sku) : r.ym;
    if (cohortYm) {
      let m = monthlyMap.get(cohortYm);
      if (!m) {
        m = { skuSet: new Set(), qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, adSpend: 0 };
        monthlyMap.set(cohortYm, m);
      }
      m.skuSet.add(r.sku);
      m.qty += r.qty;
      m.qty30 += r.qty30;
      m.sales += r.sales;
      m.profit += r.profit;
      m.refundQty += r.refundQty;
      m.adSpend += r.adSpend;
    }
  }

  // 补全：产品 SKU 有上架月份但 0 销售行的，也计入对应月份 SKU 数（保证月度 SKU 数 = 产品表现 SKU 数）
  if (allowedSkuSet) {
    for (const sku of allowedSkuSet) {
      const ym = skuYms.get(sku);
      if (!ym) continue;
      let m = monthlyMap.get(ym);
      if (!m) {
        m = { skuSet: new Set(), qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, adSpend: 0 };
        monthlyMap.set(ym, m);
      }
      m.skuSet.add(sku);
    }
  }

  const monthly = [...monthlyMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-MONTHLY_ROWS)
    .map(([ym, m]) => ({
      ym,
      skuCount: m.skuSet.size,
      qty: m.qty,
      qty30: m.qty30,
      sales: m.sales,
      profit: m.profit,
      margin: m.sales ? m.profit / m.sales : 0,
      refundQty: m.refundQty,
      refundRate: m.qty ? m.refundQty / m.qty : 0,
      adSpend: m.adSpend,
    }));

  // 正/负毛利计数：上传产品清单时遍历全部产品 SKU（包含未销售/0 利润），保证所有产品都被算到
  const skuListForProfit = allowedSkuSet ? [...allowedSkuSet] : [...bySkuProfit.keys()];
  let pos = 0;
  let neg = 0;
  for (const sku of skuListForProfit) {
    const p = bySkuProfit.get(sku);
    if (p !== undefined && p > 0) pos += 1;
    else neg += 1; // 未销售（profit undefined）或 profit <= 0 都归到负毛利侧
  }

  const margin = totalSales ? totalProfit / totalSales : 0;
  const negCount = neg;
  const summary = [
    `整体盈利${margin >= 0.2 ? '良好' : '偏薄'}：${skus.size} 个有效 SKU 合计毛利润 ${fmtMoney(totalProfit)}，整体毛利率 ${(margin * 100).toFixed(1)}%`,
    negCount > 0
      ? `存在明细问题产品：${negCount} 个 SKU 毛利润为负，建议优化利润或淘汰`
      : '本周期未发现亏损 SKU，产品结构健康',
    outOfStockRows > 0
      ? `部分产品库存紧张：${outOfStockRows} 行数据存在断货/预计断货时间，注意补货节奏`
      : '库存整体充足，无明显断货风险',
  ];

  return {
    kpis: { B4: skus.size, B5: totalQty, B6: qty30, B7: totalProfit, B8: margin },
    // B4（有效SKU）改成公式：用户下载后在 WPS/Excel 里增删产品表现行的行，B4 会自动跟着变。
    // 其他 B5-B8 维持硬数字（聚合指标需在领星源加辅助列才能联动，超出本轮范围）
    formulas: { B4: '=COUNTA(产品表现!A3:A1000)' },
    monthly,
    profitState: { pos, neg },
    summary,
  };
}

/* ===================== 案例分析 ===================== */

/** 建议文案（复用模板风格） */
function adviceForLoss(row) {
  if (row.refundRate >= 0.3) return '高退款叠加低利润，检查退货原因';
  if (row.profit <= 0) return '优化利润或淘汰';
  if (row.marginRate > 0 && row.marginRate < 0.05) return '利润偏薄，关注定价';
  return '持续优化';
}
function adviceForRefund(r) {
  if (r.refundRate >= 0.5) return '检查退货原因';
  if (r.refundRate >= 0.2) return '排查退货原因并改进';
  return '关注退款趋势';
}

/**
 * 计算案例分析补丁
 * @param {Object[]} prepped
 * @param {Object<string,string>} skuNameMap SKU → 品名（来自模板产品表现）
 * @returns {{
 *   topSales:    Array<{sku,name,shop,qty,qty30,profit,refundRate,advice}>,
 *   lossLeaders: Array<...>,
 *   refundTop:   Array<...>,
 *   zeroSales:   Array<...>,
 *   topAdvice:   string
 * }}
 */
export function computeCases(prepped, skuNameMap = {}, allowedSkuSet = null) {
  const rows = allowedSkuSet ? prepped.filter((r) => allowedSkuSet.has(r.sku)) : prepped;
  const name = (sku) => (skuNameMap[sku] || '').trim();

  // 按 SKU 聚合（同 SKU 多行取合计）
  const bySku = new Map();
  for (const r of rows) {
    if (!r.sku) continue;
    let a = bySku.get(r.sku);
    if (!a) {
      a = { sku: r.sku, name: name(r.sku), shop: r.shop, qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, refundRate: 0, marginRate: 0, adSpend: 0 };
      bySku.set(r.sku, a);
    }
    a.shop = a.shop || r.shop;
    a.qty += r.qty;
    a.qty30 += r.qty30;
    a.sales += r.sales;
    a.profit += r.profit;
    a.refundQty += r.refundQty;
    a.adSpend += r.adSpend;
  }
  const arr = [...bySku.values()];
  arr.forEach((a) => {
    a.refundRate = a.qty ? a.refundQty / a.qty : 0;
    a.marginRate = a.sales ? a.profit / a.sales : 0;
  });

  // 1) 销量 TOP5
  const topSales = arr
    .filter((a) => a.qty > 0)
    .sort((x, y) => y.qty - x.qty || y.profit - x.profit)
    .slice(0, 5)
    .map((a) => ({ ...a, advice: '' }));

  // 2) 高销量但亏损/低利润（销量>0 且 毛利润<=0；不足补 毛利率<5%）
  const loss = arr.filter((a) => a.qty > 0 && a.profit <= 0).sort((x, y) => y.qty - x.qty);
  if (loss.length < 5) {
    const extra = arr
      .filter((a) => a.qty > 0 && a.profit > 0 && a.marginRate < 0.05)
      .sort((x, y) => y.qty - x.qty)
      .slice(0, 5 - loss.length);
    loss.push(...extra);
  }
  const lossLeaders = loss.slice(0, 5).map((a) => ({ ...a, advice: adviceForLoss(a) }));

  // 3) 退款率 TOP5（退款量>0）
  const refundTop = arr
    .filter((a) => a.refundQty > 0)
    .sort((x, y) => y.refundRate - x.refundRate || y.refundQty - x.refundQty)
    .slice(0, 5)
    .map((a) => ({ ...a, advice: adviceForRefund(a) }));

  // 4) 零销量产品（最多 4 行）
  const zeroSales = arr
    .filter((a) => a.qty === 0)
    .sort((x, y) => (x.name ? -1 : 1) - (y.name ? -1 : 1))
    .slice(0, 4)
    .map((a) => ({ ...a, advice: '' }));

  const topAdvice = topSales.some((a) => a.profit <= 0)
    ? 'TOP5 中存在低利润/亏损 SKU，注意优化定价与广告，其余表现良好需补货'
    : '表现良好注意补货节奏避免断货';

  return { topSales, lossLeaders, refundTop, zeroSales, topAdvice };
}

/* ===================== 全店铺全SKU类目汇总 ===================== */

/** 类目汇总数据行数（模板 A4:A24 固定 21 行；图表引用 A4:A23 前 20 行） */
export const CATEGORY_ROWS = 21;
const CATEGORY_TOP = CATEGORY_ROWS - 1; // 前 20 个类目 + 第 21 行「未识别类目」

/**
 * 计算类目汇总（类目名从「大类排名」冒号前字段提取，动态 TOP20 + 未识别兜底）
 * @param {Object[]} prepped
 * @returns {Array<{ cat:string, skuCount:number, qty:number, qty30:number, sales:number, profit:number, margin:number, refundQty:number, refundRate:number, adSpend:number }>}
 */
export function computeCategory(prepped) {
  const agg = new Map(); // 类目名 -> 聚合
  const getAgg = (cat) => {
    let a = agg.get(cat);
    if (!a) {
      a = { skuCount: 0, qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, adSpend: 0 };
      agg.set(cat, a);
    }
    return a;
  };

  for (const r of prepped) {
    const cat = extractCat(r.bigRank) || '未识别类目';
    const a = getAgg(cat);
    a.skuCount += 1;
    a.qty += r.qty;
    a.qty30 += r.qty30;
    a.sales += r.sales;
    a.profit += r.profit;
    a.refundQty += r.refundQty;
    a.adSpend += r.adSpend;
  }

  // 类目按行数降序；「未识别类目」固定在最后一行（第 21 行，保持模板 A24 位置）
  const sorted = [...agg.entries()].sort((x, y) => y[1].skuCount - x[1].skuCount);
  const top = sorted.filter(([c]) => c !== '未识别类目').slice(0, CATEGORY_TOP);
  // 未识别类目 = 数据里叫"未识别类目"的 + 超出 TOP20 的类目
  const unrec = agg.get('未识别类目') || { skuCount: 0, qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, adSpend: 0 };
  for (const [cat, a] of sorted.filter(([c]) => c !== '未识别类目').slice(CATEGORY_TOP)) {
    unrec.skuCount += a.skuCount;
    unrec.qty += a.qty;
    unrec.qty30 += a.qty30;
    unrec.sales += a.sales;
    unrec.profit += a.profit;
    unrec.refundQty += a.refundQty;
    unrec.adSpend += a.adSpend;
  }
  // 固定 21 行：TOP 类目（不足补空行到 20 行）+ 第 21 行「未识别类目」（保持模板 A24 位置）
  const rows = [...top];
  const empty = { skuCount: 0, qty: 0, qty30: 0, sales: 0, profit: 0, refundQty: 0, adSpend: 0 };
  while (rows.length < CATEGORY_TOP) rows.push(['', empty]);
  rows.push(['未识别类目', unrec]);

  return rows.map(([cat, a]) => ({
    cat,
    skuCount: a.skuCount,
    qty: a.qty,
    qty30: a.qty30,
    sales: a.sales,
    profit: a.profit,
    margin: a.sales ? a.profit / a.sales : 0,
    refundQty: a.refundQty,
    refundRate: a.qty ? a.refundQty / a.qty : 0,
    adSpend: a.adSpend,
  }));
}

/** 类目汇总总结文案（第 28 行） */
export function categorySummary(catRows) {
  const ranked = catRows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => normCat(r.cat) !== '未识别类目' && r.qty > 0)
    .sort((a, b) => b.profit - a.profit);
  if (!ranked.length) {
    return '本期数据大类排名缺失，无法识别类目，请检查「大类排名」列';
  }
  const top = ranked[0];
  return `核心依靠${top.cat}品类创造利润`;
}

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
