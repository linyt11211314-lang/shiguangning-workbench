/**
 * 竞品追踪 · 产品库（追踪组卡片列表）
 * 纯客户端架构：数据走 competitorStore（IndexedDB / 桌面文件化 localStorage），
 * 复用拾光柠 openModal / toast / 导航（ctx.navigate）。
 */
import { STORES, STOCK_LABEL, fmtMoney, fmtNum, stockTag, storeTag, productLink, todayStr, dShort } from '../ui/competitorUtil.js';
import { openModal } from '../ui/modal.js';
import { toast, toastInfo } from '../ui/toast.js';
import { esc, fileToDataURL } from '../utils.js';
import { listCompetitors, addCompetitor, updateCompetitor, removeCompetitor, batchSnapshots, deleteSnapshot, initCompetitors } from '../store/competitorStore.js';
import { kwList, kwPanelHtml, openKwEditModal } from '../ui/competitorKw.js';

let _ctx = null;
let filterType = 'all';   // all / own / competitor
let filterStore = 'all';  // all / ZOWOO / Fongyoung
const previewDates = new Map();   // groupKey -> 'YYYY-MM-DD'（当前预览的日期）
const kwOpen = new Set();         // 展开了关键词面板的产品 id
let all = [];                     // 当前产品列表（listCompetitors 结果）

/* ---------------- 小工具 ---------------- */

const snapsOf = (p) => (p.snapshots || []);
const latestOf = (p) => {
  const a = snapsOf(p);
  if (!a.length) return null;
  return a.slice().sort((x, y) => (x.date < y.date ? 1 : -1))[0];
};
const snapOn = (p, d) => snapsOf(p).find(s => s.date === d) || null;
const snapBefore = (p, d) => { const a = snapsOf(p).filter(s => s.date <= d); return a.length ? a[a.length - 1] : null; };
const priorOf = (p, d) => { const a = snapsOf(p).filter(s => s.date < d); return a.length ? a[a.length - 1] : null; };
const groupDates = (rows) => [...new Set(rows.flatMap(p => snapsOf(p).map(s => s.date)))].sort().reverse();
const numOrEmpty = (v) => (v === null || v === undefined ? '' : String(v));

function bindClose(body, m) {
  body.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', m.close));
}

/* ---------------- 页面入口 ---------------- */

export async function render(container, route, ctx) {
  _ctx = ctx || null;
  await initCompetitors();
  all = listCompetitors();
  doRender(container);
}

function doRender(container) {
  const view = container;
  const products = all;

  const n = (f) => products.filter(f).length;
  const filtered = products.filter(p =>
    (filterType === 'all' || p.type === filterType) &&
    (filterStore === 'all' || p.store === filterStore)
  );

  const cardsHtml = buildCards(filtered);

  view.innerHTML = `
    <div class="ct-page">
      <div class="spread" style="margin-bottom:12px">
        <div class="section-title" style="margin:0">竞品追踪 · 产品库</div>
        <button class="btn btn-primary" id="add-product">＋ 添加产品</button>
      </div>

      <div class="filter-bar">
        <span class="chip ${filterType === 'all' ? 'active' : ''}" data-f="all">全部 ${products.length}</span>
        <span class="chip ${filterType === 'own' ? 'active' : ''}" data-f="own">自家 ${n(p => p.type === 'own')}</span>
        <span class="chip ${filterType === 'competitor' ? 'active' : ''}" data-f="competitor">竞品 ${n(p => p.type === 'competitor')}</span>
        <span class="filter-sep"></span>
        <span class="chip ${filterStore === 'all' ? 'active' : ''}" data-s="all">全部店铺</span>
        ${STORES.map(s => `<span class="chip ${filterStore === s ? 'active' : ''}" data-s="${s}">${s} ${n(p => p.store === s)}</span>`).join('')}
      </div>

      <div class="hint" style="margin-bottom:12px">
        一张卡片 = 一个追踪组：<b>第一行是自家链接数据，下面各行是竞品数据</b>。
        <b>把竞品链接直接粘到卡片下方那一栏就能加进来</b>。
        每行右侧 <b>⋯</b> 可以单独「改资料 / 移出本组 / 删除这个竞品」（只影响这一行）。
        点右上角 <b>📅 日期</b> 可以按天选看历史记录，点任意一行可查看该链接的全部历史数据。
      </div>

      ${cardsHtml || `<div class="card"><div class="empty">还没有产品，点右上角「＋ 添加产品」开始。</div></div>`}
    </div>`;

  bindAll(view);
}

/* ---------------- 卡片 ---------------- */

