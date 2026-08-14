/**
 * 广告诊断 · 新手学堂知识库
 * - 8 个核心术语的悬浮解释 + 知识卡片（含用户自己的数据对比）
 * - 行内术语高亮（highlightTerms）
 * - 规则 → 术语 映射（每条诊断建议挂一个主概念，供「❓ 我不懂这个词」）
 *
 * 纯数据 + 纯函数，不依赖 DOM / localStorage。
 */

export const TERM_ORDER = ['acos', 'roas', 'ctr', 'cvr', 'broad', 'phrase', 'exact', 'adtype'];

/** 健康度文案（用于知识卡「你的数据」对比） */
export function acosHealthText(acos) {
  if (acos == null) return '无数据';
  if (acos <= 25) return '🟢 健康';
  if (acos <= 35) return '🟡 预警';
  return '🔴 偏高';
}
export function roasHealthText(roas) {
  if (roas == null) return '无数据';
  if (roas >= 3) return '🟢 优秀';
  if (roas >= 2) return '🟡 一般';
  return '🔴 偏低';
}
export function ctrHealthText(ctr) {
  if (ctr == null) return '无数据';
  if (ctr >= 1) return '🟢 健康';
  if (ctr >= 0.5) return '🟡 偏低';
  return '🔴 偏低';
}
export function cvrHealthText(cvr) {
  if (cvr == null) return '无数据';
  if (cvr >= 10) return '🟢 健康';
  if (cvr >= 5) return '🟡 偏低';
  return '🔴 偏低';
}

