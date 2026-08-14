/**
 * 数据分析页
 * 把《AE 品牌产品分析》6-Sheet Excel 模板固化为系统报表模板：
 *   上传领星原始数据 → 自动填充「领星数据源」→ 公式/透视表打开即刷新 → 一键导出保真报表
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import {
  REQUIRED_SHEETS,
  SHEET_NOTES,
  DATA_SHEET,
  TEMPLATE_ACCEPT,
  inspectTemplate,
  missingSheetMessage,
  missingHeaderMessage,
} from '../services/reportTemplate.js';
import {
  ACCEPT,
  SLOW_ROWS,
  SKU_HEADER,
  readSourceFile,
  autoMap,
  buildRows,
  buildOverview,
  noSkuMessage,
} from '../services/dataImport.js';
import { generateReport, downloadBlob, defaultReportName, colLetter, toXlsxBlob } from '../services/reportGen.js';
import {
  isSupported,
  saveTemplate,
  getTemplate,
  getTemplateMeta,
  clearTemplate,
  addHistory,
  listHistory,
  getHistoryData,
  deleteHistory,
  HISTORY_LIMIT,
} from '../store/reportStore.js';

/* ===================== 模块级状态（跨重渲染保持） ===================== */
const state = {
  tpl: null, // 模板元信息
  tplLoading: true,
  history: [],
  source: null, // { fileName, sheetName, headers, rows, rowCount }
  mapping: null, // { map, matched, unmatched, skuCol }
  objRows: null,
  overview: null,
  busy: false,
  progress: 0,
  status: '就绪',
  statusType: 'idle', // idle | work | ok | err
};

let rootEl = null;
let ctxRef = null;

