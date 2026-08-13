/**
 * 广告诊断 · 规则引擎（第二版：基于具体数据的可执行诊断）
 *
 * 设计目标：把「泛泛建议」升级为「可落地的操作指令」。
 * - 若导入的是关键词级报表（含 keyword / adType / bid 等字段），逐词/逐活动给出
 *   定位、数据支撑、影响量化、可执行操作、预期效果 5 要素建议。
 * - 若仅导入站点级汇总（只有 站点×日期 的花费/收入），则给出站点级建议，
 *   并提示导入关键词级报表以获得更精准诊断。
 *
 * 纯函数（不依赖 DOM / localStorage），便于单测与复用。
 */

const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };
const PRIO_LABEL = { high: '高', mid: '中', low: '低' };

// 阈值常量
const MIN_WASTE = 10; // ¥：花费超过此值且 0 转化视为「高花费」
const ACOS_HEALTHY = 35; // 健康线
const ACOS_GREAT = 25;
const CTR_LOW = 0.5; // %
const IMP_LOW = 100;
const CONV_LOW = 5; // %

const NOTE_KEYWORD =
  '当前数据为站点级汇总。如需更精准的关键词级诊断，请在领星中导出「SP 关键词报表」或「搜索词报表」后导入。';
const NOTE_CAMPAIGN =
  '当前数据为广告活动级。如需关键词级精准诊断，请在领星中导出「SP 关键词报表」或「搜索词报表」后导入。';