function buildCards(filtered) {
  // 只看竞品时平铺，不做分组
  if (filterType !== 'all') {
    return filtered.map(p => renderCard(p, [p], 'p-' + p.id, p.type === 'own')).join('');
  }

  const placed = new Set();
  let html = '';

  filtered.filter(p => p.type === 'own').forEach(own => {
    const comps = filtered.filter(p => String(p.linked_own_id) === String(own.id));
    html += renderCard(own, [own, ...comps], 'g-' + own.id, true);
    placed.add(own.id);
    comps.forEach(c => placed.add(c.id));
  });

  filtered.filter(p => p.type === 'competitor' && !placed.has(p.id))
    .forEach(c => { html += renderCard(c, [c], 'p-' + c.id, false); });

  return html;
}

function renderCard(head, rows, groupKey, isOwn) {
  const dates = groupDates(rows);
  const latestDate = dates[0] || '';
  let sel = previewDates.get(groupKey) || latestDate;
  if (sel && !/^\d{4}-\d{2}-\d{2}$/.test(sel)) sel = latestDate;
  const isStale = !!(sel && latestDate && sel !== latestDate);

  const thumb = head.image_url
    ? `<img src="${esc(head.image_url)}" class="thumb" loading="lazy" alt="">`
    : `<div class="thumb-placeholder">＋图</div>`;

  const metaBits = [
    storeTag(head.store),
    head.type === 'own' ? '<span class="tag tag-own">自家</span>' : '<span class="tag tag-comp">竞品</span>'
  ];
  if (head.marketplace) metaBits.push(`<span class="muted">${esc(head.marketplace)}</span>`);
  if (head.category) metaBits.push(`<span class="muted">${esc(head.category)}</span>`);
  const latest = latestOf(head);
  const trackedToday = latest && latest.date === todayStr();
  metaBits.push(trackedToday
    ? '<span class="tag tag-good">今日已跟</span>'
    : '<span class="tag tag-warn">今日未跟</span>');

  const strip = dates.length > 1
    ? `<div class="date-strip">记录日期：
        ${dates.slice(0, 8).map(d => `<span class="dchip ${d === sel ? 'active' : ''}" data-pick="${d}" data-group="${groupKey}">${dShort(d)}</span>`).join('')}
        ${dates.length > 8 ? `<span class="muted" style="font-size:11px">…共 ${dates.length} 天</span>` : ''}
      </div>`
    : '';

  const dataRows = rows.map(p => dataRow(p, { date: sel, groupKey })).join('');

  const foot = isOwn
    ? `<div class="add-comp" data-own="${head.id}">
        <span class="ac-plus">＋</span>
        <input class="ac-url" placeholder="粘贴竞品链接（亚马逊地址或 ASIN），回车即可添加">
        <input class="ac-name" placeholder="品名（可选）">
        <button class="btn btn-sm btn-primary" data-addcomp="${head.id}">添加竞品</button>
        ${rows.length > 1 ? `<button class="btn btn-sm btn-ghost" data-link="${head.id}" title="从已添加过的竞品里勾选">从已有中选</button>` : ''}
      </div>`
    : '';

  return `<div class="track-card">
    <div class="track-head">
      <div class="thumb-cell" data-img="${head.id}" title="${head.image_url ? '点击修改主图' : '点击上传主图'}">${thumb}</div>
      <div class="track-info">
        <div class="track-title">${esc(head.title || '未填品名')}</div>
        <div class="p-meta">
          ${metaBits.join('')}
          ${productLink(head, { label: /^https?:/i.test(head.asin || '') ? '打开链接' : (head.asin || '打开链接') })}
          <span class="muted">最近记录 ${latestDate || '—'}</span>
        </div>
      </div>
      <div class="track-ctl">
        <label class="date-ctl" title="点一下用日历选择要查看的日期">
          <span>📅</span>
          <input type="date" class="date-input" data-date="${groupKey}" value="${sel || ''}">
        </label>
        ${isStale ? `<button class="btn btn-sm" data-latest="${groupKey}" data-val="${latestDate}">回到最新</button>` : ''}
        <button class="btn btn-sm btn-primary" data-fill="${head.id}" data-group="${groupKey}" data-date="${sel || ''}">📝 填数据</button>
        <button class="btn btn-sm btn-more" data-menu="${head.id}" title="更多操作">⋯</button>
      </div>
    </div>
    ${strip}
    <div class="track-rows">${dataRows}</div>
    ${foot}
  </div>`;
}

