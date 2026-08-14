/**
 * 拾光柠工作台 · 全局配置
 */
export const APP_NAME = '拾光柠工作台';
export const APP_VERSION = 'v1.0';

/** 选品库三大分类（产品归属列表） */
export const CATEGORIES = [
  { id: 'niuma', label: '牛马人' },
  { id: 'zhaowu', label: '昭梧' },
  { id: 'fengyang', label: '沣洋' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export function categoryLabel(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.label : id;
}

/** 三档推荐报价（目标利润率），用于替换原单档推荐价显示 */
export const PRICE_TIERS = [
  { id: 'conservative', label: '保守价', margin: 0.01, color: 'green' },
  { id: 'balanced', label: '均衡价', margin: 0.15, color: 'amber' },
  { id: 'aggressive', label: '激进价', margin: 0.30, color: 'red' },
];
export const PRICE_TIER_IDS = PRICE_TIERS.map((t) => t.id);
export function priceTierById(id) {
  return PRICE_TIERS.find((t) => t.id === id) || PRICE_TIERS[1];
}

/** 产品图片限制 */
export const MAX_IMAGES = 20;
export const MAX_IMAGE_MB = 5;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Amazon 目标站点（含本地货币与人民币参考汇率） */
export const AMAZON_SITES = [
  { code: 'US', label: '美国站', flag: '🇺🇸', domain: 'amazon.com', currency: 'USD', symbol: '$', rate: 7.2 },
  { code: 'UK', label: '英国站', flag: '🇬🇧', domain: 'amazon.co.uk', currency: 'GBP', symbol: '£', rate: 9.1 },
  { code: 'AE', label: '中东站（阿联酋）', flag: '🇦🇪', domain: 'amazon.ae', currency: 'AED', symbol: 'AED ', rate: 1.96 },
  { code: 'DE', label: '德国站', flag: '🇩🇪', domain: 'amazon.de', currency: 'EUR', symbol: '€', rate: 7.8 },
  { code: 'FR', label: '法国站', flag: '🇫🇷', domain: 'amazon.fr', currency: 'EUR', symbol: '€', rate: 7.8 },
  { code: 'IT', label: '意大利站', flag: '🇮🇹', domain: 'amazon.it', currency: 'EUR', symbol: '€', rate: 7.8 },
  { code: 'ES', label: '西班牙站', flag: '🇪🇸', domain: 'amazon.es', currency: 'EUR', symbol: '€', rate: 7.8 },
  { code: 'JP', label: '日本站', flag: '🇯🇵', domain: 'amazon.co.jp', currency: 'JPY', symbol: '¥', rate: 0.048 },
  { code: 'CA', label: '加拿大站', flag: '🇨🇦', domain: 'amazon.ca', currency: 'CAD', symbol: 'C$', rate: 5.3 },
  { code: 'AU', label: '澳大利亚站', flag: '🇦🇺', domain: 'amazon.com.au', currency: 'AUD', symbol: 'A$', rate: 4.7 },
  { code: 'MX', label: '墨西哥站', flag: '🇲🇽', domain: 'amazon.com.mx', currency: 'MXN', symbol: 'MX$', rate: 0.42 },
  { code: 'SG', label: '新加坡站', flag: '🇸🇬', domain: 'amazon.sg', currency: 'SGD', symbol: 'S$', rate: 5.35 },
];

/**
 * 各站点附加成本费率（%）默认值（VAT / 月度仓储 / 退货损耗）
 */
export const PER_SITE_RATES = {
  US: { avt: 5.0, storage: 1.0, return: 8.0 },
  UK: { avt: 5.0, storage: 1.0, return: 7.0 },
  DE: { avt: 5.0, storage: 1.2, return: 9.0 },
  FR: { avt: 5.0, storage: 1.2, return: 9.0 },
  IT: { avt: 5.0, storage: 1.2, return: 9.0 },
  ES: { avt: 5.0, storage: 1.2, return: 9.0 },
  JP: { avt: 5.0, storage: 1.0, return: 5.0 },
  CA: { avt: 5.0, storage: 1.0, return: 7.0 },
  AU: { avt: 5.0, storage: 1.0, return: 7.0 },
  MX: { avt: 5.0, storage: 1.0, return: 6.0 },
  SG: { avt: 5.0, storage: 1.0, return: 6.0 },
  AE: { avt: 5.0, storage: 1.0, return: 7.0 },
};

/**
 * 常见产品类目建议
 */
export const CATEGORY_SUGGESTIONS = [
  'Home & Kitchen 家居厨房',
  'Sports & Outdoors 运动户外',
  'Beauty & Personal Care 美妆个护',
  'Electronics 电子产品',
  'Home Improvement 家居装修',
  'Garden & Outdoor 花园庭院',
  'Pet Supplies 宠物用品',
  'Toys & Games 玩具',
  'Baby Products 母婴用品',
  'Office Products 办公用品',
  'Automotive 汽车配件',
  'Fashion 服饰',
  'Tools & Home Improvement 工具',
  'Health & Household 健康家庭',
  '其他（自定义）',
];

/** DeepSeek 模型 */
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-chat', label: 'DeepSeek Chat（V3 · 通用）' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner（R1 · 深度推理）' },
];

/** 本地存储键名 */
export const STORAGE_KEYS = {
  SETTINGS: 'sgn.settings',
  PRODUCTS: 'sgn.products',
  PROJECTS: 'sgn.listingProjects',
  STATS: 'sgn.stats',
  SCHEDULE: 'sgn.schedules',
  ADS: 'sgn.ads',
  FEEDBACK: 'sgn.ads.feedback',
  ADS_LEARN: 'sgn.ads.learn',
  ADS_PANELS: 'sgn.ads.panels',
};

/** 生成阶段（进度展示用） */
export const GEN_STAGES = [
  { key: 'title', label: '生成 Amazon 标题' },
  { key: 'bullets', label: '生成五点描述' },
  { key: 'description', label: '生成产品描述' },
  { key: 'searchTerms', label: '生成后台关键词' },
  { key: 'imageSuggestions', label: '生成图片文案建议' },
  { key: 'competitor', label: '竞品分析' },
];

/** 单个分区重新生成的 key 列表 */
export const SECTION_KEYS = [
  'title', 'bullets', 'description', 'searchTerms', 'imageSuggestions',
];
