/**
 * 利润看板 · 解析与计算引擎
 * 依赖全局 XLSX（/vendor/xlsx.full.min.js）
 *
 * 真实利润 = 毛利润 − 领星采购成本(c89) − 销量×采购单价(换算) − 销售额×头程率
 * - 领星「毛利润」已含其自带采购成本（仅少数行 c89 非零），故先扣 c89 再扣我们的采购单价，避免重复扣减
 * - 采购单价来自采购单（CNY），按站点汇率换算后扣减
 * - 头程 = 销售额 × 头程率（默认 5%）
 * - 无采购单匹配且无手动覆盖时，采购单价按 0 计（仅扣头程）
 */
import { normHeader } from './dataImport.js';

/* ===================== 列别名 ===================== */
const PROFIT_TPL = [
  'MSKU', '店铺', '币种', '品名',
  'FBA销量', 'FBM销量', 'FBA销售额', 'FBM销售额',
  'SP广告', 'SD广告', 'SB广告', 'SBV广告',
  '采购成本', '头程成本', '毛利润', '毛利率',
];

const PROFIT_ALIASES = {
  MSKU: ['msku', 'sku', '卖家sku', 'sellersku', '商品编码', '本地sku', 'msku编码'],
  店铺: ['店铺', '店铺名称', '店铺简称', 'shop', 'store', 'shopname', '销售店铺'],
  币种: ['币种', 'currency', '货币', '币别', '站点币种'],
  品名: ['品名', '产品名称', '商品名称', 'name', '标题', 'productname'],
  FBA销量: ['fba销量', 'fbasales', 'fba销量件', 'fba销售量'],
  FBM销量: ['fbm销量', 'fbmsales', 'fbm销售量'],
  FBA销售额: ['fba销售额', 'fbasalesamount', 'fba销售金额', 'fba销售额本币'],
  FBM销售额: ['fbm销售额', 'fbmsalesamount', 'fbm销售金额'],
  SP广告: ['sp广告', 'spad', 'sp广告费', 'sp花费'],
  SD广告: ['sd广告', 'sdad', 'sd广告费'],
  SB广告: ['sb广告', 'sbad', 'sb广告费'],
  SBV广告: ['sbv广告', 'sbvad', 'sbv广告费'],
  采购成本: ['采购成本', 'c89', '商品成本', '成本', '成本价'],
  头程成本: ['头程成本', '头程', '头程运费', '头程费'],
  毛利润: ['毛利润', '利润', '毛利', 'grossprofit', '订单毛利润'],
  毛利率: ['毛利率', '利润率', '毛利率'],
};