/* 一行 = 一个链接某天的数据 */
function dataRow(p, { date, groupKey }) {
  const exact = date ? snapOn(p, date) : null;
  const fb = (date && !exact) ? snapBefore(p, date) : null;
  const s = exact || fb || {};
  const stale = !exact && !!fb;

  let dateBadge;
  if (exact) dateBadge = `<span class="d-badge ok">${dShort(date)}</span>`;
  else if (fb) dateBadge = `<span class="d-badge stale">沿用 ${dShort(fb.date)}</span>`;
  else if (!date && latestOf(p)) dateBadge = `<span class="d-badge ok">${dShort(latestOf(p).date)}</span>`;
  else dateBadge = `<span class="d-badge none">${date ? '该日无记录' : '无记录'}</span>`;

  const role = p.type === 'own'
    ? '<span class="tag tag-own">自家</span>'
    : '<span class="tag tag-comp">竞品</span>';

  const kws = kwList(s);
  const kwsPrev = kwList(priorOf(p, (exact || fb || {}).date) || {});

  const panel = kwOpen.has(String(p.id)) && (exact || fb)
    ? kwPanelHtml(p, s, kws, kwsPrev, groupKey)
    : '';

  return `<div class="drow ${p.type === 'own' ? 'drow-own' : 'drow-comp'}${stale ? ' is-stale' : ''}"
      data-hist="${p.id}" data-group="${groupKey}" title="点击查看该链接的历史数据">
    <div class="drow-role">${role}</div>
    <div class="drow-link">
      <div class="drow-name">${esc(p.title || '未填品名')}</div>
      <div class="drow-sub">${esc(p.store || '—')} ${productLink(p, { label: /^https?:/i.test(p.asin || '') ? '链接' : (p.asin || '链接') })}</div>
    </div>
    <div class="drow-metrics">${metricsHtml(s)}</div>
    <div class="drow-date">${dateBadge}</div>
    <div class="drow-act">
      <button class="btn btn-sm ${kwOpen.has(String(p.id)) ? 'btn-ghost' : ''}" data-kw="${p.id}" data-group="${groupKey}" title="关键词搜索位置">词${kws.length ? ' ' + kws.length : ''}</button>
      <button class="btn btn-sm" data-hist-btn="${p.id}" data-group="${groupKey}">历史</button>
      <button class="btn btn-sm btn-more" data-menu="${p.id}" title="更多操作（删除此链接等）">⋯</button>
    </div>
  </div>${panel}`;
}

function metricsHtml(s) {
  const m = (k, v) => `<div class="metric"><span class="m-k">${k}</span><span class="m-v">${v}</span></div>`;
  return [
    m('价格', s.price != null ? fmtMoney(s.price) : '<span class="muted">—</span>'),
    m('券', s.coupon ? esc(s.coupon) + '%' : '<span class="muted">—</span>'),
    m('BSR', s.bsr != null ? fmtNum(s.bsr) : '<span class="muted">—</span>'),
    m('评分', s.rating != null ? esc(s.rating) : '<span class="muted">—</span>'),
    m('评论', s.review_count != null ? fmtNum(s.review_count) : '<span class="muted">—</span>'),
    m('库存', s.stock_status || s.stock_qty != null ? stockTag(s.stock_status, s.stock_qty) : '<span class="muted">—</span>')
  ].join('');
}

/* ---------------- 事件绑定 ---------------- */

function find(id) { return all.find(x => String(x.id) === String(id)); }

function bindAll(view) {
  view.querySelectorAll('.chip[data-f]').forEach(c => c.addEventListener('click', () => { filterType = c.dataset.f; doRender(view.closest('#pageContent') || view.parentNode); }));
  view.querySelectorAll('.chip[data-s]').forEach(c => c.addEventListener('click', () => { filterStore = c.dataset.s; doRender(view.closest('#pageContent') || view.parentNode); }));
  view.querySelector('#add-product').addEventListener('click', () => openProductModal(null));

  view.querySelectorAll('[data-img]').forEach(el => el.addEventListener('click', () => openImageModal(find(el.dataset.img))));

  view.querySelectorAll('[data-fill]').forEach(b => b.addEventListener('click', () => {
    openFillModal({ target: find(b.dataset.fill), products: all, date: b.dataset.date, groupKey: b.dataset.group, refresh: () => doRender(view.closest('#pageContent') || view.parentNode) });
  }));

  view.querySelectorAll('[data-menu]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openRowMenu(b, find(b.dataset.menu));
  }));

  view.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => openLinkModal(all, find(b.dataset.link))));

  // 卡片底部：直接粘贴竞品链接即添加
  view.querySelectorAll('.add-comp').forEach(box => {
    const own = find(box.dataset.own);
    const urlInp = box.querySelector('.ac-url');
    const nameInp = box.querySelector('.ac-name');
    const submit = async () => {
      const raw = urlInp.value.trim();
      if (!raw) { toast('请先粘贴竞品链接'); urlInp.focus(); return; }
      const btn = box.querySelector('[data-addcomp]');
      btn.disabled = true;
      try {
        await addCompetitorToGroup(own, raw, nameInp.value.trim(), all);
        toast('已加入本组，可点「📝 填数据」录入');
        doRender(view.closest('#pageContent') || view.parentNode);
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
      }
    };
    box.querySelector('[data-addcomp]').addEventListener('click', submit);
    [urlInp, nameInp].forEach(i => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    }));
  });

  // 卡片上的日期选择（日历）
  view.querySelectorAll('input[data-date]').forEach(inp => inp.addEventListener('change', () => {
    const key = inp.dataset.date;
    previewDates.set(key, inp.value || '');
    doRender(view.closest('#pageContent') || view.parentNode);
  }));
  // 记录日期快捷切换
  view.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
    previewDates.set(el.dataset.group, el.dataset.pick);
    doRender(view.closest('#pageContent') || view.parentNode);
  }));
  // 回到最新
  view.querySelectorAll('[data-latest]').forEach(b => b.addEventListener('click', () => {
    previewDates.set(b.dataset.latest, b.dataset.val);
    doRender(view.closest('#pageContent') || view.parentNode);
  }));

  // 点整行 → 历史数据
  view.querySelectorAll('.drow').forEach(row => row.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    openHistoryModal(find(row.dataset.hist), row.dataset.group);
  }));
  view.querySelectorAll('[data-hist-btn]').forEach(b => b.addEventListener('click', () => {
    openHistoryModal(find(b.dataset.histBtn), b.dataset.group);
  }));

  // 关键词面板：展开 / 收起
  view.querySelectorAll('[data-kw]').forEach(b => b.addEventListener('click', () => {
    const id = String(b.dataset.kw);
    kwOpen.has(id) ? kwOpen.delete(id) : kwOpen.add(id);
    doRender(view.closest('#pageContent') || view.parentNode);
  }));
  // 关键词排名编辑
  view.querySelectorAll('[data-kwedit]').forEach(b => b.addEventListener('click', () => {
    openKwEditModal(find(b.dataset.kwedit), b.dataset.date, () => doRender(view.closest('#pageContent') || view.parentNode));
  }));
}

