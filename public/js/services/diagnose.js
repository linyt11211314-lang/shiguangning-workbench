/**
 * 广告诊断 · 规则引擎
 * 输入当前时间范围内的明细，按站点（AE / SA）分组计算核心指标，
 * 逐条匹配诊断规则，输出按优先级（高 > 中 > 低）排序的建议列表。
 *
 * 设计为纯函数（不依赖 DOM / localStorage），便于单测与复用。
 */

const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function siteLabel(s) {
  return s === 'AE' ? '中东站 AE' : s === 'SA' ? '沙特站 SA' : s;
}

// —— 日期工具（与 ads.js 保持一致，避免跨模块耦合）——
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function daysBetween(start, end) {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  const diff = Math.round((b - a) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}

/** 计算单个站点（一组明细）的核心指标 */
export function computeSiteMetrics(site, recs, all, start, end, rangeLabel = '当前区间') {
  const t = { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, totalSales: 0 };
  for (const r of recs) {
    t.cost += r.cost;
    t.sales += r.sales;
    t.orders += r.orders;
    t.clicks += r.clicks;
    t.impressions += r.impressions;
    t.totalSales += r.totalSales || 0;
  }
  const acos = t.sales > 0 ? (t.cost / t.sales) * 100 : null;
  const roas = t.cost > 0 ? t.sales / t.cost : 0;
  const ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null;
  const adRatio = t.totalSales > 0 ? (t.sales / t.totalSales) * 100 : null;

  // 环比：前一个等长时间窗口（用于「花费增长但收入未同步增长」规则）
  let prevCost = 0;
  let prevSales = 0;
  if (all && start && end) {
    const len = daysBetween(start, end);
    const pEnd = addDays(start, -1);
    const pStart = addDays(pEnd, -(len - 1));
    for (const r of all) {
      if (r.site === site && r.date >= pStart && r.date <= pEnd) {
        prevCost += r.cost;
        prevSales += r.sales;
      }
    }
  }
  const costGrowth = prevCost > 0 ? ((t.cost - prevCost) / prevCost) * 100 : null;
  const salesGrowth = prevSales > 0 ? ((t.sales - prevSales) / prevSales) * 100 : null;

  return {
    site,
    siteLabel: siteLabel(site),
    cost: t.cost,
    sales: t.sales,
    orders: t.orders,
    clicks: t.clicks,
    impressions: t.impressions,
    totalSales: t.totalSales,
    acos,
    roas,
    ctr,
    adRatio,
    prevCost,
    prevSales,
    costGrowth,
    salesGrowth,
    rangeLabel,
    hasData: recs.length > 0,
  };
}

/**
 * 诊断规则表（与设计稿「2.3 诊断规则表」一致）
 * 每条规则：test(指标) 判定是否触发；build(指标) 生成 问题文案 + 3 条建议 + 触发数据快照
 */
const RULES = [
  {
    key: 'acos_high',
    priority: 'high',
    test: (m) => m.sales > 0 && m.acos > 35,
    build: (m) => ({
      problem: `ACOS 偏高（${m.acos.toFixed(1)}%），超出健康线（35%）`,
      points: ['检查关键词匹配方式，减少广泛匹配', '暂停高花费低转化关键词', '优化产品详情页提升转化率'],
      trigger: `ACOS ${m.acos.toFixed(1)}%`,
    }),
  },
  {
    key: 'acos_mid',
    priority: 'low',
    test: (m) => m.sales > 0 && m.acos >= 25 && m.acos <= 35,
    build: (m) => ({
      problem: `ACOS 处于健康范围（${m.acos.toFixed(1)}%）`,
      points: ['可适当增加预算扩大曝光', '关注竞品关键词变化'],
      trigger: `ACOS ${m.acos.toFixed(1)}%`,
    }),
  },
  {
    key: 'acos_good',
    priority: 'low',
    test: (m) => m.sales > 0 && m.acos < 25,
    build: (m) => ({
      problem: `ACOS 表现优秀（${m.acos.toFixed(1)}%）`,
      points: ['可尝试增加投放预算', '拓展高转化关键词，扩大优势'],
      trigger: `ACOS ${m.acos.toFixed(1)}%`,
    }),
  },
  {
    key: 'cost_no_sales',
    priority: 'high',
    test: (m) => m.cost > 0 && m.sales <= 0,
    build: (m) => ({
      problem: `有花费但无广告收入（花费 ¥${fmtMoney(m.cost)}）`,
      points: ['检查广告出价是否过低', '检查关键词与产品的相关性', '考虑暂停该广告活动，重新评估投放策略'],
      trigger: `花费 ¥${fmtMoney(m.cost)} · 销售额 ¥0.00`,
    }),
  },
  {
    key: 'cost_no_orders',
    priority: 'mid',
    test: (m) => m.cost > 0 && m.orders <= 0,
    build: (m) => ({
      problem: `有花费但无订单转化（订单 0 · 花费 ¥${fmtMoney(m.cost)}）`,
      points: ['优化产品详情页', '检查价格竞争力', '检查关键词精准度'],
      trigger: `花费 ¥${fmtMoney(m.cost)} · 订单 0`,
    }),
  },
  {
    key: 'ad_ratio_low',
    priority: 'mid',
    test: (m) => m.adRatio != null && m.adRatio < 20,
    build: (m) => ({
      problem: `广告收入占比较低（${m.adRatio.toFixed(1)}%，低于建议值 20%）`,
      points: ['检查广告出价是否过低', '增加核心关键词出价', '尝试增加新的广告类型'],
      trigger: `广告收入占比 ${m.adRatio.toFixed(1)}%`,
    }),
  },
  {
    key: 'ctr_low',
    priority: 'mid',
    test: (m) => m.ctr != null && m.ctr < 0.5,
    build: (m) => ({
      problem: `点击率偏低（${m.ctr.toFixed(2)}%）`,
      points: ['优化产品主图，突出卖点', '优化标题关键词', '检查广告位置是否靠后'],
      trigger: `CTR ${m.ctr.toFixed(2)}%`,
    }),
  },
  {
    key: 'imp_low',
    priority: 'low',
    test: (m) => m.cost > 0 && m.impressions < 100,
    build: (m) => ({
      problem: `曝光量偏低（${m.impressions}）`,
      points: ['提高关键词出价', '增加关键词数量', '检查广告是否被抑制'],
      trigger: `曝光 ${m.impressions}`,
    }),
  },
  {
    key: 'cost_up_sales_flat',
    priority: 'high',
    test: (m) => m.costGrowth != null && m.costGrowth > 20 && m.salesGrowth != null && m.salesGrowth < 5,
    build: (m) => ({
      problem: `${m.rangeLabel}花费增长但收入未同步增长（花费环比 +${m.costGrowth.toFixed(0)}% · 收入环比 ${m.salesGrowth.toFixed(0)}%）`,
      points: ['检查是否存在无效点击', '暂停部分测试性广告', '优化关键词精准度'],
      trigger: `花费环比 +${m.costGrowth.toFixed(0)}% · 收入环比 ${m.salesGrowth.toFixed(0)}%`,
    }),
  },
];

const PRIO_LABEL = { high: '高', mid: '中', low: '低' };

/**
 * 生成诊断建议
 * @param {Array} ranged 当前时间范围内的明细
 * @param {Object} [opts]
 * @param {Array}  [opts.all] 全部明细（用于环比对比）
 * @param {string} [opts.start] 范围起点 YYYY-MM-DD
 * @param {string} [opts.end] 范围终点 YYYY-MM-DD
 * @param {string} [opts.rangeLabel] 范围描述（近7天/近30天/自定义区间）
 * @returns {{suggestions:Array, generatedAt:number}}
 */
export function diagnose(ranged, { all, start, end, rangeLabel = '当前区间' } = {}) {
  const suggestions = [];
  for (const site of ['AE', 'SA']) {
    const recs = ranged.filter((r) => r.site === site);
    if (!recs.length) continue;
    const m = computeSiteMetrics(site, recs, all, start, end, rangeLabel);
    for (const rule of RULES) {
      if (rule.test(m)) {
        const b = rule.build(m);
        suggestions.push({
          id: `${site}|${rule.key}`,
          site,
          ruleKey: rule.key,
          priority: rule.priority,
          prioLabel: PRIO_LABEL[rule.priority],
          siteLabel: m.siteLabel,
          problem: b.problem,
          points: b.points,
          trigger: b.trigger,
        });
      }
    }
  }
  suggestions.sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.site.localeCompare(b.site)
  );
  return { suggestions, generatedAt: Date.now() };
}

/** 将一条建议拼成完整文案（用于反馈存储 / 详情展示） */
export function suggestionToText(sug) {
  return `${sug.siteLabel} ${sug.problem} 建议：${sug.points.join('；')}`;
}