/* ===================== 工具 ===================== */
function fmtInt(v) {
  return (Number(v) || 0).toLocaleString('zh-CN');
}
function fmtMoney(v) {
  return (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMB(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function setStatus(text, type = 'idle', progress = null) {
  state.status = text;
  state.statusType = type;
  if (progress != null) state.progress = progress;
  paintStatus();
}

/** 只重绘状态栏，避免整页闪烁 */
function paintStatus() {
  if (!rootEl) return;
  const bar = rootEl.querySelector('[data-status-bar]');
  if (!bar) return;
  const cls = { idle: '', work: 'work', ok: 'ok', err: 'err' }[state.statusType] || '';
  bar.className = `an-statusbar ${cls}`;
  bar.innerHTML = `
    <span class="an-status-dot"></span>
    <span class="an-status-text">${esc(state.status)}</span>
    ${state.busy ? `<span class="an-status-prog"><i style="width:${Math.max(2, state.progress)}%"></i></span><span class="an-status-pct">${state.progress}%</span>` : ''}
  `;
}

/* ===================== 主渲染 ===================== */
export function render(container, ctx, keepScroll = false) {
  ctxRef = ctx;
  const scrollY = keepScroll ? window.scrollY : 0;
  container.innerHTML = `<div class="an-page" data-an-root></div>`;
  rootEl = container.querySelector('[data-an-root]');
  paint();
  if (keepScroll) window.scrollTo(0, scrollY);

  // 首次进入：异步载入模板与生成记录
  if (state.tplLoading) loadFromDB();
}

async function loadFromDB() {
  if (!isSupported()) {
    state.tplLoading = false;
    setStatus('当前浏览器不支持本地数据库，无法保存模板', 'err');
    paint();
    return;
  }
  try {
    const [tpl, his] = await Promise.all([getTemplateMeta(), listHistory()]);
    state.tpl = tpl;
    state.history = his;
  } catch (e) {
    setStatus(`读取本地数据失败：${e.message}`, 'err');
  }
  state.tplLoading = false;
  paint();
}

function paint() {
  if (!rootEl) return;
  rootEl.innerHTML = `
    ${headerHTML()}
    ${templateCardHTML()}
    ${overviewCardHTML()}
    ${historyCardHTML()}
    <div class="an-statusbar" data-status-bar></div>
    <input type="file" accept="${TEMPLATE_ACCEPT}" hidden data-tpl-input>
    <input type="file" accept="${ACCEPT}" hidden data-src-input>
  `;
  paintStatus();
  bind();
}

function headerHTML() {
  return `
    <div class="an-hero">
      <div class="an-hero-text">
        <div class="an-hero-title">数据分析</div>
        <div class="an-hero-sub">上传领星导出的原始数据，一键生成与模板格式完全一致的月度品牌产品分析报表</div>
      </div>
      <div class="an-actions">
        <button class="btn btn-soft" data-act="upload" ${state.busy ? 'disabled' : ''}>${icon('upload')} 上传领星数据</button>
        <button class="btn btn-ghost" data-act="tpl" ${state.busy ? 'disabled' : ''}>${icon('file')} ${state.tpl ? '更换模板' : '加载模板'}</button>
        <button class="btn btn-primary" data-act="gen" ${canGenerate() && !state.busy ? '' : 'disabled'}>
          ${state.busy ? '<span class="btn-spin"></span>' : icon('zap')} 一键生成报告
        </button>
      </div>
    </div>`;
}

function canGenerate() {
  return !!(state.tpl && state.tpl.hasData && state.objRows && state.objRows.length);
}

/* ---------- 模板管理 ---------- */
function templateCardHTML() {
  if (state.tplLoading) {
    return `<div class="card card-pad an-card"><div class="an-loading">${icon('loader')} 正在读取本地模板…</div></div>`;
  }
  if (!state.tpl) {
    return `
      <div class="card card-pad an-card">
        <div class="section-head">
          <div>
            <div class="section-title">模板管理</div>
            <div class="section-sub">首次使用请先加载《AE 品牌产品分析》模板，之后每月只需上传数据</div>
          </div>
        </div>
        <div class="empty-state">
          <div class="empty-icon">${icon('sheet')}</div>
          <div class="empty-title">尚未加载报表模板</div>
          <div class="empty-sub">
            点击「加载模板」选择本地 .xlsx 模板文件，需包含 ${REQUIRED_SHEETS.length} 个 Sheet：<br>
            ${REQUIRED_SHEETS.map((s, i) => `${i + 1}. ${esc(s)}`).join(' ｜ ')}<br>
            模板保存在你自己的浏览器里，不会上传到任何服务器。
          </div>
          <div style="margin-top:16px"><button class="btn btn-primary" data-act="tpl">${icon('file')} 加载模板</button></div>
        </div>
      </div>`;
  }

  const t = state.tpl;
  const sheets = REQUIRED_SHEETS.map((s, i) => {
    const has = (t.sheetNames || []).includes(s);
    return `
      <div class="an-sheet ${has ? '' : 'miss'}">
        <span class="an-sheet-no">${i + 1}</span>
        <span class="an-sheet-name">${esc(s)}</span>
        <span class="an-sheet-note">${esc(SHEET_NOTES[s] || '')}</span>
        <span class="an-sheet-flag">${has ? icon('checkCircle') : icon('xCircle')}</span>
      </div>`;
  }).join('');

  return `
    <div class="card card-pad an-card">
      <div class="section-head">
        <div>
          <div class="section-title">模板管理</div>
          <div class="section-sub">模板已固化，公式 / 图表 / 数据透视表 / 产品图片 100% 保留</div>
        </div>
        <span class="topbar-spacer"></span>
        <div class="an-head-actions">
          <button class="btn btn-ghost btn-sm" data-act="tpl">${icon('refresh')} 更换模板</button>
          <button class="btn btn-danger-soft btn-sm" data-act="tpl-del">${icon('trash')} 删除模板</button>
        </div>
      </div>
      <div class="an-tpl-meta">
        <div class="an-meta-item"><span class="an-meta-l">模板文件</span><span class="an-meta-v">${esc(t.name)}</span></div>
        <div class="an-meta-item"><span class="an-meta-l">体积</span><span class="an-meta-v">${fmtMB(t.size)}</span></div>
        <div class="an-meta-item"><span class="an-meta-l">保存时间</span><span class="an-meta-v">${fmtTime(t.savedAt)}</span></div>
        <div class="an-meta-item"><span class="an-meta-l">数据源列数</span><span class="an-meta-v">${(t.headers || []).length} 列</span></div>
      </div>
      <div class="an-sheets">${sheets}</div>
      <div class="field-tip" style="margin-top:12px">
        每月更新只需替换「${esc(DATA_SHEET)}」的数据：产品表现的 VLOOKUP、概况汇总、案例分析 Top5、各维度关系表的
        4 个数据透视表、类目汇总，都会在 Excel 打开时自动重算刷新。
      </div>
    </div>`;
}

/* ---------- 数据概览 ---------- */
function overviewCardHTML() {
  if (state.tplLoading) return '';
  if (!state.overview) {
    return `
      <div class="card card-pad an-card">
        <div class="section-head">
          <div>
            <div class="section-title">数据概览</div>
            <div class="section-sub">上传领星导出的原始数据后，这里显示本月数据体检结果</div>
          </div>
        </div>
        <div class="empty-state">
          <div class="empty-icon">${icon('upload')}</div>
          <div class="empty-title">还没有上传数据</div>
          <div class="empty-sub">支持领星导出的 .xlsx / .xls / .csv；系统会自动识别列名并映射到模板字段。</div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" data-act="upload" ${state.tpl ? '' : 'disabled'}>${icon('upload')} 上传领星数据</button>
          </div>
          ${state.tpl ? '' : '<div class="an-hint">请先加载报表模板，系统需要模板表头来做列映射。</div>'}
        </div>
      </div>`;
  }

  const o = state.overview;
  const m = state.mapping;
  const s = state.source;
  const stats = [
    { v: fmtInt(o.rowCount), l: '有效数据行' },
    { v: fmtInt(o.skuCount), l: 'SKU 数' },
    { v: fmtInt(o.shopCount), l: '店铺数' },
    { v: fmtInt(o.totalQty), l: '总销量' },
    { v: fmtMoney(o.totalSales), l: '总销售额' },
    { v: fmtMoney(o.totalProfit), l: '总毛利润' },
    { v: o.avgRating ? o.avgRating.toFixed(2) : '—', l: '平均评分' },
    { v: fmtInt(o.catCount), l: '类目数' },
  ];

  const warn = [];
  if (o.rowCount > SLOW_ROWS) warn.push(`数据量较大（${fmtInt(o.rowCount)} 行），生成报告可能需要十几秒，请勿关闭页面。`);
  if (m && m.unmatched.length) warn.push(`有 ${m.unmatched.length} 个模板字段未在文件中找到：${m.unmatched.join('、')}，对应列将留空。`);
  if (o.negativeProfit) warn.push(`检测到 ${o.negativeProfit} 个 SKU 毛利润为负，报告「是否正利润」列会标记为「否」。`);

  return `
    <div class="card card-pad an-card">
      <div class="section-head">
        <div>
          <div class="section-title">数据概览</div>
          <div class="section-sub">${esc(s.fileName)} · 工作表「${esc(s.sheetName)}」· 原始 ${fmtInt(s.rowCount)} 行</div>
        </div>
        <span class="topbar-spacer"></span>
        <div class="an-head-actions">
          <button class="btn btn-ghost btn-sm" data-act="map">${icon('list')} 列映射（${m.matched.length}/${(state.tpl.headers || []).length}）</button>
          <button class="btn btn-ghost btn-sm" data-act="preview">${icon('eye')} 预览前 20 行</button>
          <button class="btn btn-ghost btn-sm" data-act="src-clear">${icon('x')} 清除数据</button>
        </div>
      </div>
      <div class="an-stats">
        ${stats.map((x) => `<div class="an-stat"><div class="an-stat-v">${esc(x.v)}</div><div class="an-stat-l">${esc(x.l)}</div></div>`).join('')}
      </div>
      ${o.shops.length ? `<div class="an-shops">店铺：${o.shops.map((x) => `<span class="tag tag-primary">${esc(x)}</span>`).join('')}</div>` : ''}
      ${warn.length ? `<div class="an-warns">${warn.map((w) => `<div class="an-warn">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}</div>` : ''}
    </div>`;
}

/* ---------- 生成记录 ---------- */
function historyCardHTML() {
  if (state.tplLoading) return '';
  const rows = state.history || [];
  return `
    <div class="card card-pad an-card">
      <div class="section-head">
        <div>
          <div class="section-title">生成记录</div>
          <div class="section-sub">最近 ${HISTORY_LIMIT} 份报告保存在本地浏览器，可随时重新下载</div>
        </div>
        ${rows.length ? `<span class="topbar-spacer"></span><div class="an-head-actions"><button class="btn btn-ghost btn-sm" data-act="his-clear">${icon('trash')} 清空记录</button></div>` : ''}
      </div>
      ${
        rows.length
          ? `<div class="table-scroll"><table class="data-table">
              <thead><tr><th>报告文件</th><th>数据来源</th><th class="num">数据行数</th><th class="num">体积</th><th>生成时间</th><th class="ops">操作</th></tr></thead>
              <tbody>
                ${rows
                  .map(
                    (r) => `<tr>
                      <td class="an-td-name">${icon('sheet')}<span>${esc(r.fileName)}</span></td>
                      <td>${esc(r.sourceName || '—')}</td>
                      <td class="num">${fmtInt(r.rowCount)}</td>
                      <td class="num">${fmtMB(r.size)}</td>
                      <td>${fmtTime(r.createdAt)}</td>
                      <td class="ops">
                        <button class="btn btn-soft btn-sm" data-his-dl="${r.id}">${icon('download')} 下载</button>
                        <button class="btn btn-ghost btn-sm" data-his-del="${r.id}">${icon('trash')} 删除</button>
                      </td>
                    </tr>`
                  )
                  .join('')}
              </tbody></table></div>`
          : `<div class="empty-state">
              <div class="empty-icon">${icon('clock')}</div>
              <div class="empty-title">还没有生成过报告</div>
              <div class="empty-sub">加载模板并上传数据后，点击「一键生成报告」即可自动下载完整 Excel 报表。</div>
            </div>`
      }
    </div>`;
}

/* ===================== 事件绑定 ===================== */
function bind() {
  const tplInput = rootEl.querySelector('[data-tpl-input]');
  const srcInput = rootEl.querySelector('[data-src-input]');

  rootEl.querySelectorAll('[data-act]').forEach((el) => {
    el.addEventListener('click', () => {
      const act = el.dataset.act;
      if (act === 'tpl') tplInput.click();
      else if (act === 'upload') {
        if (!state.tpl) {
          toastError('请先加载报表模板，系统需要模板表头来做列映射');
          return;
        }
        srcInput.click();
      } else if (act === 'gen') doGenerate();
      else if (act === 'tpl-del') doDeleteTemplate();
      else if (act === 'map') openMappingModal();
      else if (act === 'preview') openPreviewModal();
      else if (act === 'src-clear') {
        state.source = null;
        state.mapping = null;
        state.objRows = null;
        state.overview = null;
        setStatus('已清除本次上传数据', 'idle', 0);
        paint();
      } else if (act === 'his-clear') doClearHistory();
    });
  });

  rootEl.querySelectorAll('[data-his-dl]').forEach((el) => {
    el.addEventListener('click', () => doDownloadHistory(Number(el.dataset.hisDl)));
  });
  rootEl.querySelectorAll('[data-his-del]').forEach((el) => {
    el.addEventListener('click', () => doDeleteHistory(Number(el.dataset.hisDel)));
  });

  tplInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) doLoadTemplate(f);
  });
  srcInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) doUploadSource(f);
  });
}

/* ===================== 业务动作 ===================== */

/** 加载 / 更换模板 */
async function doLoadTemplate(file) {
  state.busy = true;
  setStatus(`正在解析模板「${file.name}」…`, 'work', 10);
  paint();
  try {
    const info = await inspectTemplate(file);
    if (info.missing.length) {
      state.busy = false;
      setStatus('模板校验未通过', 'err', 0);
      paint();
      toastError(`模板缺少 ${info.missing.length} 个必需 Sheet`);
      const mm = openModal({
        title: '模板校验未通过',
        width: 'narrow',
        body: `<div class="an-modal-text">
            <p>${esc(missingSheetMessage(info.missing))}</p>
            <p class="an-modal-sub">当前文件包含的 Sheet：${info.sheetNames.map((s) => esc(s)).join('、') || '（无）'}</p>
          </div>`,
        footer: `<button class="btn btn-primary" data-close>知道了</button>`,
      });
      mm.el.querySelector('[data-close]').onclick = mm.close;
      return;
    }
    if (!info.headers.length) {
      state.busy = false;
      setStatus('模板表头缺失', 'err', 0);
      paint();
      toastError(missingHeaderMessage());
      return;
    }

    setStatus('正在保存模板到本地数据库…', 'work', 60);
    await saveTemplate({
      data: info.data,
      name: info.name,
      size: info.size,
      sheetNames: info.sheetNames,
      headers: info.headers,
    });
    state.tpl = await getTemplateMeta();

    // 已有上传数据 → 用新模板表头重新映射
    if (state.source) remapSource();

    state.busy = false;
    setStatus(`模板已就绪：${info.sheetNames.length} 个 Sheet · ${info.headers.length} 列数据源`, 'ok', 100);
    paint();
    toastSuccess(`模板「${info.name}」已保存，下次进入自动加载`);
  } catch (err) {
    state.busy = false;
    setStatus(`模板加载失败：${err.message}`, 'err', 0);
    paint();
    toastError(err.message || '模板加载失败');
  }
}

/** 删除模板 */
function doDeleteTemplate() {
  confirmDialog({
    title: '删除报表模板',
    message: '删除后需要重新加载模板才能生成报告。已生成的历史报告不受影响。是否继续？',
    confirmText: '删除模板',
    danger: true,
    onConfirm: async () => {
      try {
        await clearTemplate();
        state.tpl = null;
        state.mapping = null;
        state.objRows = null;
        state.overview = null;
        setStatus('模板已删除', 'idle', 0);
        paint();
        toastSuccess('模板已删除');
      } catch (e) {
        toastError(`删除失败：${e.message}`);
      }
    },
  });
}

/** 上传领星数据 */
async function doUploadSource(file) {
  state.busy = true;
  setStatus(`正在解析「${file.name}」…`, 'work', 15);
  paint();
  try {
    const src = await readSourceFile(file);
    state.source = { fileName: file.name, ...src };

    const tplHeaders = state.tpl.headers || [];
    const mp = autoMap(tplHeaders, src.headers);
    state.mapping = mp;

    if (mp.skuCol < 0) {
      state.busy = false;
      setStatus('等待手动指定 SKU 列', 'err', 0);
      paint();
      toastError('未识别到 SKU 列，请手动指定');
      openSkuPicker();
      return;
    }

    finishSource();
  } catch (err) {
    state.busy = false;
    state.source = null;
    setStatus(`数据解析失败：${err.message}`, 'err', 0);
    paint();
    toastError(err.message || '数据解析失败');
  }
}

/** 映射完成后统计并刷新界面 */
function finishSource() {
  const tplHeaders = state.tpl.headers || [];
  state.objRows = buildRows(tplHeaders, state.source.rows, state.mapping.map);
  state.overview = buildOverview(state.objRows);
  state.busy = false;

  if (!state.objRows.length) {
    setStatus('数据中没有有效的 SKU 行', 'err', 0);
    paint();
    toastError(`所有行的「${SKU_HEADER}」都为空，请检查上传文件`);
    return;
  }

  setStatus(
    `数据已就绪：${fmtInt(state.objRows.length)} 行 · ${fmtInt(state.overview.skuCount)} 个 SKU · 已匹配 ${state.mapping.matched.length}/${tplHeaders.length} 列`,
    'ok',
    100
  );
  paint();
  if (state.objRows.length > SLOW_ROWS) {
    toastInfo(`数据量较大（${fmtInt(state.objRows.length)} 行），生成报告耗时会稍长，请勿关闭页面`);
  } else {
    toastSuccess(`已解析 ${fmtInt(state.objRows.length)} 行数据，可以生成报告了`);
  }
}

/** 模板更换后重新映射已上传数据 */
function remapSource() {
  if (!state.source || !state.tpl) return;
  state.mapping = autoMap(state.tpl.headers || [], state.source.headers);
  if (state.mapping.skuCol < 0) {
    state.objRows = null;
    state.overview = null;
    return;
  }
  state.objRows = buildRows(state.tpl.headers || [], state.source.rows, state.mapping.map);
  state.overview = buildOverview(state.objRows);
}

/** 手动指定 SKU 列 */
function openSkuPicker() {
  const heads = state.source.headers;
  const sample = state.source.rows[0] || [];
  const body = `
    <div class="an-modal-text">
      <p>${esc(noSkuMessage())}</p>
      <div class="field" style="margin-top:12px">
        <label class="field-label">请选择 SKU 列</label>
        <select class="input" data-sku-sel>
          ${heads
            .map((h, i) => {
              const v = sample[i] == null ? '' : String(sample[i]).slice(0, 24);
              return `<option value="${i}">${esc(h || `第 ${i + 1} 列`)}${v ? `（示例：${esc(v)}）` : ''}</option>`;
            })
            .join('')}
        </select>
        <div class="field-tip">SKU 列的值需要与「产品表现」表 A 列的 SKU 一致，否则公式查不到数据。</div>
      </div>
    </div>`;
  const m = openModal({
    title: '手动指定 SKU 列',
    body,
    width: 'narrow',
    footer: `<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary" data-ok>确定</button>`,
  });
  m.el.querySelector('[data-cancel]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = () => {
    const idx = Number(m.el.querySelector('[data-sku-sel]').value);
    m.close();
    // 该列若已被其它字段占用，先释放
    Object.keys(state.mapping.map).forEach((k) => {
      if (state.mapping.map[k] === idx) delete state.mapping.map[k];
    });
    state.mapping.map[SKU_HEADER] = idx;
    state.mapping.skuCol = idx;
    state.mapping.matched = (state.tpl.headers || []).filter((h) => state.mapping.map[h] != null);
    state.mapping.unmatched = (state.tpl.headers || []).filter((h) => state.mapping.map[h] == null);
    finishSource();
  };
}

/** 列映射查看 / 手动调整 */
function openMappingModal() {
  const tplHeaders = state.tpl.headers || [];
  const heads = state.source.headers;
  const body = `
    <div class="an-map">
      <div class="an-map-head"><span>模板字段（${esc(DATA_SHEET)}）</span><span>上传文件列</span></div>
      ${tplHeaders
        .map((h, ci) => {
          const cur = state.mapping.map[h];
          return `
          <div class="an-map-row">
            <span class="an-map-l">
              <b>${colLetter(ci + 1)}</b> ${esc(h)}
              ${h === SKU_HEADER ? '<i class="an-map-key">主键</i>' : ''}
            </span>
            <select class="input input-sm" data-map="${esc(h)}">
              <option value="">— 不填充 —</option>
              ${heads.map((fh, i) => `<option value="${i}" ${cur === i ? 'selected' : ''}>${esc(fh || `第 ${i + 1} 列`)}</option>`).join('')}
            </select>
          </div>`;
        })
        .join('')}
    </div>`;
  const m = openModal({
    title: `列映射（已匹配 ${state.mapping.matched.length}/${tplHeaders.length}）`,
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary" data-ok>${icon('save')} 应用映射</button>`,
  });
  m.el.querySelector('[data-cancel]').onclick = m.close;
  m.el.querySelector('[data-ok]').onclick = () => {
    const next = {};
    m.el.querySelectorAll('[data-map]').forEach((sel) => {
      if (sel.value !== '') next[sel.dataset.map] = Number(sel.value);
    });
    if (next[SKU_HEADER] == null) {
      toastError(`「${SKU_HEADER}」是主键，必须指定对应列`);
      return;
    }
    m.close();
    state.mapping.map = next;
    state.mapping.skuCol = next[SKU_HEADER];
    state.mapping.matched = tplHeaders.filter((h) => next[h] != null);
    state.mapping.unmatched = tplHeaders.filter((h) => next[h] == null);
    finishSource();
    toastSuccess('列映射已更新');
  };
}

/** 预览前 20 行（映射后的结果） */
function openPreviewModal() {
  const tplHeaders = state.tpl.headers || [];
  const rows = (state.objRows || []).slice(0, 20);
  const body = `
    <div class="table-scroll" style="max-height:56vh">
      <table class="data-table an-table-tight">
        <thead><tr><th>#</th>${tplHeaders.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows
            .map(
              (r, i) =>
                `<tr><td>${i + 1}</td>${tplHeaders.map((h) => `<td>${esc(String(r[h] ?? ''))}</td>`).join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="field-tip" style="margin-top:10px">
      共 ${fmtInt((state.objRows || []).length)} 行，此处仅预览前 ${rows.length} 行。写入 Excel 时会按模板原有单元格格式（数字 / 百分比 / 文本）逐列写入。
    </div>`;
  const m = openModal({ title: '数据预览', body, width: 'wide', footer: `<button class="btn btn-primary" data-close>关闭</button>` });
  m.el.querySelector('[data-close]').onclick = m.close;
}

/** 一键生成报告 */
async function doGenerate() {
  if (!canGenerate()) {
    toastError(state.tpl ? '请先上传领星数据' : '请先加载报表模板');
    return;
  }
  state.busy = true;
  state.progress = 0;
  setStatus('开始生成报告…', 'work', 0);
  paint();

  try {
    const tplRec = await getTemplate();
    if (!tplRec || !tplRec.data) throw new Error('本地模板已丢失，请重新加载模板');

    const res = await generateReport({
      templateBlob: tplRec.data,
      headers: state.tpl.headers || [],
      rows: state.objRows,
      onProgress: ({ pct, text }) => setStatus(text, 'work', pct),
    });

    const fileName = defaultReportName(state.tpl.name);
    await addHistory({
      data: res.data,
      fileName,
      rowCount: res.rowCount,
      sourceName: state.source ? state.source.fileName : '',
      sheetNames: state.tpl.sheetNames || [],
    });
    state.history = await listHistory();

    downloadBlob(res.blob, fileName);

    state.busy = false;
    const extra = res.expanded ? `（公式引用范围已自动扩展到第 ${fmtInt(res.lookupEnd)} 行）` : '';
    const sync = res.patched && (res.patched.overview || res.patched.cases || res.patched.category)
      ? '，已同步 概况/案例分析/类目汇总'
      : '';
    setStatus(`报告已生成并开始下载：${fileName} · ${fmtInt(res.rowCount)} 行数据${sync}${extra}`, 'ok', 100);
    paint();
    toastSuccess(`报告已生成：${fileName}`);
  } catch (err) {
    state.busy = false;
    setStatus(`生成失败：${err.message}`, 'err', 0);
    paint();
    toastError(`报告生成失败：${err.message || '未知错误'}`);
  }
}

/** 下载历史报告 */
async function doDownloadHistory(id) {
  try {
    const rec = state.history.find((r) => r.id === id);
    const data = await getHistoryData(id);
    if (!data) {
      toastError('文件已丢失，请重新生成');
      return;
    }
    downloadBlob(toXlsxBlob(data), (rec && rec.fileName) || `报表_${id}.xlsx`);
    setStatus(`已开始下载：${(rec && rec.fileName) || id}`, 'ok');
    toastSuccess('开始下载');
  } catch (e) {
    toastError(`下载失败：${e.message}`);
  }
}

/** 删除历史报告 */
function doDeleteHistory(id) {
  const rec = state.history.find((r) => r.id === id);
  confirmDialog({
    title: '删除生成记录',
    message: `确定删除「${(rec && rec.fileName) || id}」吗？本地保存的报告文件会一并删除，已下载到电脑的文件不受影响。`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await deleteHistory(id);
        state.history = await listHistory();
        setStatus('已删除 1 条生成记录', 'idle');
        paint();
        toastSuccess('已删除');
      } catch (e) {
        toastError(`删除失败：${e.message}`);
      }
    },
  });
}

/** 清空历史 */
function doClearHistory() {
  confirmDialog({
    title: '清空生成记录',
    message: `确定清空全部 ${state.history.length} 条生成记录吗？本地保存的报告文件会一并删除，无法恢复。`,
    confirmText: '清空',
    danger: true,
    onConfirm: async () => {
      try {
        for (const r of state.history.slice()) await deleteHistory(r.id);
        state.history = await listHistory();
        setStatus('生成记录已清空', 'idle');
        paint();
        toastSuccess('已清空');
      } catch (e) {
        toastError(`清空失败：${e.message}`);
      }
    },
  });
}