/* ---------------- 历史数据弹窗 ---------------- */

function openHistoryModal(p, groupKey) {
  if (!p) return;
  const cur = previewDates.get(groupKey) || '';
  const list = snapsOf(p).slice().reverse();
  const refresh = () => doRender(document.getElementById('pageContent'));

  const bodyHtml = list.length
    ? `<div class="muted" style="font-size:12px;margin-bottom:10px">
         共 ${list.length} 条记录。点日期即可让卡片切换到那一天。
       </div>
       <table class="hist-table">
         <thead><tr><th>日期</th><th>价格</th><th>券%</th><th>BSR</th><th>评分</th><th>评论</th><th>库存</th><th></th></tr></thead>
         <tbody>${list.map(s => `<tr class="${s.date === cur ? 'hi-cur' : ''}">
            <td><button class="dlink" data-pick2="${s.date}">${s.date}</button></td>
            <td>${s.price != null ? fmtMoney(s.price) : '—'}</td>
            <td>${s.coupon ? s.coupon : '—'}</td>
            <td>${s.bsr != null ? fmtNum(s.bsr) : '—'}</td>
            <td>${s.rating != null ? s.rating : '—'}</td>
            <td>${s.review_count != null ? fmtNum(s.review_count) : '—'}</td>
            <td>${s.stock_status ? (STOCK_LABEL[s.stock_status] || s.stock_status) : '—'}${s.stock_qty != null ? ` · ${fmtNum(s.stock_qty)}件` : ''}</td>
            <td><button class="btn btn-sm btn-danger" data-delsnap="${s.date}">删</button></td>
          </tr>`).join('')}</tbody>
       </table>`
    : `<div class="empty">这个链接还没有历史记录，点卡片上的「📝 填数据」开始记录。</div>`;

  const m = openModal({
    title: '📈 历史数据 · ' + (p.title || p.asin),
    body: `
    <div class="row" style="gap:8px;margin-bottom:12px">
      ${p.type === 'own' ? '<span class="tag tag-own">自家</span>' : '<span class="tag tag-comp">竞品</span>'}
      ${storeTag(p.store)}
      ${productLink(p, { label: '打开亚马逊链接' })}
      <button class="btn btn-sm" id="hist-detail">查看详情页 →</button>
    </div>
    ${bodyHtml}
    <div class="spread" style="margin-top:16px">
      <div class="row" style="gap:8px">
        <button class="btn" data-close="1">关闭</button>
        <button class="btn btn-danger" id="hist-del">${p.type === 'own' ? '🗑 删除这个自家产品' : '🗑 删除这个竞品'}</button>
      </div>
      <button class="btn btn-primary" id="hist-fill">📝 补记/修改某天数据</button>
    </div>`,
    width: 'wide',
  });
  const body = m.el.querySelector('.modal-body');
  bindClose(body, m);

  body.querySelectorAll('[data-pick2]').forEach(b => b.addEventListener('click', () => {
    previewDates.set(groupKey, b.dataset.pick2);
    m.close();
    refresh();
  }));

  body.querySelectorAll('[data-delsnap]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm(`删除 ${b.dataset.delsnap} 这条记录？`)) return;
    try {
      await deleteSnapshot(p.id, b.dataset.delsnap);
      toast('已删除该条记录');
      refresh();
      openHistoryModal(p, groupKey);
    } catch (e) { toast(e.message); }
  }));

  body.querySelector('#hist-detail').addEventListener('click', () => { m.close(); if (_ctx) _ctx.navigate('competitor:detail:' + p.id); });

  body.querySelector('#hist-del').addEventListener('click', async () => {
    const kids = p.type === 'own' ? all.filter(x => String(x.linked_own_id) === String(p.id)) : [];
    const extra = kids.length ? `\n\n注意：它下面的 ${kids.length} 个竞品不会被删除，会各自变成独立卡片。` : '';
    if (!confirm(`确认删除「${p.title || p.asin || '未命名'}」及其全部历史记录？${extra}`)) return;
    try {
      await removeCompetitor(p.id);
      toast('已删除');
      m.close();
      refresh();
    } catch (e) { toast(e.message); }
  });

  body.querySelector('#hist-fill').addEventListener('click', async () => {
    m.close();
    openFillModal({ target: p, products: all, date: previewDates.get(groupKey) || todayStr(), groupKey, refresh });
  });
}