function myAutoMap(tpl, fileHeaders) {
  const normFile = fileHeaders.map((h) => normHeader(h));
  const pairs = [];
  tpl.forEach((t) => {
    const nt = normHeader(t);
    if (!nt) return;
    const aliases = PROFIT_ALIASES[t] || [];
    normFile.forEach((nf, idx) => {
      if (!nf) return;
      let score = 0;
      if (nf === nt) score = 100;
      else if (aliases.includes(nf)) score = 90;
      else if (nf.includes(nt) && nt.length >= 2) score = 65;
      else if (nt.includes(nf) && nf.length >= 2) score = 60;
      else if (aliases.some((a) => a.length >= 3 && (nf.includes(a) || a.includes(nf)))) score = 55;
      if (score > 0) pairs.push({ tpl: t, idx, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const map = {};
  const used = new Set();
  for (const p of pairs) {
    if (map[p.tpl] != null || used.has(p.idx)) continue;
    map[p.tpl] = p.idx;
    used.add(p.idx);
  }
  return map;
}

function num(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[,%¥$￥\s]/g, ''));
  return isFinite(n) ? n : 0;
}

/* ===================== 文件读取 ===================== */
function ensureXLSX() {
  if (typeof XLSX === 'undefined' || !XLSX || !XLSX.read) {
    throw new Error('Excel 解析组件未加载，请刷新页面后重试');
  }
}

async function readWorkbook(file) {
  ensureXLSX();
  const name = file.name || '';
  if (!/\.(xlsx|xls|csv)$/i.test(name)) {
    throw new Error('仅支持 .xlsx / .xls / .csv 格式');
  }
  const buf = await file.arrayBuffer();
  const ext = (name.split('.').pop() || '').toLowerCase();
  let wb;
  if (ext === 'csv') {
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('\uFFFD')) {
      try { txt = new TextDecoder('gb18030').decode(buf); } catch (_) {}
    }
    wb = XLSX.read(txt, { type: 'string', raw: false });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  }
  return wb;
}

/** 在 aoa 中找出含 MSKU 表头的行索引（处理领星两级表头：第0行分组、第1行真实列名） */
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    const cells = (aoa[i] || []).map((v) => normHeader(v));
    if (cells.includes('msku')) return i;
  }
  return -1;
}

/* ===================== 解析利润报表 ===================== */
export async function parseProfitFile(file) {
  const wb = await readWorkbook(file);
  // 选含 MSKU 表头的 Sheet
  let picked = null;
  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;
    const hi = findHeaderRow(aoa);
    if (hi >= 0) { picked = { sheetName: sn, aoa, headerIdx: hi }; break; }
  }
  if (!picked) throw new Error('未能识别利润报表：请确认表头包含 MSKU 列（如两级表头，第 2 行应为 MSKU/店铺/品名…）');

  const { aoa, headerIdx, sheetName } = picked;
  const header = (aoa[headerIdx] || []).map((v) => String(v ?? '').trim());
  const map = myAutoMap(PROFIT_TPL, header);
  const skuCol = map['MSKU'];
  if (skuCol == null) throw new Error('利润报表缺少 MSKU 列，无法识别产品');

  const get = (row, tpl) => (map[tpl] == null ? '' : row[map[tpl]]);

  // 先按 (MSKU, 店铺, 币种) 分组求和，跨站点分别保留、同店铺重复合并
  const grp = new Map();
  for (const row of aoa.slice(headerIdx + 1)) {
    const ms = String(get(row, 'MSKU') || '').trim();
    if (!ms) continue;
    const shop = String(get(row, '店铺') || '').trim();
    const cur = String(get(row, '币种') || '').trim().toUpperCase();
    const key = `${ms}|||${shop}|||${cur}`;
    if (!grp.has(key)) {
      grp.set(key, {
        ms, shop, cur,
        name: String(get(row, '品名') || '').trim(),
        qty: 0, sale: 0, ad: 0, gross: 0, c89: 0,
      });
    }
    const g = grp.get(key);
    const fbaQ = num(get(row, 'FBA销量'));
    const fbmQ = num(get(row, 'FBM销量'));
    const fbaS = num(get(row, 'FBA销售额'));
    const fbmS = num(get(row, 'FBM销售额'));
    g.qty += fbaQ + fbmQ;
    g.sale += fbaS + fbmS;
    g.ad += Math.abs(num(get(row, 'SP广告'))) + Math.abs(num(get(row, 'SD广告'))) +
            Math.abs(num(get(row, 'SB广告'))) + Math.abs(num(get(row, 'SBV广告')));
    g.gross += num(get(row, '毛利润'));
    g.c89 += Math.abs(num(get(row, '采购成本')));
    if (!g.name) g.name = String(get(row, '品名') || '').trim();
  }

  const rows = [...grp.values()];
  if (!rows.length) throw new Error('利润报表中没有有效数据行（缺少 MSKU 或全为空）');
  return { fileName: file.name, sheetName, rows };
}

/* ===================== 解析采购单 ===================== */
export async function parsePurchaseFile(file) {
  const wb = await readWorkbook(file);
  let picked = null;
  for (const sn of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
    if (!aoa.length) continue;
    // 采购单：找含「SKU」表头、且存在「单价」列的 Sheet
    const norm = (aoa[0] || []).map((v) => normHeader(v));
    if (norm.includes('sku') && norm.some((h) => /单价|价格|price/.test(h))) {
      picked = { sheetName: sn, aoa }; break;
    }
  }
  if (!picked) throw new Error('未能识别采购单：请确认「产品信息」表含 SKU 与 单价 列');

  const { aoa, sheetName } = picked;
  const header = (aoa[0] || []).map((v) => normHeader(v));
  const skuCol = header.indexOf('sku');
  let priceCol = header.findIndex((h) => /单价|价格|price/.test(h));
  if (skuCol < 0 || priceCol < 0) throw new Error('采购单缺少 SKU 或 单价 列');

  const map = {};
  for (const row of aoa.slice(1)) {
    const sku = String(row[skuCol] || '').trim();
    if (!sku) continue;
    const price = num(row[priceCol]);
    if (!map[sku] || price > map[sku]) map[sku] = price; // 同 SKU 取最高单价
  }
  if (!Object.keys(map).length) throw new Error('采购单中没有有效的 SKU / 单价数据');
  return { fileName: file.name, sheetName, map };
}

/* ===================== 计算引擎 =====================
 * @param headOverrides 逐 SKU 头程比例覆盖（比例值，如 0.06 表示 6%），未设置则回退全局 headRate
 */