function fmtMoney(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function siteLabel(s) {
  return s === 'AE' ? '中东站 AE' : s === 'SA' ? '沙特站 SA' : s;
}
function adTypeLabel(t) {
  if (t === 'SP') return 'SP广告';
  if (t === 'SB') return 'SB广告';
  if (t === 'SD') return 'SD广告';
  return t ? `${t}广告` : '广告';
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

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

/** 求和一组明细的基础数值 */
function aggregate(recs) {
  const t = { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, totalSales: 0 };
  for (const r of recs) {
    t.cost += r.cost;
    t.sales += r.sales;
    t.orders += r.orders;
    t.clicks += r.clicks;
    t.impressions += r.impressions;
    t.totalSales += r.totalSales || 0;
  }
  return t;
}

/** 由求和结果派生比率指标 */
function deriveMetrics(a, site, rangeLabel) {
  const acos = a.sales > 0 ? (a.cost / a.sales) * 100 : null;
  const roas = a.cost > 0 ? a.sales / a.cost : 0;
  const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
  const adRatio = a.totalSales > 0 ? (a.sales / a.totalSales) * 100 : null;
  const convRate = a.clicks > 0 ? (a.orders / a.clicks) * 100 : null;
  return {
    site,
    siteLabel: siteLabel(site),
    cost: a.cost,
    sales: a.sales,
    orders: a.orders,
    clicks: a.clicks,
    impressions: a.impressions,
    totalSales: a.totalSales,
    acos,
    roas,
    ctr,
    adRatio,
    convRate,
    rangeLabel,
  };
}

/** 由一组（同一对象）明细构建完整指标对象 */
function buildObjectMetric(grp, site, rangeLabel) {
  const a = aggregate(grp);
  const m = deriveMetrics(a, site, rangeLabel);
  const first = grp[0];
  m.key = first.keyword || first.campaign || first.asin || '未知对象';
  m.adType = first.adType || '';
  m.bid = first.bid || 0;
  m.suggestedBid = first.suggestedBid || 0;
  m.suggestedBidText = first.suggestedBidText || '';
  m.campaign = first.campaign || '';
  m.keyword = first.keyword || '';
  return m;
}

/** 构造一条诊断建议（统一 5 要素结构） */
function buildSuggestion(o) {
  return {
    id: o.id,
    site: o.site,
    ruleKey: o.ruleKey,
    priority: o.priority,
    prioLabel: PRIO_LABEL[o.priority],
    siteLabel: siteLabel(o.site),
    objectLabel: o.objectLabel,
    problem: o.problem,
    dataSupport: (o.dataSupport || []).filter(Boolean),
    impact: o.impact || '',
    points: o.points || [],
    expected: o.expected || '',
    trigger: o.trigger || '',
    granularityNote: o.granularityNote || null,
  };
}

/** 对象级（关键词 / 广告活动）规则集 */
function objectSuggestions(site, m, ctx) {
  const out = [];
  const kind = ctx.objectType; // 'keyword' | 'campaign'
  const kindName = kind === 'keyword' ? '关键词' : '广告活动';
  const adLabel = adTypeLabel(m.adType);
  const objLabel = `${adLabel} · ${kindName}：${m.key}`;
  const rl = ctx.rangeLabel;
  const shareTxt = m.share != null ? ` （占该活动总花费 ${m.share.toFixed(0)}%）` : '';
  const bidTxt =
    m.bid > 0 || m.suggestedBid > 0
      ? `当前出价：$${fmtMoney(m.bid)} · 建议竞价：$${fmtMoney(m.suggestedBid)}${
          m.suggestedBidText && m.suggestedBidText !== String(m.suggestedBid) ? `（${m.suggestedBidText}）` : ''
        }`
      : null;

  // 1. 高花费无转化
  if (m.cost > 0 && m.orders === 0) {
    const high = m.cost >= MIN_WASTE;
    const newAcos =
      m.campM && m.campM.sales > 0 ? (m.campM.cost - m.cost) / m.campM.sales * 100 : null;
    out.push(
      buildSuggestion({
        id: `${site}|obj|high_spend_no_conv|${m.key}|${m.adType}`,
        site,
        ruleKey: 'high_spend_no_conv',
        priority: high ? 'high' : 'mid',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」高花费无转化（花费 ¥${fmtMoney(m.cost)} · ${m.orders} 单）`,
        dataSupport: [
          `花费：¥${fmtMoney(m.cost)}${shareTxt}`,
          `点击：${m.clicks} 次`,
          `转化：${m.orders} 单`,
          `ACOS：${m.sales > 0 ? m.acos.toFixed(1) + '%' : 'N/A（无收入）'}`,
          bidTxt,
        ],
        impact: `近${rl}该${kindName}已浪费 ¥${fmtMoney(m.cost)}${m.share != null ? `，占该活动预算 ${m.share.toFixed(0)}%` : ''}`,
        points: [
          `① 立即暂停${kindName}「${m.key}」（浪费严重，不建议保留）`,
          `② 将其添加为否定${kind === 'keyword' ? '关键词' : '投放'}，避免重复花费`,
          `③ 将预算转移至该${kind === 'keyword' ? '活动' : '账户'}中表现更好的对象（如 ACOS 较低者）`,
        ],
        expected:
          newAcos != null
            ? `暂停后预计节省 ¥${fmtMoney(m.cost)}/周期，活动 ACOS 可从 ${m.campM.acos.toFixed(1)}% 降至约 ${newAcos.toFixed(0)}%`
            : `暂停后预计节省 ¥${fmtMoney(m.cost)}/周期`,
        trigger: `${kindName} ${m.key} 花费¥${fmtMoney(m.cost)} 0单`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 2. ACOS 偏高
  if (m.sales > 0 && m.acos > ACOS_HEALTHY) {
    const waste = Math.max(0, m.cost - m.sales * (ACOS_HEALTHY / 100));
    out.push(
      buildSuggestion({
        id: `${site}|obj|acos_high|${m.key}|${m.adType}`,
        site,
        ruleKey: 'acos_high',
        priority: 'high',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」ACOS 偏高（${m.acos.toFixed(1)}%，超出健康线 ${ACOS_HEALTHY}%）`,
        dataSupport: [
          `花费：¥${fmtMoney(m.cost)}`,
          `销售额：¥${fmtMoney(m.sales)}`,
          `ACOS：${m.acos.toFixed(1)}%`,
          `点击：${m.clicks} 次`,
          `订单：${m.orders} 单`,
        ],
        impact: `近${rl}超出健康线（${ACOS_HEALTHY}%）的无效花费约 ¥${fmtMoney(waste)}`,
        points: [
          `① 将匹配方式由广泛改为词组/精准，减少无效流量`,
          `② 下调表现差的长尾词出价`,
          `③ 优化该${kindName}落地 ASIN 的详情页与评价`,
        ],
        expected: `若将 ACOS 压至 ${ACOS_HEALTHY}%，预计每周期可节省约 ¥${fmtMoney(waste)}`,
        trigger: `ACOS ${m.acos.toFixed(1)}%`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 2b. ACOS 优秀（正向，低优先级，仅在有实质花费时提示扩量）
  if (m.sales > 0 && m.acos < ACOS_GREAT && m.cost >= 10) {
    out.push(
      buildSuggestion({
        id: `${site}|obj|acos_good|${m.key}|${m.adType}`,
        site,
        ruleKey: 'acos_good',
        priority: 'low',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」ACOS 表现优秀（${m.acos.toFixed(1)}%）`,
        dataSupport: [
          `花费：¥${fmtMoney(m.cost)}`,
          `销售额：¥${fmtMoney(m.sales)}`,
          `ACOS：${m.acos.toFixed(1)}%`,
          `ROAS：${m.roas.toFixed(1)}`,
        ],
        impact: `该${kindName}投放效率优秀，是当前账户的利润来源之一`,
        points: [
          `① 可适当提高该${kindName}出价扩量`,
          `② 拓展与其相关的高转化词`,
          `③ 观察 ACOS 是否随量上升`,
        ],
        expected: `稳步加预算有望在不牺牲 ACOS 的前提下放大利润`,
        trigger: `ACOS ${m.acos.toFixed(1)}%`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 3. 出价低于建议竞价
  if (m.suggestedBid > 0 && m.bid > 0 && m.bid < m.suggestedBid * 0.95) {
    const mid = (m.bid + m.suggestedBid) / 2;
    out.push(
      buildSuggestion({
        id: `${site}|obj|bid_low|${m.key}|${m.adType}`,
        site,
        ruleKey: 'bid_low',
        priority: 'mid',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」出价 $${fmtMoney(m.bid)} 低于建议竞价 $${fmtMoney(m.suggestedBid)}`,
        dataSupport: [
          `当前出价：$${fmtMoney(m.bid)}`,
          `建议竞价：$${fmtMoney(m.suggestedBid)}${
            m.suggestedBidText && m.suggestedBidText !== String(m.suggestedBid) ? `（${m.suggestedBidText}）` : ''
          }`,
          `曝光：${m.impressions} 次`,
          `点击：${m.clicks} 次`,
          `CTR：${m.ctr != null ? m.ctr.toFixed(2) + '%' : '-'}`,
          `ACOS：${m.sales > 0 ? m.acos.toFixed(1) + '%' : 'N/A'}`,
        ],
        impact: `出价偏低削弱广告竞争力，近${rl}排名靠后、曝光不足，错失潜在点击与订单`,
        points: [
          `① 将出价提升至建议区间中值 $${fmtMoney(mid)}`,
          `② 观察 3 天曝光与点击变化`,
          `③ 若 ROAS 达标再小幅加价扩量`,
        ],
        expected: `提价后预计曝光与点击提升 20%~40%，单量有望增加`,
        trigger: `出价 $${fmtMoney(m.bid)} / 建议 $${fmtMoney(m.suggestedBid)}`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 4. 点击率偏低
  if (m.ctr != null && m.ctr < CTR_LOW && m.impressions > 0) {
    out.push(
      buildSuggestion({
        id: `${site}|obj|ctr_low|${m.key}|${m.adType}`,
        site,
        ruleKey: 'ctr_low',
        priority: 'mid',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」点击率偏低（${m.ctr.toFixed(2)}%）`,
        dataSupport: [`CTR：${m.ctr.toFixed(2)}%`, `曝光：${m.impressions} 次`, `点击：${m.clicks} 次`],
        impact: `低 CTR 拉低广告质量得分，近${rl} ${m.clicks} 次点击的引流效率有限`,
        points: [
          `① 更换高点击主图，突出核心卖点`,
          `② 优化标题前 30 字符关键词`,
          `③ 检查搜索词报告排除不相关流量`,
        ],
        expected: `CTR 提升至 0.8% 以上后，同等花费可获得更多点击与转化`,
        trigger: `CTR ${m.ctr.toFixed(2)}%`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 5. 曝光偏低
  if (m.cost > 0 && m.impressions < IMP_LOW) {
    out.push(
      buildSuggestion({
        id: `${site}|obj|imp_low|${m.key}|${m.adType}`,
        site,
        ruleKey: 'imp_low',
        priority: 'low',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」曝光量偏低（${m.impressions} 次）`,
        dataSupport: [`曝光：${m.impressions} 次`, `花费：¥${fmtMoney(m.cost)}`, `点击：${m.clicks} 次`],
        impact: `曝光不足导致该${kindName}几乎无法触达买家，近${rl}仅 ${m.impressions} 次曝光`,
        points: [
          `① 提高关键词出价争取更靠前位置`,
          `② 增加该${kindName}的关键词数量`,
          `③ 检查广告是否因合规被抑制`,
        ],
        expected: `提升出价与词量后曝光有望成倍增长`,
        trigger: `曝光 ${m.impressions}`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  // 6. 转化率偏低
  if (m.sales > 0 && m.clicks >= 20 && m.convRate != null && m.convRate < CONV_LOW) {
    const extra = Math.max(0, Math.round(m.clicks * 0.08) - m.orders);
    out.push(
      buildSuggestion({
        id: `${site}|obj|conv_low|${m.key}|${m.adType}`,
        site,
        ruleKey: 'conv_low',
        priority: 'mid',
        objectLabel: objLabel,
        problem: `${kindName}「${m.key}」转化率偏低（${m.convRate.toFixed(1)}%，约 ${m.orders} 单 / ${m.clicks} 点击）`,
        dataSupport: [
          `转化率：${m.convRate.toFixed(1)}%`,
          `点击：${m.clicks} 次`,
          `订单：${m.orders} 单`,
          `ACOS：${m.acos.toFixed(1)}%`,
        ],
        impact: `近${rl}该${kindName}带来 ${m.clicks} 次点击仅 ${m.orders} 单，流量质量欠佳`,
        points: [
          `① 优化落地 ASIN 主图与 A+ 页面`,
          `② 补充带图评价提升信任度`,
          `③ 收紧匹配方式聚焦精准词`,
        ],
        expected: extra > 0 ? `若转化率提升至 8%，同等点击可多约 ${extra} 单` : `优化详情页后转化率有望提升至 8% 左右`,
        trigger: `转化率 ${m.convRate.toFixed(1)}%`,
        granularityNote: ctx.granularityNote || null,
      })
    );
  }

  return out;
}

/** 站点级（汇总）规则集：用 5 要素结构化呈现 + 粒度提示 */
function siteSuggestions(site, m) {
  const out = [];
  const obj = `${m.siteLabel}（站点级汇总）`;
  const rl = m.rangeLabel;
  const note = NOTE_KEYWORD;

  // ACOS 偏高
  if (m.sales > 0 && m.acos > ACOS_HEALTHY) {
    const waste = Math.max(0, m.cost - m.sales * (ACOS_HEALTHY / 100));
    out.push(
      buildSuggestion({
        id: `${site}|site|acos_high`,
        site,
        ruleKey: 'acos_high',
        priority: 'high',
        objectLabel: obj,
        problem: `整体 ACOS 偏高（${m.acos.toFixed(1)}%），超出健康线 ${ACOS_HEALTHY}%`,
        dataSupport: [
          `整体 ACOS：${m.acos.toFixed(1)}%`,
          `总花费：¥${fmtMoney(m.cost)}`,
          `总广告销售额：¥${fmtMoney(m.sales)}`,
          `时间范围：${rl}`,
        ],
        impact: `近${rl}超出健康线（${ACOS_HEALTHY}%）的无效花费约 ¥${fmtMoney(waste)}`,
        points: [
          `① 导出该站点关键词报表，找出 ACOS>${ACOS_HEALTHY}% 的高花费词并暂停`,
          `② 将广泛匹配改为词组/精准匹配`,
          `③ 优化转化差的 ASIN 详情页`,
        ],
        expected: `若将整体 ACOS 压至 ${ACOS_HEALTHY}%，预计每周期可节省约 ¥${fmtMoney(waste)}`,
        trigger: `ACOS ${m.acos.toFixed(1)}%`,
        granularityNote: note,
      })
    );
  }

  // ACOS 处于健康/优秀（正向建议）
  if (m.sales > 0 && m.acos <= ACOS_HEALTHY) {
    const good = m.acos < ACOS_GREAT;
    out.push(
      buildSuggestion({
        id: `${site}|site|acos_ok`,
        site,
        ruleKey: good ? 'acos_good' : 'acos_mid',
        priority: 'low',
        objectLabel: obj,
        problem: `ACOS ${good ? '表现优秀' : '处于健康范围'}（${m.acos.toFixed(1)}%）`,
        dataSupport: [`整体 ACOS：${m.acos.toFixed(1)}%`, `总花费：¥${fmtMoney(m.cost)}`, `总销售额：¥${fmtMoney(m.sales)}`],
        impact: `当前投放效率良好，可在此基础上适度扩量`,
        points: good
          ? [`① 适当提高表现好的广告出价扩量`, `② 拓展高转化关键词，扩大优势`]
          : [`① 可适当增加预算扩大曝光`, `② 关注竞品关键词变化`],
        expected: `稳步加预算有望在不牺牲 ACOS 的前提下放大利润`,
        trigger: `ACOS ${m.acos.toFixed(1)}%`,
        granularityNote: note,
      })
    );
  }

  // 有花费但无广告收入
  if (m.cost > 0 && m.sales <= 0) {
    out.push(
      buildSuggestion({
        id: `${site}|site|cost_no_sales`,
        site,
        ruleKey: 'cost_no_sales',
        priority: 'high',
        objectLabel: obj,
        problem: `有花费但无广告收入（花费 ¥${fmtMoney(m.cost)}）`,
        dataSupport: [
          `花费：¥${fmtMoney(m.cost)}`,
          `广告销售额：¥0.00`,
          `订单：0`,
          `点击：${m.clicks} 次`,
          `曝光：${m.impressions} 次`,
        ],
        impact: `近${rl}花费 ¥${fmtMoney(m.cost)} 全部为无效投放，造成 ¥${fmtMoney(m.cost)} 的纯浪费`,
        points: [
          `① 导出搜索词报表，暂停零转化词`,
          `② 检查关键词与 ASIN 的相关性`,
          `③ 重新评估该站点投放策略`,
        ],
        expected: `清理无效词后，同等预算可集中到转化词，ACOS 有望显著下降`,
        trigger: `花费 ¥${fmtMoney(m.cost)} · 销售额 ¥0.00`,
        granularityNote: note,
      })
    );
  }

  // 有花费但无订单转化（有收入但 0 单，罕见，作中优先级）
  if (m.cost > 0 && m.orders <= 0 && m.sales > 0) {
    out.push(
      buildSuggestion({
        id: `${site}|site|cost_no_orders`,
        site,
        ruleKey: 'cost_no_orders',
        priority: 'mid',
        objectLabel: obj,
        problem: `有花费但无订单转化（订单 0 · 花费 ¥${fmtMoney(m.cost)}）`,
        dataSupport: [`花费：¥${fmtMoney(m.cost)}`, `订单：0`, `广告销售额：¥${fmtMoney(m.sales)}`],
        impact: `近${rl}产生销售额但无成交订单，可能存在数据延迟或转化路径异常`,
        points: [`① 核对订单回传是否完整`, `② 检查价格竞争力`, `③ 检查关键词精准度`],
        expected: `补全省核后订单数据应回归正常`,
        trigger: `花费 ¥${fmtMoney(m.cost)} · 订单 0`,
        granularityNote: note,
      })
    );
  }

  // 广告收入占比偏低
  if (m.adRatio != null && m.adRatio < 20) {
    out.push(
      buildSuggestion({
        id: `${site}|site|ad_ratio_low`,
        site,
        ruleKey: 'ad_ratio_low',
        priority: 'mid',
        objectLabel: obj,
        problem: `广告收入占比较低（${m.adRatio.toFixed(1)}%，低于建议值 20%）`,
        dataSupport: [
          `广告收入占比：${m.adRatio.toFixed(1)}%`,
          `广告销售额：¥${fmtMoney(m.sales)}`,
          `总销售额：¥${fmtMoney(m.totalSales)}`,
        ],
        impact: `自然流量未充分承接广告引流，近${rl}广告仅贡献 ${m.adRatio.toFixed(1)}% 的销售额`,
        points: [`① 提高核心关键词出价争取更优位`, `② 增加品牌词与竞品词投放`, `③ 配合 Coupon/秒杀提升转化`],
        expected: `优化后广告占比有望提升至 20%+`,
        trigger: `广告收入占比 ${m.adRatio.toFixed(1)}%`,
        granularityNote: note,
      })
    );
  }

  // CTR 偏低
  if (m.ctr != null && m.ctr < CTR_LOW) {
    out.push(
      buildSuggestion({
        id: `${site}|site|ctr_low`,
        site,
        ruleKey: 'ctr_low',
        priority: 'mid',
        objectLabel: obj,
        problem: `整体点击率偏低（${m.ctr.toFixed(2)}%）`,
        dataSupport: [`CTR：${m.ctr.toFixed(2)}%`, `曝光：${m.impressions} 次`, `点击：${m.clicks} 次`],
        impact: `低 CTR 导致同等曝光下点击不足，浪费了 ${m.impressions} 次曝光的引流机会`,
        points: [`① 优化主图与标题`, `② 排除不相关搜索词`, `③ 提升 bids 争取更靠前位置`],
        expected: `CTR 提升后同等花费可获得更多点击`,
        trigger: `CTR ${m.ctr.toFixed(2)}%`,
        granularityNote: note,
      })
    );
  }

  // 曝光偏低
  if (m.cost > 0 && m.impressions < IMP_LOW) {
    out.push(
      buildSuggestion({
        id: `${site}|site|imp_low`,
        site,
        ruleKey: 'imp_low',
        priority: 'low',
        objectLabel: obj,
        problem: `曝光量偏低（${m.impressions}）`,
        dataSupport: [`曝光：${m.impressions} 次`, `花费：¥${fmtMoney(m.cost)}`, `点击：${m.clicks} 次`],
        impact: `曝光不足导致几乎无法触达买家，近${rl}仅 ${m.impressions} 次曝光`,
        points: [`① 提高关键词出价`, `② 增加关键词数量`, `③ 检查广告是否被抑制`],
        expected: `提升出价与词量后曝光有望成倍增长`,
        trigger: `曝光 ${m.impressions}`,
        granularityNote: note,
      })
    );
  }

  // 花费增长但收入未同步增长
  if (m.costGrowth != null && m.costGrowth > 20 && m.salesGrowth != null && m.salesGrowth < 5) {
    out.push(
      buildSuggestion({
        id: `${site}|site|cost_up_sales_flat`,
        site,
        ruleKey: 'cost_up_sales_flat',
        priority: 'high',
        objectLabel: obj,
        problem: `近${rl}花费增长但收入未同步增长（花费环比 +${m.costGrowth.toFixed(0)}% · 收入环比 ${m.salesGrowth.toFixed(0)}%）`,
        dataSupport: [
          `花费环比：+${m.costGrowth.toFixed(0)}%`,
          `收入环比：${m.salesGrowth.toFixed(0)}%`,
          `总花费：¥${fmtMoney(m.cost)}`,
          `总销售额：¥${fmtMoney(m.sales)}`,
        ],
        impact: `增量花费未带来增量收入，存在无效点击或测试广告拖累`,
        points: [`① 检查搜索词报告排除垃圾流量`, `② 暂停 ROI 为负的测试广告`, `③ 收紧关键词精准度`],
        expected: `止血后花费效率提升，ROAS 可回升`,
        trigger: `花费环比 +${m.costGrowth.toFixed(0)}% · 收入环比 ${m.salesGrowth.toFixed(0)}%`,
        granularityNote: note,
      })
    );
  }

  return out;
}

/** 计算单个站点（一组明细）的核心指标（用于站点级诊断与环比） */
export function computeSiteMetrics(site, recs, all, start, end, rangeLabel = '当前区间') {
  const t = aggregate(recs);
  const m = deriveMetrics(t, site, rangeLabel);

  // 环比：前一个等长时间窗口
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
  m.prevCost = prevCost;
  m.prevSales = prevSales;
  m.costGrowth = prevCost > 0 ? ((m.cost - prevCost) / prevCost) * 100 : null;
  m.salesGrowth = prevSales > 0 ? ((m.sales - prevSales) / prevSales) * 100 : null;
  m.hasData = recs.length > 0;
  return m;
}

/**
 * 生成诊断建议（粒度感知）
 * @param {Array} ranged 当前时间范围内的明细
 * @param {Object} [opts]
 * @param {Array}  [opts.all] 全部明细（用于环比）
 * @param {string} [opts.start] 范围起点
 * @param {string} [opts.end] 范围终点
 * @param {string} [opts.rangeLabel] 范围描述
 * @returns {{suggestions:Array, generatedAt:number, dataGranularity:string}}
 */
export function diagnose(ranged, { all, start, end, rangeLabel = '当前区间' } = {}) {
  const suggestions = [];
  const granularities = new Set();

  for (const site of ['AE', 'SA']) {
    const recs = ranged.filter((r) => r.site === site);
    if (!recs.length) continue;
    const hasKeyword = recs.some((r) => r.keyword);
    const hasCampaign = recs.some((r) => r.campaign || r.asin);

    if (hasKeyword) {
      granularities.add('keyword');
      const byCamp = groupBy(recs, (r) => r.campaign || '未命名活动');
      for (const [, campRecs] of byCamp) {
        const campM = buildObjectMetric(campRecs, site, rangeLabel);
        const byKw = groupBy(campRecs, (r) => `${r.keyword}||${r.adType || ''}`);
        for (const [, kwRecs] of byKw) {
          if (!kwRecs[0].keyword) continue;
          const km = buildObjectMetric(kwRecs, site, rangeLabel);
          km.share = campM.cost > 0 ? (km.cost / campM.cost) * 100 : 0;
          km.campM = campM;
          suggestions.push(
            ...objectSuggestions(site, km, { rangeLabel, granularityNote: null, objectType: 'keyword' })
          );
        }
      }
    } else if (hasCampaign) {
      granularities.add('campaign');
      const byCamp = groupBy(recs, (r) => r.campaign || r.asin || '未命名活动');
      for (const [, campRecs] of byCamp) {
        const cm = buildObjectMetric(campRecs, site, rangeLabel);
        suggestions.push(
          ...objectSuggestions(site, cm, { rangeLabel, granularityNote: NOTE_CAMPAIGN, objectType: 'campaign' })
        );
      }
    } else {
      granularities.add('site');
      const m = computeSiteMetrics(site, recs, all, start, end, rangeLabel);
      suggestions.push(...siteSuggestions(site, m));
    }
  }

  // 排序：优先级 高 > 中 > 低，同优先级按站点
  suggestions.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.site.localeCompare(b.site)
  );
  // 去重（同一对象+规则只保留一条）
  const seen = new Set();
  const uniq = [];
  for (const s of suggestions) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    uniq.push(s);
  }

  const gset = [...granularities];
  const dataGranularity = gset.length === 0 ? 'none' : gset.length === 1 ? gset[0] : 'mixed';
  return { suggestions: uniq, generatedAt: Date.now(), dataGranularity };
}

/** 将一条建议拼成完整文案（用于反馈存储 / 详情展示） */
export function suggestionToText(sug) {
  const parts = [
    sug.objectLabel,
    '问题：' + sug.problem,
    '数据支撑：' + sug.dataSupport.join('；'),
    '影响：' + sug.impact,
    '操作：' + sug.points.join('；'),
    '预期：' + sug.expected,
  ];
  if (sug.granularityNote) parts.push('提示：' + sug.granularityNote);
  return parts.join('\n');
}
