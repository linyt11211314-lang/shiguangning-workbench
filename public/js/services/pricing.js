/**
 * 亚马逊利润测算服务
 * 按亚马逊利润计算规则：售价 = (总成本 + FBA费 + 头程) / (1 - 佣金率 - 广告费率 - VAT - 仓储 - 退货 - 目标利润率)
 * 利润 = 售价 - 佣金 - 广告费 - VAT - 仓储 - 退货 - FBA费 - 头程 - 采购成本
 * FBA 配送费由用户手动填写（不内置费率表）
 */

import { AMAZON_SITES } from '../config.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 计费重量（kg）：体积重 与 实重 取较大值
 * 体积重(kg) = 长×宽×高(cm³) ÷ 除数（默认 6000，可自定义 5000 等）
 * @returns { actual, vol, chargeable } 实重 kg / 体积重 kg / 计费重量 kg
 */
export function calcChargeableWeight({ lengthCm = 0, widthCm = 0, heightCm = 0, weightG = 0, volWeightDivisor = 6000 } = {}) {
  const actual = Number(weightG) / 1000 || 0; // 实重 kg（内部 weightG 存 g）
  const d = Number(volWeightDivisor) > 0 ? Number(volWeightDivisor) : 6000;
  const L = Number(lengthCm) || 0;
  const W = Number(widthCm) || 0;
  const H = Number(heightCm) || 0;
  const vol = round2((L * W * H) / d); // 体积重 kg
  return { actual, vol, chargeable: round2(Math.max(actual, vol)) };
}

/**
 * 计算推荐报价（纳入 VAT + 月度仓储 + 退货损耗三项附加费率）
 * @param {object} input
 *  cost            采购成本（CNY）
 *  exchangeRate    汇率（CNY→站点货币），默认 7.2
 *  targetProfitRate 目标利润率（0-1），默认 0.3
 *  adRate          广告费率（0-1），默认 0.01
 *  referralRate    类目佣金率（0-1），默认 0.15
 *  avtRate         VAT 税率（0-1），默认 0.05
 *  storageRate     仓储费率（0-1），默认 0.01
 *  returnRate      退货损耗率（0-1），默认 0.08
 *  fbaFee          FBA 配送费（站点货币）
 *  shippingPerUnit 头程运费/件（站点货币），默认 0
 *  symbol          站点货币符号（用于展示）
 */
export function calculateQuote(input = {}) {
  const cost = Number(input.cost) || 0;
  const exchangeRate = Number(input.exchangeRate) || 7.2;
  const targetProfitRate = Number(input.targetProfitRate) || 0.3;
  const adRate = Number(input.adRate) || 0.01;
  const referralRate = Number(input.referralRate) || 0.15;
  const avtRate = Number(input.avtRate) || 0;
  const storageRate = Number(input.storageRate) || 0;
  const returnRate = Number(input.returnRate) || 0;
  const fbaFee = Number(input.fbaFee) || 0;
  const shippingPerUnit = Number(input.shippingPerUnit) || 0;
  const symbol = input.symbol || '$';

  if (cost <= 0) return { error: '请填写采购成本' };
  const denom = 1 - referralRate - adRate - avtRate - storageRate - returnRate - targetProfitRate;
  if (denom <= 0.05) {
    return { error: '目标利润率 + 佣金率 + 广告费 + VAT + 仓储 + 退货率合计需低于 95%' };
  }

  // exchangeRate 表示 USD/CNY 汇率（如 7.2 = 1 USD = 7.2 CNY），所以 CNY 折算外币用除法
  const costUsd = round2(cost / exchangeRate);
  const price = round2((costUsd + shippingPerUnit + fbaFee) / denom);
  const referral = round2(price * referralRate);
  const ad = round2(price * adRate);
  const avt = round2(price * avtRate);
  const storage = round2(price * storageRate);
  const returnCost = round2(price * returnRate);
  const profit = round2(price - referral - ad - avt - storage - returnCost - fbaFee - shippingPerUnit - costUsd);
  const margin = price > 0 ? profit / price : 0;

  return {
    price,
    profit,
    margin,
    symbol,
    breakdown: {
      costUsd,
      fbaFee,
      shippingPerUnit,
      referral,
      ad,
      avt,
      storage,
      return: returnCost,
      targetProfitRate,
      // 保留费率以便 apply99 基于 .99 展示价真实重算利润/利润率
      rateReferral: referralRate,
      rateAd: adRate,
      rateAvt: avtRate,
      rateStorage: storageRate,
      rateReturn: returnRate,
    },
  };
}