export const GLOSSARY = {
  acos: {
    name: 'ACOS',
    short:
      '广告花费 ÷ 广告销售额 × 100%。数值越高，广告越"烧钱"。目标通常控制在 30% 以内——ACOS 越低，你留的利润越多。',
    intro: 'ACOS 全称 Advertising Cost of Sales（广告销售成本占比），表示你每赚 100 元广告销售额，花了多少广告费。',
    formula: 'ACOS = 广告花费 ÷ 广告带来的销售额 × 100%',
    example: { cost: 50, sales: 200, result: '25%' },
    levels: [
      { dot: '🟢', text: 'ACOS ≤ 25% → 健康，广告在赚钱' },
      { dot: '🟡', text: 'ACOS 25%–35% → 预警，利润空间在缩小' },
      { dot: '🔴', text: 'ACOS > 35% → 偏高，广告在亏钱' },
    ],
    your: (d) =>
      d.acos != null
        ? `你的数据：当前 ACOS ${d.acos.toFixed(1)}% → ${acosHealthText(d.acos)}`
        : '你的数据：当前区间暂无广告销售额，无法计算 ACOS',
    target: '建议目标：ACOS 控制在 30% 以内',
  },
  roas: {
    name: 'ROAS',
    short:
      '广告销售额 ÷ 广告花费。表示每花 1 元广告费，赚回了多少元。ROAS 越高越划算，目标通常 > 2（即每花 1 元至少赚 2 元）。',
    intro: 'ROAS 全称 Return on Ad Spend（广告支出回报率），衡量广告费的"投入产出比"。',
    formula: 'ROAS = 广告销售额 ÷ 广告花费',
    example: { cost: 50, sales: 200, result: '4.0' },
    levels: [
      { dot: '🟢', text: 'ROAS ≥ 3 → 优秀，广告效率高' },
      { dot: '🟡', text: 'ROAS 2–3 → 一般，勉强覆盖成本' },
      { dot: '🔴', text: 'ROAS < 2 → 偏低，广告在亏钱' },
    ],
    your: (d) =>
      d.roas != null
        ? `你的数据：当前 ROAS ${d.roas.toFixed(1)} → ${roasHealthText(d.roas)}`
        : '你的数据：当前区间暂无广告花费，无法计算 ROAS',
    target: '建议目标：ROAS 保持在 2 以上',
  },
  ctr: {
    name: 'CTR',
    short:
      '点击次数 ÷ 曝光次数 × 100%。表示 100 人看到广告，有几人点击。通常 < 0.5% 说明主图/标题不够吸引人，需要优化。',
    intro: 'CTR 全称 Click-Through Rate（点击率），反映广告创意对买家的吸引力。',
    formula: 'CTR = 点击次数 ÷ 曝光次数 × 100%',
    example: { imp: 1000, clk: 5, result: '0.50%' },
    levels: [
      { dot: '🟢', text: 'CTR ≥ 1% → 健康，创意吸引人' },
      { dot: '🟡', text: 'CTR 0.5%–1% → 偏低，可优化主图标题' },
      { dot: '🔴', text: 'CTR < 0.5% → 明显偏低，需重点优化' },
    ],
    your: (d) =>
      d.ctr != null
        ? `你的数据：当前 CTR ${d.ctr.toFixed(2)}% → ${ctrHealthText(d.ctr)}`
        : '你的数据：当前区间暂无曝光数据，无法计算 CTR',
    target: '建议目标：CTR 提升到 0.8% 以上',
  },
  cvr: {
    name: 'CVR',
    short:
      '订单数 ÷ 点击次数 × 100%。表示 100 人点进广告，有几人下单。通常 < 10% 说明详情页不够打动买家，需要优化。',
    intro: 'CVR 全称 Conversion Rate（转化率），反映点击进店后的"成交能力"。',
    formula: 'CVR = 订单数 ÷ 点击次数 × 100%',
    example: { clk: 100, ord: 8, result: '8.0%' },
    levels: [
      { dot: '🟢', text: 'CVR ≥ 10% → 健康，详情页转化好' },
      { dot: '🟡', text: 'CVR 5%–10% → 偏低，可优化详情页' },
      { dot: '🔴', text: 'CVR < 5% → 明显偏低，需重点优化' },
    ],
    your: (d) =>
      d.cvr != null
        ? `你的数据：当前 CVR ${d.cvr.toFixed(1)}% → ${cvrHealthText(d.cvr)}`
        : '你的数据：当前区间暂无点击数据，无法计算 CVR',
    target: '建议目标：CVR 提升到 10% 左右',
  },
  broad: {
    name: '广泛匹配',
    short:
      '广告系统会匹配所有相关搜索词，流量大但精准度低，容易浪费预算。适合用来"测款"、发现新词。',
    intro: '广泛匹配（Broad Match）是最宽松的匹配方式：买家搜任何与你关键词相关的词，广告都可能展示。',
    formula: '匹配范围：最广（相关搜索词均可能触发）',
    example: { kw: 'wireless earbuds', trig: '"蓝牙耳机" "earphone" "蓝牙耳机 无线" 等', result: '流量大、精准度低' },
    levels: [
      { dot: '🌐', text: '流量：大' },
      { dot: '🎯', text: '精准度：低' },
      { dot: '💡', text: '适合：测款、挖掘新词' },
    ],
    your: () => '你的数据：可在领星「匹配类型」列查看哪些词是广泛匹配',
    target: '优化建议：把跑不出单的广泛匹配词改为词组/精准匹配',
  },
  phrase: {
    name: '词组匹配',
    short:
      '广告匹配包含这个词组的搜索，流量中等、精准度中等。适合已有一定数据、想兼顾流量与精准度的关键词。',
    intro: '词组匹配（Phrase Match）：买家搜索词必须包含你的关键词词组（顺序可含前后词），广告才展示。',
    formula: '匹配范围：中等（含该词组的搜索触发）',
    example: { kw: 'wireless earbuds', trig: '"wireless earbuds case" "red wireless earbuds"', result: '流量中、精准度中' },
    levels: [
      { dot: '🌐', text: '流量：中' },
      { dot: '🎯', text: '精准度：中' },
      { dot: '💡', text: '适合：有一定数据的关键词' },
    ],
    your: () => '你的数据：可在领星「匹配类型」列查看哪些词是词组匹配',
    target: '优化建议：表现好的广泛词可收紧为词组匹配',
  },
  exact: {
    name: '精准匹配',
    short:
      '广告只匹配与关键词完全一致的搜索，流量小但精准度最高。适合转化好、想稳定收割的词。',
    intro: '精准匹配（Exact Match）：买家搜索词与你的关键词高度一致时，广告才展示。',
    formula: '匹配范围：最窄（仅高度一致搜索触发）',
    example: { kw: 'wireless earbuds', trig: '"wireless earbuds"', result: '流量小、精准度高' },
    levels: [
      { dot: '🌐', text: '流量：小' },
      { dot: '🎯', text: '精准度：高' },
      { dot: '💡', text: '适合：转化好的词稳定收割' },
    ],
    your: () => '你的数据：可在领星「匹配类型」列查看哪些词是精准匹配',
    target: '优化建议：把高转化词设为精准匹配并适当加价',
  },
  adtype: {
    name: 'SP / SB / SD',
    short:
      '三种亚马逊广告类型：SP 商品推广（按关键词/商品推单品）、SB 品牌推广（推品牌/旗舰店）、SD 展示型广告（站内外再营销）。新手先从 SP 入手。',
    intro: 'SP（Sponsored Products）商品推广最常见，按搜索词展示在搜索结果和商品页；SB（Sponsored Brands）品牌推广展示品牌 Logo+多商品；SD（Sponsored Display）展示型广告用于站内外受众再营销。',
    formula: '类型：SP / SB / SD',
    example: { kw: 'SP', trig: '商品推广·单品', result: '新手首选' },
    levels: [
      { dot: '🛒', text: 'SP：商品推广，按词推单品（最常用）' },
      { dot: '🏷️', text: 'SB：品牌推广，推品牌/旗舰店' },
      { dot: '🔁', text: 'SD：展示型，站内外再营销' },
    ],
    your: () => '你的数据：可在明细「广告类型」列查看当前投放的是哪种',
    target: '新手建议：先从 SP 商品推广开始优化',
  },
};