export function computeProfit(rawRows, purchaseMap, costOverrides, headOverrides, params) {
  const purchase = purchaseMap || {};
  const ovPu = costOverrides || {};
  const ovHead = headOverrides || {};
  const globalHead = params.headRate;
  const rateAED = params.rateAED;
  const rateSAR = params.rateSAR;

  const rows = rawRows.map((r) => {
    const cur = (r.cur || 'AED').toUpperCase();
    const site = cur === 'SAR' ? 'SA' : 'AE';
    const rate = cur === 'SAR' ? rateSAR : rateAED;
    const qty = r.qty;
    const sale = r.sale;
    const ad = r.ad;
    const gross = r.gross;
    const c89 = r.c89;

    // 采购单价（CNY）：逐 SKU 覆盖 > 采购单 > 0
    const matchedPuCny = purchase[r.ms] != null ? Number(purchase[r.ms]) : 0;
    const puCny = ovPu[r.ms] != null ? Number(ovPu[r.ms]) : matchedPuCny;
    const puLocal = puCny * rate;
    // 头程比例：逐 SKU 覆盖 > 全局
    const headRate = ovHead[r.ms] != null ? Number(ovHead[r.ms]) : globalHead;
    const head = sale * headRate;
    const realProfitLocal = gross - c89 - qty * puLocal - head;
    const realMargin = sale > 0 ? realProfitLocal / sale : 0;

    const cny = (v) => v / rate;
    return {
      ms: r.ms, name: r.name || r.ms, shop: r.shop, cur, site, rate,
      qty, sale, ad, gross, c89,
      puCny, matchedPuCny, headRate, head,
      hasPuOverride: ovPu[r.ms] != null,
      hasHeadOverride: ovHead[r.ms] != null,
      realProfit: realProfitLocal,
      realMargin,
      saleCny: cny(sale), grossCny: cny(gross), realCny: cny(realProfitLocal), adCny: cny(ad),
    };
  });

  // KPI（全部按 CNY 汇总）
  const totSaleCny = rows.reduce((s, r) => s + r.saleCny, 0);
  const totGrossCny = rows.reduce((s, r) => s + r.grossCny, 0);
  const totRealCny = rows.reduce((s, r) => s + r.realCny, 0);
  const totAdCny = rows.reduce((s, r) => s + r.adCny, 0);
  const totQty = rows.reduce((s, r) => s + r.qty, 0);
  const overallMargin = totSaleCny > 0 ? totRealCny / totSaleCny : 0;
  const overallAcos = totSaleCny > 0 ? totAdCny / totSaleCny : 0;
  const profitN = rows.filter((r) => r.realProfit > 0).length;
  const lossN = rows.filter((r) => r.realProfit < 0).length;
  const lossWithSale = rows.filter((r) => r.realProfit < 0 && r.qty > 0).length;
  const lossZeroSale = lossN - lossWithSale;
  const zeroSaleN = rows.filter((r) => r.qty === 0).length;
  const matchedPu = rows.filter((r) => r.puCny > 0).length;

  // 盈利 TOP10
  const topProfit = [...rows].sort((a, b) => b.realCny - a.realCny).slice(0, 10);
  // 亏损预警（全量，前端展示前 N）
  const loss = [...rows].filter((r) => r.realProfit < 0).sort((a, b) => a.realCny - b.realCny);
  // 广告效率 TOP10（按本币广告费）
  const adTop = [...rows].sort((a, b) => b.ad - a.ad).slice(0, 10);

  // 分站点
  const siteStats = { AE: siteAgg(rows, 'AE'), SA: siteAgg(rows, 'SA') };

  return {
    rows,
    kpi: {
      totSaleCny, totGrossCny, totRealCny, totAdCny, totQty,
      overallMargin, overallAcos, profitN, lossN, lossWithSale, lossZeroSale, zeroSaleN, matchedPu,
    },
    topProfit, loss, adTop, siteStats,
  };
}

function siteAgg(rows, site) {
  const sub = rows.filter((r) => r.site === site);
  const sale = sub.reduce((s, r) => s + r.saleCny, 0);
  const gross = sub.reduce((s, r) => s + r.grossCny, 0);
  const real = sub.reduce((s, r) => s + r.realCny, 0);
  const ad = sub.reduce((s, r) => s + r.adCny, 0);
  return {
    cur: site === 'AE' ? 'AED' : 'SAR',
    n: sub.length,
    sale, gross, real, ad,
    margin: sale > 0 ? real / sale : 0,
    acos: sale > 0 ? ad / sale : 0,
  };
}
