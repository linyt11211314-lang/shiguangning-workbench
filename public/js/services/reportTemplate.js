/**
 * 数据分析 · 报表模板识别与校验
 * 依赖全局 XLSX（/vendor/xlsx.full.min.js）
 *
 * 模板固化的 6 个 Sheet（顺序即报告顺序）：
 *   ① 领星数据源            原始数据落地区（唯一需要程序写入的 Sheet）
 *   ② 产品表现              A/B/C 列为人工维护主数据，D~P 为 VLOOKUP 公式
 *   ③ 概况                  公式汇总卡 + 图表
 *   ④ 案例分析              LARGE/SMALL 取 Top5
 *   ⑤ 各维度关系表          4 个原生数据透视表（缓存源 = 产品表现）
 *   ⑥ 全店铺全SKU类目汇总   SUMIFS 类目汇总
 */

/** 数据落地 Sheet 名 */
export const DATA_SHEET = '领星数据源';

/** 模板必须包含的 6 个 Sheet（按报告顺序） */
export const REQUIRED_SHEETS = [
  '领星数据源',
  '产品表现',
  '概况',
  '案例分析',
  '各维度关系表',
  '全店铺全SKU类目汇总',
];

/** 每个 Sheet 的用途说明（UI 展示用） */
export const SHEET_NOTES = {
  领星数据源: '原始数据落地区（上传后自动覆盖）',
  产品表现: 'SKU 主数据 + VLOOKUP 公式，自动刷新',
  概况: '月度概况汇总卡与图表',
  案例分析: 'Top5 案例（增长 / 下滑）',
  各维度关系表: '4 个数据透视表交叉分析',
  全店铺全SKU类目汇总: '全店铺类目 SUMIFS 汇总',
};

/** 允许的模板文件后缀 */
export const TEMPLATE_ACCEPT = '.xlsx';

/** 模板体积上限（MB） */
export const MAX_TEMPLATE_MB = 40;

/** 校验 XLSX 依赖是否就绪 */
export function ensureXLSX() {
  if (typeof XLSX === 'undefined' || !XLSX || !XLSX.read) {
    throw new Error('Excel 解析组件未加载，请刷新页面后重试');
  }
  return XLSX;
}

/**
 * 解析模板文件，取出 Sheet 列表与「领星数据源」表头
 * 只读第一行（sheetRows: 1），10MB 模板也能秒级完成
 * @param {File|Blob} file
 * @returns {Promise<{ name, size, sheetNames, headers, missing, extra, ok, dataRowCount }>}
 */
export async function inspectTemplate(file) {
  ensureXLSX();
  const name = file.name || '模板.xlsx';
  if (!/\.xlsx$/i.test(name)) {
    throw new Error('模板仅支持 .xlsx 格式（需保留公式、图表与数据透视表）');
  }
  if (file.size > MAX_TEMPLATE_MB * 1024 * 1024) {
    throw new Error(`模板体积超过 ${MAX_TEMPLATE_MB}MB，无法保存到本地`);
  }

  const buf = await file.arrayBuffer();
  let wb;
  try {
    wb = XLSX.read(new Uint8Array(buf), { type: 'array', sheetRows: 1, bookDeps: false });
  } catch (_) {
    throw new Error('模板文件已损坏或不是有效的 .xlsx 文件');
  }

  const sheetNames = wb.SheetNames.slice();
  const missing = REQUIRED_SHEETS.filter((s) => !sheetNames.includes(s));
  const extra = sheetNames.filter((s) => !REQUIRED_SHEETS.includes(s));

  let headers = [];
  if (sheetNames.includes(DATA_SHEET)) {
    const ws = wb.Sheets[DATA_SHEET];
    const firstRow = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })[0] || [];
    headers = firstRow.map((v) => String(v ?? '').trim());
    // 去掉尾部空列
    while (headers.length && headers[headers.length - 1] === '') headers.pop();
  }

  return {
    name,
    size: file.size,
    data: buf, // 已读到的字节，直接复用，避免二次读盘
    sheetNames,
    headers,
    missing,
    extra,
    ok: missing.length === 0 && headers.length > 0,
  };
}

/**
 * 生成缺失 Sheet 的友好提示文案
 * @param {string[]} missing
 */
export function missingSheetMessage(missing) {
  if (!missing || !missing.length) return '';
  return `模板缺少必需的 Sheet：${missing.join('、')}。请使用完整的《AE 品牌产品分析》模板（应包含 ${REQUIRED_SHEETS.length} 个 Sheet）。`;
}

/** 表头缺失提示 */
export function missingHeaderMessage() {
  return `模板「${DATA_SHEET}」第 1 行没有表头，无法识别数据列。请检查模板首行是否为字段名。`;
}