/** 规则 → 主术语（供「❓ 我不懂这个词」按钮定向打开知识卡） */
export const RULE_TERM = {
  high_spend_no_conv: 'acos',
  cost_no_sales: 'acos',
  cost_no_orders: 'acos',
  acos_high: 'acos',
  acos_good: 'acos',
  acos_mid: 'acos',
  ad_ratio_low: 'acos',
  cost_up_sales_flat: 'acos',
  ctr_low: 'ctr',
  conv_low: 'cvr',
  bid_low: 'acos',
  imp_low: 'acos',
};

export function termForRule(ruleKey) {
  return RULE_TERM[ruleKey] || 'acos';
}

/**
 * 生成知识卡片 HTML（含用户数据对比）
 * @param {string} termId
 * @param {Object} data { acos, roas, ctr, cvr, siteLabel }
 */
export function buildKnowledgeCard(termId, data = {}) {
  const t = GLOSSARY[termId];
  if (!t) return '';
  const levels = t.levels
    .map((l) => `<div class="kc-level">${l.dot} ${escLine(l.text)}</div>`)
    .join('');
  const example = t.example;
  let exampleHtml = '';
  if (termId === 'acos' || termId === 'roas') {
    exampleHtml = `举例：你花了 ${example.cost} 元广告费，卖出了 ${example.sales} 元的产品<br>${t.formula.split('=')[0].trim()} = ${example.cost} ÷ ${example.sales} × 100% = <b>${example.result}</b>`;
  } else if (termId === 'ctr' || termId === 'cvr') {
    const base = termId === 'ctr' ? `曝光 ${example.imp} 次、点击 ${example.clk} 次` : `点击 ${example.clk} 次、订单 ${example.ord} 次`;
    exampleHtml = `举例：${base}<br>${t.formula.split('=')[0].trim()} = <b>${example.result}</b>`;
  } else if (termId === 'broad' || termId === 'phrase' || termId === 'exact') {
    exampleHtml = `举例：关键词「${example.kw}」会触发搜索词如：${escLine(example.trig)}<br>结果：${escLine(example.result)}`;
  } else if (termId === 'adtype') {
    exampleHtml = `举例：${escLine(example.trig)} → ${escLine(example.result)}`;
  }
  return `
    <div class="kc">
      <div class="kc-title">📖 广告小课堂：什么是 ${escLine(t.name)}？</div>
      <div class="kc-intro">${escLine(t.intro)}</div>
      <div class="kc-formula"><b>公式：</b>${escLine(t.formula)}</div>
      <div class="kc-example">${exampleHtml}</div>
      <div class="kc-levels">${levels}</div>
      <div class="kc-your ${termId === 'acos' && data.acos != null && data.acos > 35 ? 'kc-bad' : termId === 'acos' && data.acos != null && data.acos <= 25 ? 'kc-good' : ''}">${escLine(t.your(data))}</div>
      <div class="kc-target">${escLine(t.target)}</div>
    </div>`;
}

/** 行内术语高亮：把 ACOS/ROAS/CTR/CVR/匹配类型 包成可悬浮解释的 span */
function escLine(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const TERM_HL = [
  ['ACOS', 'acos'],
  ['ROAS', 'roas'],
  ['CTR', 'ctr'],
  ['CVR', 'cvr'],
  ['广泛匹配', 'broad'],
  ['词组匹配', 'phrase'],
  ['精准匹配', 'exact'],
];
export function highlightTerms(text) {
  let html = escLine(text);
  for (const [kw, id] of TERM_HL) {
    if (html.includes(kw)) {
      html = html.split(kw).join(`<span class="gloss-term" data-term="${id}" tabindex="0" role="button">${kw}</span>`);
    }
  }
  return html;
}