/* ---------------- 填数据（自家 + 旗下竞品，一行一个产品） ---------------- */

function fillRowsHtml(group, date) {
  return group.map((p, i) => {
    const exact = snapOn(p, date);
    const prior = exact ? priorOf(p, date) : snapBefore(p, date);
    const val = (k) => (exact ? numOrEmpty(exact[k]) : '');
    const ph = (k, fmt) => {
      const v = prior ? prior[k] : null;
      if (v == null || v === '') return '';
      return `placeholder="上次 ${fmt ? fmt(v) : v}"`;
    };
    const isChild = i > 0;
    return `<tr>
      <td class="fill-name">
        ${isChild ? '<span class="fill-branch">└</span>' : ''}
        <span class="fill-store">${esc(p.store || '—')}</span>
        ${esc(p.title || p.asin)}
      </td>
      <td><input class="fill-in" data-id="${p.id}" data-k="price" value="${val('price')}" ${ph('price', v => fmtMoney(v))} inputmode="decimal"></td>
      <td><input class="fill-in" data-id="${p.id}" data-k="coupon" value="${val('coupon')}" ${ph('coupon')} inputmode="decimal"></td>
      <td><input class="fill-in" data-id="${p.id}" data-k="bsr" value="${val('bsr')}" ${ph('bsr', v => fmtNum(v))} inputmode="numeric"></td>
      <td><input class="fill-in" data-id="${p.id}" data-k="rating" value="${val('rating')}" ${ph('rating')} inputmode="decimal"></td>
      <td><input class="fill-in" data-id="${p.id}" data-k="review_count" value="${val('review_count')}" ${ph('review_count', v => fmtNum(v))} inputmode="numeric"></td>
      <td>
        <select class="fill-in fill-sel" data-id="${p.id}" data-k="stock_status">
          <option value="">—</option>
          ${['in_stock', 'low', 'out_of_stock'].map(s =>
            `<option value="${s}" ${exact && exact.stock_status === s ? 'selected' : ''}>${STOCK_LABEL[s]}</option>`).join('')}
        </select>
      </td>
      <td><input class="fill-in" data-id="${p.id}" data-k="stock_qty" value="${val('stock_qty')}" ${ph('stock_qty', v => fmtNum(v) + ' 件')} inputmode="numeric" title="可填具体库存数量"></td>
      <td><button class="btn btn-sm" data-last="${p.id}" title="把上一次的数据填进来">沿用上次</button></td>
    </tr>`;
  }).join('');
}

export function openFillModal({ target, products, date, groupKey, refresh }) {
  if (!target) return;
  const comps = target.type === 'own'
    ? (products || all).filter(p => String(p.linked_own_id) === String(target.id))
    : [];
  const group = [target, ...comps];
  const d0 = date || todayStr();

  const render = (d) => {
    const m = openModal({
      title: '📝 填数据 · ' + d,
      body: `
      <div class="row" style="gap:12px;margin-bottom:10px;align-items:flex-end">
        <div class="field" style="flex:0 0 180px;margin-bottom:0"><label>记录日期（可补记历史）</label>
          <input type="date" id="fill-date" value="${d}">
        </div>
        <div class="muted" style="font-size:12px;padding-bottom:8px">
          每个产品填自己的数据。<b>留空的不会保存</b>，只更新你填了的项。
        </div>
      </div>
      <div class="fill-wrap">
        <table class="fill-table">
          <thead><tr>
            <th>产品</th><th>价格$</th><th>券%</th><th>BSR</th><th>评分</th><th>评论数</th><th>库存状态</th><th>库存数</th><th></th>
          </tr></thead>
          <tbody>${fillRowsHtml(group, d)}</tbody>
        </table>
      </div>
      <div class="spread" style="margin-top:16px">
        <button class="btn" data-close="1">取消</button>
        <button class="btn btn-primary" id="fill-save">保存到 ${d}（${group.length} 个产品）</button>
      </div>`,
      width: 'wide',
    });
    const body = m.el.querySelector('.modal-body');
    bindClose(body, m);

    body.querySelector('#fill-date').addEventListener('change', (e) => {
      render(e.target.value || todayStr());
    });

    body.querySelectorAll('[data-last]').forEach(btn => btn.addEventListener('click', () => {
      const p = (products || all).find(x => String(x.id) === btn.dataset.last);
      const src = priorOf(p, d) || latestOf(p);
      if (!src) { toast('该产品还没有历史数据'); return; }
      body.querySelectorAll(`.fill-in[data-id="${btn.dataset.last}"]`).forEach(inp => {
        const v = src[inp.dataset.k];
        inp.value = (v === null || v === undefined) ? '' : v;
      });
    }));

    body.querySelector('#fill-save').addEventListener('click', async () => {
      const saveDate = body.querySelector('#fill-date').value || d;
      const map = new Map();
      body.querySelectorAll('.fill-in').forEach(inp => {
        const v = inp.value.trim();
        if (!v) return;
        if (!map.has(inp.dataset.id)) map.set(inp.dataset.id, { id: inp.dataset.id });
        map.get(inp.dataset.id)[inp.dataset.k] = v;
      });
      if (!map.size) { toast('至少填写一项数据'); return; }
      try {
        const r = batchSnapshots({ date: saveDate, rows: [...map.values()] });
        if (groupKey) previewDates.set(groupKey, saveDate);
        m.close();
        toast(`已保存 ${r.saved} 个产品的 ${saveDate} 数据${r.skipped ? `（${r.skipped} 个未填已跳过）` : ''}`);
        if (typeof refresh === 'function') refresh();
        else doRender(document.getElementById('pageContent'));
      } catch (e) { toast(e.message); }
    });
  };

  render(d0);
}

