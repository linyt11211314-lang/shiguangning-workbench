/**
 * 广告诊断页 · 第一阶段：数据导入与解析
 * - 导入领星 ERP 导出的 Excel/CSV
 * - 自动识别关键字段，支持手动映射修正
 * - 解析后预览，确认后按 站点+日期 去重存入 localStorage
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/modal.js';
import {
  listRecords,
  listImports,
  upsertRecords,
  clearAll,
  removeImport,
} from '../store/adsStore.js';
import {
  FIELD_DEFS,
  readWorkbook,
  detectFields,
  buildRecords,
  validateMapping,
} from '../services/adParse.js';

const MAX_FILE_MB = 10;
const ACCEPT = '.xlsx,.xls,.csv';
const PREVIEW_LIMIT = 50;

function fmtNum(v, dec = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtInt(v) {
  return (Number(v) || 0).toLocaleString('zh-CN');
}
function siteLabel(s) {
  return s === 'AE' ? '中东站 AE' : s === 'SA' ? '沙特站 SA' : s;
}

export function render(container, { rerender } = {}) {
  const records = listRecords();
  const imports = listImports();

  container.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:12px">
          <div class="section-title">广告诊断</div>
          <div class="section-actions">
            <button class="btn btn-primary btn-sm" data-import>${icon('upload')} 导入领星数据</button>
            ${records.length ? `<button class="btn btn-soft btn-sm" data-export>${icon('download')} 导出</button>` : ''}
            ${records.length ? `<button class="btn btn-ghost btn-sm" data-clear>${icon('trash')} 清空</button>` : ''}
          </div>
        </div>
        <div class="field-tip">数据来源：领星 ERP 手动导出的广告报表（Excel / CSV）。导入后按「站点 + 日期」自动去重。</div>
      </div>
    </div>
    ${records.length ? renderSummary(records, imports) : renderEmpty()}
  `;

  container.querySelector('[data-import]')?.addEventListener('click', () => openImportModal(rerender));
  container.querySelector('[data-export]')?.addEventListener('click', () => exportData(records));
  container.querySelector('[data-clear]')?.addEventListener('click', () => {
    confirmDialog({
      title: '清空广告数据',
      message: '将删除全部已导入的广告明细与导入记录，且不可恢复。确定继续？',
      danger: true,
      confirmText: '清空',
      onConfirm: () => {
        clearAll();
        toastSuccess('已清空全部广告数据');
        rerender();
      },
    });
  });

  // 删除单个导入批次
  container.querySelectorAll('[data-del-import]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delImport;
      const imp = imports.find((i) => i.id === id);
      confirmDialog({
        title: '删除该导入批次',
        message: `将移除批次「${esc(imp?.fileName || id)}」写入的明细（若已被后续导入覆盖则保留）。确定？`,
        danger: true,
        confirmText: '删除',
        onConfirm: () => {
          removeImport(id);
          toastSuccess('已删除该导入批次');
          rerender();
        },
      });
    });
  });
}

function renderEmpty() {
  return `
    <div class="card">
      <div class="card-pad" style="text-align:center;padding:48px 20px">
        <div style="font-size:34px;margin-bottom:10px;opacity:.5">${icon('database')}</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">还没有广告数据</div>
        <div style="font-size:13px;color:var(--text-sub);line-height:1.6;max-width:380px;margin:0 auto">
          点击上方「导入领星数据」，上传从领星 ERP 导出的广告报表（.xlsx / .csv），系统会自动解析并保存。
        </div>
      </div>
    </div>`;
}

function renderSummary(records, imports) {
  const sites = [...new Set(records.map((r) => r.site))].sort();
  const dates = records.map((r) => r.date).sort();
  const dateRange = dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '-';
  const totalCost = records.reduce((s, r) => s + r.cost, 0);
  const totalSales = records.reduce((s, r) => s + r.sales, 0);
  const totalClicks = records.reduce((s, r) => s + r.clicks, 0);
  const totalOrders = records.reduce((s, r) => s + r.orders, 0);
  const acos = totalSales > 0 ? (totalCost / totalSales) * 100 : 0;

  const importRows = imports
    .map(
      (i) => `
      <div class="imp-row">
        <div class="imp-info">
          <div class="imp-name">${esc(i.fileName)}</div>
          <div class="imp-meta">${siteLabel(i.site)} · ${esc(i.period)} · ${fmtInt(i.count)} 行 · ${new Date(i.at).toLocaleString('zh-CN')}</div>
        </div>
        <button class="task-act task-del" data-del-import="${i.id}">删除</button>
      </div>`
    )
    .join('');

  const tableRows = records
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.site.localeCompare(b.site)))
    .map(
      (r) => `
      <tr>
        <td>${esc(r.date)}</td>
        <td>${esc(siteLabel(r.site))}</td>
        <td class="num">${fmtNum(r.cost)}</td>
        <td class="num">${fmtNum(r.sales)}</td>
        <td class="num">${fmtInt(r.impressions)}</td>
        <td class="num">${fmtInt(r.clicks)}</td>
        <td class="num">${fmtInt(r.orders)}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:14px">
          <div class="section-title">数据概览</div>
          <span class="section-sub">共 ${fmtInt(records.length)} 条明细</span>
        </div>
        <div class="ads-stats">
          <div class="ads-stat"><div class="ads-stat-v">${fmtNum(totalCost)}</div><div class="ads-stat-l">总花费</div></div>
          <div class="ads-stat"><div class="ads-stat-v">${fmtNum(totalSales)}</div><div class="ads-stat-l">总广告销售额</div></div>
          <div class="ads-stat"><div class="ads-stat-v">${acos.toFixed(1)}%</div><div class="ads-stat-l">整体 ACOS</div></div>
        </div>
        <div class="ads-meta-line">覆盖站点：${sites.map(siteLabel).join('、') || '-'} ｜ 日期范围：${dateRange} ｜ 总点击 ${fmtInt(totalClicks)} ｜ 总订单 ${fmtInt(totalOrders)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:10px">
          <div class="section-title">导入记录</div>
        </div>
        <div class="imp-list">${importRows || '<div class="field-tip">暂无导入记录</div>'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-pad">
        <div class="section-head" style="margin-bottom:10px">
          <div class="section-title">明细数据</div>
          <span class="section-sub">${records.length > 500 ? '仅显示前 500 条' : `共 ${records.length} 条`}</span>
        </div>
        <div class="table-scroll" style="max-height:520px">
          <table class="data-table">
            <thead>
              <tr><th>日期</th><th>站点</th><th class="num">花费</th><th class="num">销售额</th><th class="num">曝光</th><th class="num">点击</th><th class="num">订单</th></tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function openImportModal(rerender) {
  const body = `
    <div class="imp-step">
      <div class="field" style="margin-bottom:14px">
        <label class="field-label">选择文件（.xlsx / .xls / .csv，≤10MB）</label>
        <input type="file" accept="${ACCEPT}" class="input" data-file>
        <div class="field-tip" data-file-tip>支持领星 ERP 导出的广告报表。</div>
      </div>
      <div class="imp-opts" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div class="field" style="min-width:150px">
          <label class="field-label">站点</label>
          <select class="input" data-site>
            <option value="AE">中东站 AE</option>
            <option value="SA">沙特站 SA</option>
            <option value="ALL">全部（按文件内站点列）</option>
          </select>
        </div>
        <div class="field" style="min-width:150px">
          <label class="field-label">数据周期</label>
          <select class="input" data-period>
            <option value="近7天">近 7 天</option>
            <option value="近30天">近 30 天</option>
            <option value="自定义">自定义</option>
          </select>
        </div>
      </div>
      <div data-parse-area></div>
    </div>`;

  const m = openModal({
    title: '导入领星广告数据',
    body,
    width: 'wide',
    footer: `<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary" data-confirm disabled>确认导入</button>`,
  });

  const fileInput = m.el.querySelector('[data-file]');
  const parseArea = m.el.querySelector('[data-parse-area]');
  const confirmBtn = m.el.querySelector('[data-confirm]');
  const cancelBtn = m.el.querySelector('[data-cancel]');
  cancelBtn.onclick = m.close;

  const state = {
    rawRows: null,
    headers: [],
    mapping: {},
    site: 'AE',
    period: '近7天',
  };

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toastError('仅支持 .xlsx / .xls / .csv 文件');
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toastError(`文件超过 ${MAX_FILE_MB}MB，请分批导入`);
      return;
    }
    parseArea.innerHTML = `<div class="field-tip">正在解析「${esc(file.name)}」…</div>`;
    try {
      const rows = await readWorkbook(file);
      if (!rows.length) {
        parseArea.innerHTML = `<div class="field-tip" style="color:var(--red)">文件无数据或表头为空，请检查文件。</div>`;
        return;
      }
      state.rawRows = rows;
      state.headers = Object.keys(rows[0]);
      state.mapping = detectFields(state.headers);
      renderMappingAndPreview();
    } catch (err) {
      parseArea.innerHTML = `<div class="field-tip" style="color:var(--red)">解析失败：${esc(err.message || String(err))}</div>`;
    }
  });

  function renderMappingAndPreview() {
    const missing = validateMapping(state.mapping);
    const showSiteWarn = state.site === 'ALL' && !state.mapping.site;

    const mapHtml = FIELD_DEFS.map((def) => {
      const opts = ['<option value="">（未匹配）</option>']
        .concat(
          state.headers.map(
            (h) => `<option value="${esc(h)}" ${state.mapping[def.key] === h ? 'selected' : ''}>${esc(h)}</option>`
          )
        )
        .join('');
      const sample = state.mapping[def.key] ? state.rawRows[0][state.mapping[def.key]] : '';
      return `
        <div class="map-row">
          <div class="map-label">${def.label}${def.required ? ' <span class="req">*</span>' : ''}</div>
          <select class="input map-select" data-map="${def.key}">${opts}</select>
          <div class="map-sample">示例：${esc(String(sample ?? '').slice(0, 20))}</div>
        </div>`;
    }).join('');

    const recs = buildRecords(state.rawRows, state.mapping, state.site, 'preview');
    const previewRows = recs.slice(0, PREVIEW_LIMIT).map((r) => `
      <tr>
        <td>${esc(r.date)}</td><td>${esc(siteLabel(r.site))}</td>
        <td class="num">${fmtNum(r.cost)}</td><td class="num">${fmtNum(r.sales)}</td>
        <td class="num">${fmtInt(r.impressions)}</td><td class="num">${fmtInt(r.clicks)}</td>
        <td class="num">${fmtInt(r.orders)}</td>
      </tr>`).join('');

    parseArea.innerHTML = `
      <div class="map-grid">${mapHtml}</div>
      ${showSiteWarn ? `<div class="field-tip" style="color:var(--red);margin:6px 0">站点选择为「全部」，但文件未匹配到站点列，请手动映射站点列，或将上方站点改为 AE / SA。</div>` : ''}
      ${missing.length ? `<div class="field-tip" style="color:var(--red);margin:6px 0">请先匹配必填字段：${missing.join('、')}</div>` : ''}
      <div class="section-head" style="margin:14px 0 8px">
        <div class="section-title" style="font-size:14px">数据预览</div>
        <span class="section-sub">${recs.length} 行有效${recs.length > PREVIEW_LIMIT ? `（仅显示前 ${PREVIEW_LIMIT} 行）` : ''}</span>
      </div>
      <div class="table-scroll" style="max-height:280px">
        <table class="data-table">
          <thead><tr><th>日期</th><th>站点</th><th class="num">花费</th><th class="num">销售额</th><th class="num">曝光</th><th class="num">点击</th><th class="num">订单</th></tr></thead>
          <tbody>${previewRows || '<tr><td colspan="7" style="text-align:center;color:var(--text-sub)">无有效数据，请检查映射</td></tr>'}</tbody>
        </table>
      </div>`;

    parseArea.querySelectorAll('[data-map]').forEach((sel) => {
      sel.addEventListener('change', () => {
        state.mapping[sel.dataset.map] = sel.value || null;
        renderMappingAndPreview();
      });
    });

    confirmBtn.disabled = missing.length > 0 || recs.length === 0;
    confirmBtn.onclick = () => doConfirm(recs);
  }

  function doConfirm(previewRecs) {
    const site = m.el.querySelector('[data-site]').value;
    const period = m.el.querySelector('[data-period]').value;
    const importId = 'imp_' + Date.now();
    // 用最终选择的站点/周期重新构建（避免预览时 site=ALL 但 mapping 后变化）
    const finalRecs = buildRecords(state.rawRows, state.mapping, site, importId);
    if (!finalRecs.length) {
      toastError('没有可导入的有效数据');
      return;
    }
    const fileName = fileInput.files[0]?.name || '未命名文件';
    try {
      const res = upsertRecords(finalRecs, { site, period, fileName, importId });
      m.close();
      toastSuccess(`导入完成：新增 ${res.added} 条，覆盖更新 ${res.updated} 条，共 ${res.total} 条`);
      rerender();
    } catch (err) {
      toastError(err.message || '保存失败');
    }
  }
}

function exportData(records) {
  if (!records.length) return;
  const ws = XLSX.utils.json_to_sheet(
    records.map((r) => ({
      日期: r.date,
      站点: r.site,
      花费: r.cost,
      销售额: r.sales,
      曝光: r.impressions,
      点击: r.clicks,
      订单: r.orders,
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '广告明细');
  const d = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `拾光柠广告明细_${d}.xlsx`);
}