/**
 * 将报价转换为 .99 结尾的展示价。
 * 设计：
 *   - 展示价 d = floor(理论价 p) + 0.99（向上收尾到最近的 .99）
 *   - 由于利润率 = 1 - 五项费率 - 固定成本/d，d 越大利润率越高
 *     → floor+0.99 后利润率只会微升、不会跌破目标档位（无需 while 循环）
 *   - displayMargin = 基于 d 真实重算的利润率（如实告知，不再伪装成 target）
 *   - displayProfit = 基于 d 真实重算的利润（用 breakdown 存的实际费率重新计算各项费用）
 * @param {{price:number, breakdown:object}} quote calculateQuote 的返回
 * @returns {{displayPrice:number, displayProfit:number, displayMargin:number}|null}
 */
export function apply99(quote) {
  if (!quote || quote.error || !isFinite(quote.price)) return null;
  const b = quote.breakdown || {};
  const costUsd = Number(b.costUsd) || 0;
  const fbaFee = Number(b.fbaFee) || 0;
  const shippingPerUnit = Number(b.shippingPerUnit) || 0;
  const rateReferral = Number(b.rateReferral) || 0;
  const rateAd = Number(b.rateAd) || 0;
  const rateAvt = Number(b.rateAvt) || 0;
  const rateStorage = Number(b.rateStorage) || 0;
  const rateReturn = Number(b.rateReturn) || 0;

  // .99 结尾展示价：floor(p)+0.99
  const d = round2(Math.floor(quote.price) + 0.99);
  // 基于 d 用真实费率重算各项费用与利润
  const referral = round2(d * rateReferral);
  const ad = round2(d * rateAd);
  const avt = round2(d * rateAvt);
  const storage = round2(d * rateStorage);
  const ret = round2(d * rateReturn);
  const profit = round2(d - referral - ad - avt - storage - ret - fbaFee - shippingPerUnit - costUsd);
  const margin = d > 0 ? profit / d : 0;
  return { displayPrice: d, displayProfit: profit, displayMargin: margin };
}

/** 默认测算参数（百分比字段与 UI 一致，用整数，如 30 表示 30%） */
export const DEFAULT_QUOTE = {
  lengthCm: '', widthCm: '', heightCm: '', weightG: '',
  cost: '', exchangeRate: 7.2,
  targetProfitRate: 30, adRate: 1, referralRate: 15,
  avtRate: 5, storageRate: 1, returnRate: 8,
  fbaFee: '', shippingPerUnit: 0, seaFreightRate: '', volWeightDivisor: 6000,
};

/**
 * 快速重算（列表视图用）：传入 quote 输入参数，返回 { price, profit, margin, symbol, breakdown }
 * 缺关键参数（cost）返回 null
 */
export function quickQuote(q, productSite) {
  if (!q || q.cost == null || q.cost === '' || Number(q.cost) <= 0) return null;
  const siteInfo = AMAZON_SITES.find((s) => s.code === (productSite || q.site || 'US')) || AMAZON_SITES[0];
  const r = calculateQuote({
    cost: q.cost,
    exchangeRate: Number(q.exchangeRate) || siteInfo.rate,
    targetProfitRate: Number(q.targetProfitRate || 30) / 100,
    adRate: Number(q.adRate || 1) / 100,
    referralRate: Number(q.referralRate || 15) / 100,
    avtRate: Number(q.avtRate == null || q.avtRate === '' ? 5 : q.avtRate) / 100,
    storageRate: Number(q.storageRate == null || q.storageRate === '' ? 1 : q.storageRate) / 100,
    returnRate: Number(q.returnRate == null || q.returnRate === '' ? 8 : q.returnRate) / 100,
    fbaFee: q.fbaFee === '' || q.fbaFee == null ? 0 : Number(q.fbaFee),
    shippingPerUnit: Number(q.shippingPerUnit) || 0,
    symbol: siteInfo.symbol,
  });
  if (r.error) return null;
  return r;
}