/* ---------------- 设置主图 ---------------- */

function openImageModal(p) {
  if (!p) return;
  const cur = p.image_url || '';

  const m = openModal({
    title: '设置主图 · ' + (p.title || p.asin),
    body: `
    <div class="muted" style="font-size:12px;margin-bottom:12px">
      可以上传本地图片，也可以粘贴网上的图片地址。
    </div>
    <div class="img-pick">
      <div class="img-preview" id="img-preview">${cur ? `<img src="${esc(cur)}" alt="">` : '<span class="muted">暂无图片</span>'}</div>
      <div class="img-pick-side">
        <input type="file" id="img-file" accept="image/*" style="display:none">
        <button class="btn btn-primary" id="img-choose" type="button">📁 选择本地图片</button>
        <div class="muted" style="font-size:11px;margin-top:6px">支持 png / jpg / gif / webp</div>
        <div class="field" style="margin-top:12px;margin-bottom:0">
          <label>或粘贴图片地址</label>
          <input id="img-url" value="${esc(cur)}" placeholder="https://....jpg" style="width:100%">
        </div>
      </div>
    </div>
    <div class="spread" style="margin-top:16px">
      <button class="btn btn-danger" id="img-clear" type="button">移除图片</button>
      <div class="row" style="gap:8px">
        <button class="btn" data-close="1">取消</button>
        <button class="btn btn-primary" id="img-save">保存</button>
      </div>
    </div>`,
  });
  const body = m.el.querySelector('.modal-body');
  bindClose(body, m);
  let pending = '';
  const preview = body.querySelector('#img-preview');
  const urlInput = body.querySelector('#img-url');
  const redraw = () => {
    preview.innerHTML = pending ? `<img src="${pending}" alt="">`
      : (urlInput.value.trim() ? `<img src="${esc(urlInput.value.trim())}" alt="">` : '<span class="muted">暂无图片</span>');
  };

  body.querySelector('#img-choose').addEventListener('click', () => body.querySelector('#img-file').click());
  body.querySelector('#img-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('请选择图片文件');
    if (f.size > 6 * 1024 * 1024) return toast('图片过大（上限 6MB）');
    fileToDataURL(f).then((dataUrl) => { pending = dataUrl; urlInput.value = ''; redraw(); });
  });
  urlInput.addEventListener('input', () => { pending = ''; redraw(); });

  body.querySelector('#img-clear').addEventListener('click', async () => {
    try {
      await updateCompetitor(p.id, { image_url: '' });
      m.close(); toast('已移除主图'); doRender(document.getElementById('pageContent'));
    } catch (e) { toast(e.message); }
  });

  body.querySelector('#img-save').addEventListener('click', async () => {
    const urlVal = urlInput.value.trim();
    if (!pending && !urlVal) return toast('请选择图片或填写图片地址');
    const btn = body.querySelector('#img-save');
    try {
      btn.disabled = true; btn.textContent = '保存中…';
      const finalUrl = pending ? pending : urlVal;
      await updateCompetitor(p.id, { image_url: finalUrl });
      m.close(); toast('主图已保存'); doRender(document.getElementById('pageContent'));
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = '保存'; }
  });
}

/* ---------------- 行内「⋯」菜单 ---------------- */

function closeRowMenu() {
  const old = document.getElementById('row-menu');
  if (old) old.remove();
}

