/**
 * 广告诊断 · 文件解析与字段映射
 * 依赖全局 XLSX（/vendor/xlsx.full.min.js，SheetJS 本地托管）
 */

/** 系统字段定义（key / 中文名 / 是否必填 / 匹配关键词） */
export const FIELD_DEFS = [
  { key: 'date', label: '日期', required: true, keywords: ['日期', 'date', 'day', '时间', '报表日期', '统计日期'] },
  { key: 'site', label: '站点', required: false, keywords: ['站点', 'site', 'marketplace', '国家', '站', '店铺'] },
  { key: 'cost', label: '花费', required: true, keywords: ['花费', 'cost', 'spend', '广告花费', '广告费', 'costs'] },
  { key: 'sales', label: '销售额', required: true, keywords: ['销售额', 'sales', '广告销售额', '营收', '收入', 'sale'] },
  { key: 'totalSales', label: '总销售额', required: false, keywords: ['总销售额', 'totalsales', '销售额(总)', '整体销售额', '自然销售额', 'organic', 'total'] },
  { key: 'impressions', label: '曝光', required: true, keywords: ['曝光', 'impression', 'imp', '展示', '曝光量', 'impr'] },
  { key: 'clicks', label: '点击', required: true, keywords: ['点击', 'click', 'clicks', '点击量'] },
  { key: 'orders', label: '订单', required: true, keywords: ['订单', 'order', 'orders', '转化数', '订单量'] },
  // —— 关键词级 / 活动级可选字段（用于精细化诊断；缺省时自动降级为站点级汇总诊断）——
  { key: 'keyword', label: '关键词', required: false, keywords: ['关键词', 'keyword', 'searchterm', 'search term', '客户搜索词', '查询词', '词', '搜索词'] },
  { key: 'adType', label: '广告类型', required: false, keywords: ['广告类型', '类型', 'adtype', 'campaigntype', '广告组合类型', '推广类型'] },
  { key: 'campaign', label: '广告活动', required: false, keywords: ['广告活动', 'campaign', '广告活动名称', '活动', '推广活动', '广告组'] },
  { key: 'matchType', label: '匹配类型', required: false, keywords: ['匹配类型', '匹配方式', 'matchtype', 'match type', '匹配', '投放匹配', '关键词匹配', 'match'] },
  { key: 'asin', label: 'ASIN', required: false, keywords: ['asin', 'ASIN', '子asin', '商品', '子体'] },
  { key: 'bid', label: '出价', required: false, keywords: ['出价', '竞价', 'bid', '默认竞价', '关键词出价'] },
  { key: 'suggestedBid', label: '建议竞价', required: false, keywords: ['建议竞价', '建议出价', 'suggestedbid', '建议竞价范围', '建议竞价下限', '建议出价范围'] },
];

const NUMERIC_KEYS = ['cost', 'sales', 'impressions', 'clicks', 'orders', 'bid', 'suggestedBid'];

function normHeader(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-－()（）\[\]【】]/g, '')
    .trim();
}

/** 读取文件为 JSON 行数组（对象键为表头） */
export async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let wb;
  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(buf);
    wb = XLSX.read(text, { type: 'string' });
  } else {
    wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return rows;
}

/** 自动识别字段：返回 { systemKey: fileHeader | null } */
export function detectFields(headers) {
  const result = {};
  for (const def of FIELD_DEFS) {
    let best = null;
    let bestScore = 0;
    for (const h of headers) {
      const nh = normHeader(h);
      if (!nh) continue;
      let score = 0;
      for (const kw of def.keywords) {
        const nk = normHeader(kw);
        if (nh === nk) score = Math.max(score, 100);
        else if (nh.startsWith(nk) || nk.startsWith(nh)) score = Math.max(score, 70);
        else if (nh.includes(nk) || nk.includes(nh)) score = Math.max(score, 40);
      }
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    result[def.key] = bestScore >= 40 ? best : null;
  }
  return result;
}

export function coerceNumber(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/** 从可能带单位的字符串中取第一个数值（用于「建议竞价 $0.50 - $0.80」取下限 0.50） */
export function firstNum(v) {
  if (v === null || v === undefined) return 0;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** 归一化广告类型：SP / SB / SD（兼容中文与英文） */
export function normAdType(v) {
  if (!v) return '';
  const s = String(v).trim().toUpperCase();
  if (s.includes('SP') || s.includes('商品推广') || s.includes('SPONSORED PRODUCTS')) return 'SP';
  if (s.includes('SB') || s.includes('品牌推广') || s.includes('SPONSORED BRANDS')) return 'SB';
  if (s.includes('SD') || s.includes('展示') || s.includes('SPONSORED DISPLAY')) return 'SD';
  return s || '';
}

/** 归一化匹配类型：广泛 / 词组 / 精准（兼容 broad/phrase/exact 与中文） */
export function normMatchType(v) {
  if (!v) return '';
  const s = String(v).trim().toLowerCase();
  if (s.includes('broad') || s.includes('广泛')) return 'broad';
  if (s.includes('phrase') || s.includes('词组')) return 'phrase';
  if (s.includes('exact') || s.includes('精准')) return 'exact';
  return '';
}

export function normalizeDate(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\//g, '-').trim();
  s = s.split(' ')[0];
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return s;
}

export function normalizeSite(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim().toUpperCase();
  if (s.includes('AE') || s.includes('阿联酋') || s.includes('中东')) return 'AE';
  if (s.includes('SA') || s.includes('沙特')) return 'SA';
  return s || '';
}

/**
 * 将原始行 + 映射 + 默认站点 转为系统明细
 * @returns {Array} 明细数组
 */
export function buildRecords(rawRows, mapping, defaultSite, importId) {
  const out = [];
  for (const raw of rawRows) {
    const get = (k) => {
      const col = mapping[k];
      return col ? raw[col] : '';
    };
    const date = normalizeDate(get('date'));
    if (!date) continue; // 无日期的行跳过
    let site = mapping.site ? normalizeSite(get('site')) : '';
    if (!site) site = defaultSite && defaultSite !== 'ALL' ? defaultSite : '';
    if (!site) continue; // 无法确定站点的行跳过
    const kw = String(get('keyword') || '').trim();
    const camp = String(get('campaign') || '').trim();
    const adType = normAdType(get('adType'));
    const matchType = normMatchType(get('matchType'));
    const asin = String(get('asin') || '').trim();
    const sugBidRaw = get('suggestedBid');
    const rec = {
      id: [site, date, kw && `k:${kw}`, camp && `c:${camp}`, adType && `t:${adType}`, matchType && `m:${matchType}`].filter(Boolean).join('|'),
      site,
      date,
      cost: coerceNumber(get('cost')),
      sales: coerceNumber(get('sales')),
      totalSales: coerceNumber(get('totalSales')),
      impressions: coerceNumber(get('impressions')),
      clicks: coerceNumber(get('clicks')),
      orders: coerceNumber(get('orders')),
      keyword: kw,
      adType,
      matchType,
      campaign: camp,
      asin,
      bid: coerceNumber(get('bid')),
      suggestedBid: firstNum(sugBidRaw),
      suggestedBidText: sugBidRaw != null && sugBidRaw !== '' ? String(sugBidRaw) : '',
      importId,
      at: Date.now(),
    };
    out.push(rec);
  }
  return out;
}

/** 校验映射是否满足必填 */
export function validateMapping(mapping) {
  const missing = FIELD_DEFS.filter((d) => d.required && !mapping[d.key]).map((d) => d.label);
  return missing;
}