function openRowMenu(anchor, p) {
  if (!p) return;
  closeRowMenu();
  const items = [
    { act: 'detail', label: '📄 查看详情页' },
    { act: 'hist', label: '📈 历史数据' },
    { act: 'edit', label: '✏️ 改资料' },
    ...(p.type === 'own'
      ? [{ act: 'link', label: '🔗 从已有竞品中添加' }, { act: 'del', label: '🗑 删除这个自家产品', danger: true }]
      : [{ act: 'unlink', label: '↩️ 移出本组（保留产品）' }, { act: 'del', label: '🗑 删除这个竞品', danger: true }])
  ];

  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.id = 'row-menu';
  menu.innerHTML =
    `<div class="row-menu-head">${p.type === 'own' ? '自家' : '竞品'} · ${esc(p.title || p.asin || '未命名')}</div>` +
    items.map(it => `<button class="row-menu-item${it.danger ? ' danger' : ''}" data-act="${it.act}">${it.label}</button>`).join('');
  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';

  const off = (ev) => {
    if (!menu.contains(ev.target)) { closeRowMenu(); document.removeEventListener('click', off); }
  };
  setTimeout(() => document.addEventListener('click', off), 0);

  menu.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    const act = btn.dataset.act;
    closeRowMenu();
    if (act === 'detail') { if (_ctx) _ctx.navigate('competitor:detail:' + p.id); return; }
    if (act === 'hist') return openHistoryModal(p, 'p-' + p.id);
    if (act === 'edit') return openProductModal(p);
    if (act === 'link') return openLinkModal(all, p);
    if (act === 'unlink') {
      try { await updateCompetitor(p.id, { linked_own_id: null }); toast('已解除关联'); doRender(document.getElementById('pageContent')); }
      catch (e) { toast(e.message); }
      return;
    }
    if (act === 'del') {
      const name = p.title || p.asin || '未命名';
      const kids = p.type === 'own' ? all.filter(x => String(x.linked_own_id) === String(p.id)) : [];
      const extra = kids.length
        ? `\n\n注意：它下面的 ${kids.length} 个竞品不会被删除，会各自变成独立卡片。`
        : '';
      if (!confirm(`确认删除「${name}」及其全部历史记录？${extra}`)) return;
      try { await removeCompetitor(p.id); toast('已删除'); doRender(document.getElementById('pageContent')); }
      catch (e) { toast(e.message); }
    }
  }));
}

/* ---------------- 添加 / 编辑产品 ---------------- */

function openProductModal(p) {
  const isEdit = !!p;
  const v = (k) => (p && p[k] != null ? p[k] : '');
  const storeVal = (p && p.store) ? p.store : 'ZOWOO';
  const linkVal = isEdit ? (p.url || p.asin || '') : '';

  const ownOptions = all.filter(x => x.type === 'own' && (!p || String(x.id) !== String(p.id)));
  const linkOwnHtml = (!isEdit || (p && p.type === 'competitor')) && ownOptions.length
    ? `<div class="field" style="margin-bottom:12px"><label>关联到自家产品（可选）</label>
        <select id="p-own">
          <option value="">— 不关联 —</option>
          ${ownOptions.map(o => `<option value="${o.id}" ${p && String(p.linked_own_id) === String(o.id) ? 'selected' : ''}>${esc(o.title || o.asin)}</option>`).join('')}
        </select>
      </div>`
    : '';

  const m = openModal({
    title: isEdit ? '编辑产品' : '添加产品',
    body: `
    <div class="field" style="margin-bottom:12px">
      <label>链接 / URL *</label>
      <input id="p-asin" value="${esc(linkVal)}" placeholder="粘贴亚马逊链接或 ASIN" style="width:100%">
    </div>
    <div class="form-row">
      <div class="field"><label>品名</label><input id="p-title" value="${esc(v('title'))}" placeholder="如 蓝牙音箱 Pro"></div>
      <div class="field" style="flex:0 0 130px"><label>类型</label>
        <select id="p-type"><option value="own" ${p && p.type === 'own' ? 'selected' : ''}>自家</option><option value="competitor" ${!p || p.type === 'competitor' ? 'selected' : ''}>竞品</option></select>
      </div>
    </div>
    <div class="form-row">
      <div class="field"><label>店铺</label><select id="p-store">${STORES.map(s => `<option value="${s}" ${s === storeVal ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>站点</label><input id="p-mp" value="${esc(v('marketplace'))}" placeholder="US / UK / JP / AE"></div>
      <div class="field"><label>类目</label><input id="p-cat" value="${esc(v('category'))}" placeholder="可空"></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label>主图（可选）</label>
      <div class="row" style="gap:8px">
        <input id="p-image" value="${esc(v('image_url'))}" placeholder="粘贴图片链接，或点右侧按钮上传" style="flex:1">
        <button class="btn" id="p-img-btn" type="button">📁 上传</button>
        <input type="file" id="p-img-file" accept="image/*" style="display:none">
      </div>
    </div>
    ${linkOwnHtml}
    <div class="spread">
      <button class="btn" data-close="1">取消</button>
      <button class="btn btn-primary" id="p-save">${isEdit ? '保存' : '添加'}</button>
    </div>`,
  });
  const body = m.el.querySelector('.modal-body');
  bindClose(body, m);
  const imgInput = body.querySelector('#p-image');
  const fileInput = body.querySelector('#p-img-file');
  body.querySelector('#p-img-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast('请选择图片文件');
    if (f.size > 6 * 1024 * 1024) return toast('图片过大（上限 6MB）');
    const btn = body.querySelector('#p-img-btn');
    try {
      btn.disabled = true; btn.textContent = '上传中…';
      const dataUrl = await fileToDataURL(f);
      imgInput.value = dataUrl;
      btn.textContent = '✅ 已上传';
      setTimeout(() => { btn.disabled = false; btn.textContent = '📁 上传'; }, 1500);
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = '📁 上传';
    }
  });

  body.querySelector('#p-save').addEventListener('click', async () => {
    const raw = body.querySelector('#p-asin').value.trim();
    if (!raw) { toast('链接/URL 必填'); return; }
    const ownSel = body.querySelector('#p-own');
    const b = {
      asin: raw,
      url: raw,
      title: body.querySelector('#p-title').value.trim(),
      type: body.querySelector('#p-type').value,
      store: body.querySelector('#p-store').value,
      marketplace: body.querySelector('#p-mp').value.trim(),
      category: body.querySelector('#p-cat').value.trim(),
      image_url: body.querySelector('#p-image').value.trim()
    };
    if (ownSel) b.linked_own_id = ownSel.value ? String(ownSel.value) : null;
    try {
      if (isEdit) await updateCompetitor(p.id, b);
      else await addCompetitor(b);
      m.close();
      toast(isEdit ? '已保存' : '已添加');
      doRender(document.getElementById('pageContent'));
    } catch (e) { toast(e.message); }
  });
}

/* ---------------- 直接在卡片里添加竞品（粘贴链接即建） ---------------- */

async function addCompetitorToGroup(own, raw, title, allList) {
  if (!own) throw new Error('找不到自家产品');
  const hit = allList.find(p => p.asin === raw || (p.url && p.url === raw));
  if (hit) {
    if (String(hit.id) === String(own.id)) throw new Error('不能把自家链接加成竞品');
    if (String(hit.linked_own_id) === String(own.id)) throw new Error('这个链接已经在本组里了');
    await updateCompetitor(hit.id, { linked_own_id: String(own.id), ...(title ? { title } : {}) });
    return hit;
  }
  return addCompetitor({
    asin: raw,
    url: raw,
    title,
    type: 'competitor',
    store: own.store || '',
    marketplace: own.marketplace || '',
    linked_own_id: String(own.id)
  });
}

/* ---------------- 关联竞品（从已有竞品里勾选） ---------------- */

function openLinkModal(products, own) {
  if (!own) return;
  const linked = products.filter(p => String(p.linked_own_id) === String(own.id));
  const candidates = products.filter(p => p.type === 'competitor');
  if (!candidates.length) return toast('还没有竞品，请先添加竞品产品');

  const chips = candidates.map(c => {
    const on = String(c.linked_own_id) === String(own.id);
    return `<span class="chip ${on ? 'active' : ''}" data-cid="${c.id}">${esc(c.title || c.asin)} <small class="muted">${esc(c.store || '')}</small></span>`;
  }).join('');

  const m = openModal({
    title: `把已有竞品加入「${esc(own.title || own.asin)}」`,
    body: `
    <div class="muted" style="font-size:12px;margin-bottom:12px">点一下勾选 / 取消。已在本组 ${linked.length} 个。新增竞品请直接在卡片下方粘贴链接。</div>
    <div class="chips" id="link-chips" style="margin-bottom:16px">${chips}</div>
    <div class="spread">
      <button class="btn" data-close="1">取消</button>
      <button class="btn btn-primary" id="link-save">保存关联</button>
    </div>`,
  });
  const body = m.el.querySelector('.modal-body');
  bindClose(body, m);
  body.querySelectorAll('#link-chips .chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });
  body.querySelector('#link-save').addEventListener('click', async () => {
    try {
      for (const chip of body.querySelectorAll('#link-chips .chip')) {
        const id = chip.dataset.cid;
        const shouldLink = chip.classList.contains('active');
        const prod = products.find(x => String(x.id) === String(id));
        const isLinked = prod && String(prod.linked_own_id) === String(own.id);
        if (shouldLink && !isLinked) await updateCompetitor(id, { linked_own_id: String(own.id) });
        if (!shouldLink && isLinked) await updateCompetitor(id, { linked_own_id: null });
      }
      m.close(); toast('关联已更新'); doRender(document.getElementById('pageContent'));
    } catch (e) { toast(e.message); }
  });
}
