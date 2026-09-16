/**
 * 竞品追踪 · 产品详情页
 * 纯客户端架构：数据走 competitorStore；复用 competitorChart / competitorKw / openFillModal。
 */
import { fmtMoney, fmtNum, stockTag, storeTag, diffArrow, diffClass, todayStr, productLink } from '../ui/competitorUtil.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { esc } from '../utils.js';
import { listCompetitors, getCompetitor, getSnapshots, deleteSnapshot } from '../store/competitorStore.js';
import { renderLineChart } from '../ui/competitorChart.js';
import { kwList, openKwEditModal } from '../ui/competitorKw.js';
import { openFillModal } from './competitor.js';

let _dctx = null;
let _container = null;
let _route = null;

function bindClose(body, m) {
  body.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', m.close));
}

export async function render(container, route, ctx) {
  _dctx = ctx || null;
  _container = container;
  _route = route;
  const id = parseId(route);
  await renderDetail(id);
}

function parseId(route) {
  if (route && route.startsWith('competitor:detail:')) return route.slice('competitor:detail:'.length);
  const parts = (route || '').split(':');
  return parts[2] || '';
}

function renderDetail(id) {
  const container = _container;
  const product = getCompetitor(id);
  const snaps = getSnapshots(id);
  const all = listCompetitors();
  if (!product) { container.innerHTML = `<div class="ct-page"><div class="empty">产品不存在</div></div>`; return; }

  const who = product.type === 'own' ? '<span class="tag tag-own">自家</span>' : '<span class="tag tag-comp">竞品</span>';
  const latest = snaps.length ? snaps[snaps.length - 1] : {};
  const trackedToday = latest.date === todayStr();
  const trackTag = trackedToday
    ? '<span class="tag tag-good">今日已跟踪</span>'
    : '<span class="tag tag-warn">今日未跟踪</span>';
  const thumb = product.image_url
    ? `<img src="${esc(product.image_url)}" class="thumb" style="width:64px;height:64px" alt="">`
    : `<div class="thumb-placeholder" style="width:64px;height:64px">无图</div>`;

  let groupBadge = '';
  let groupHint = '';
  if (product.type === 'own') {
    const comps = all.filter(p => String(p.linked_own_id) === String(product.id));
    if (comps.length) {
      groupBadge = `<span class="tag" style="background:#eef2ff;color:var(--primary)">已关联 ${comps.length} 个竞品</span>`;
      groupHint = `<div class="hint" style="margin-top:8px">当前为追踪组主产品，已绑定 ${comps.length} 个竞品。下方「同组竞品对比」可并排查看最新数据。</div>`;
    }
  } else if (product.linked_own_id) {
    const parent = all.find(p => String(p.id) === String(product.linked_own_id));
    if (parent) {
      groupBadge = `<span class="tag" style="background:#f0fdf4;color:#15803d">归属：${esc(parent.title || parent.asin)}</span>`;
      groupHint = `<div class="hint" style="margin-top:8px">该竞品已关联到自家产品「${esc(parent.title || parent.asin)}」，可去「竞品追踪」或点下方按钮查看同组对比。</div>`;
    }
  }

  const header = `
    <div class="spread" style="margin-bottom:14px">
      <div class="row" style="gap:12px;align-items:flex-start">
        ${thumb}
        <div>
          <div class="row" style="gap:8px;margin-bottom:4px">${who} ${storeTag(product.store)} ${trackTag} ${groupBadge}</div>
          <strong style="font-size:16px">${esc(product.title || '未命名品名')}</strong>
          <div class="muted">${productLink(product, { label: '打开亚马逊链接' })} · ${esc(product.marketplace || '')} ${esc(product.category || '')}</div>
          ${groupHint}
        </div>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn btn-sm" id="back-list">← 竞品追踪</button>
        <button class="btn btn-primary btn-sm" id="add-snap">＋ 录入快照</button>
      </div>
    </div>`;

  // 图表
  const mkSeries = (key, label) => ({
    name: label,
    points: snaps.filter(s => s[key] != null).map(s => ({ x: s.date, y: s[key] }))
  });
  const charts = `
    <div class="grid grid-2">
      <div class="card"><h3>价格趋势 ($)</h3><div id="c-price" class="chart-wrap"></div></div>
      <div class="card"><h3>BSR 排名趋势（越低越好）</h3><div id="c-bsr" class="chart-wrap"></div></div>
      <div class="card"><h3>评分趋势</h3><div id="c-rating" class="chart-wrap"></div></div>
      <div class="card"><h3>评论数趋势</h3><div id="c-review" class="chart-wrap"></div></div>
    </div>`;

  // 快照表（含环比）
  let table;
  if (!snaps.length) {
    table = `<div class="empty">尚未录入快照。每天点击「＋ 录入快照」记录价格/BSR/评论等数据，即可持续跟踪竞品变化并生成趋势图。</div>`;
  } else {
    const sorted = [...snaps].sort((a, b) => (a.date < b.date ? 1 : -1));
    table = `<table class="ct-snap-table">
      <thead><tr><th>日期</th><th>价格</th><th>券%</th><th>BSR</th><th>评论</th><th>评分</th><th>库存</th><th>流量词</th><th></th></tr></thead>
      <tbody>${sorted.map((s, i) => {
        const prev = sorted[i + 1];
        const dCell = (k, metric) => {
          if (!prev) return '<td>—</td>';
          const dv = s[k] != null && prev[k] != null ? Math.round((s[k] - prev[k]) * 1000) / 1000 : null;
          if (dv == null) return '<td class="muted">—</td>';
          return `<td class="${diffClass(metric, dv)}">${s[k]} <small>${diffArrow(dv)}</small></td>`;
        };
        const kwCount = s.traffic_keywords && Array.isArray(s.traffic_keywords) ? s.traffic_keywords.length : 0;
        return `<tr>
          <td>${s.date}</td>
          ${dCell('price', 'price')}
          <td>${s.coupon != null ? s.coupon : '—'}</td>
          ${dCell('bsr', 'bsr')}
          ${dCell('review_count', 'review_count')}
          ${dCell('rating', 'rating')}
          <td>${stockTag(s.stock_status, s.stock_qty)}</td>
          <td>${kwCount ? `<button class="dlink" data-kweditdate="${s.date}">${kwCount} 词</button>` : '<span class="muted">—</span>'}</td>
          <td><button class="btn btn-sm btn-danger" data-del="${s.date}">删</button></td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  let groupCompare = '';
  if (product.type === 'own') {
    const comps = all.filter(p => String(p.linked_own_id) === String(product.id));
    if (comps.length) {
      const cols = [product, ...comps];
      groupCompare = `
        <div class="card" style="margin-top:16px">
          <h3>同组竞品对比（最新快照）</h3>
          <div class="chart-wrap">
            <table class="ct-snap-table">
              <thead><tr><th>指标</th>${cols.map(c => `<th>${c.type === 'own' ? '【自家】' : ''}${esc(c.title || c.asin)}<br><small class="muted">${esc(c.marketplace || '')}</small></th>`).join('')}</tr></thead>
              <tbody>
                <tr><td>价格</td>${cols.map(c => `<td>${fmtMoney((c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).price)}</td>`).join('')}</tr>
                <tr><td>BSR</td>${cols.map(c => `<td>${fmtNum((c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).bsr)}</td>`).join('')}</tr>
                <tr><td>评分</td>${cols.map(c => `<td>${((c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).rating != null) ? (c.snapshots[c.snapshots.length - 1] || {}).rating : '—'}</td>`).join('')}</tr>
                <tr><td>评论</td>${cols.map(c => `<td>${fmtNum((c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).review_count)}</td>`).join('')}</tr>
                <tr><td>库存</td>${cols.map(c => `<td>${stockTag((c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).stock_status, (c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).stock_qty)}</td>`).join('')}</tr>
                <tr><td>最近记录</td>${cols.map(c => `<td class="muted">${(c.snapshots && c.snapshots[c.snapshots.length - 1] || {}).date || '—'}</td>`).join('')}</tr>
              </tbody>
            </table>
          </div>
        </div>`;
    }
  }

  // 关键词搜索位置追踪（关键词 × 日期 矩阵，越靠左越新）
  let kwSection = '';
  const kwSnaps = [...snaps].filter(s => kwList(s).length).sort((a, b) => (a.date < b.date ? 1 : -1));
  if (kwSnaps.length) {
    const cols = kwSnaps.slice(0, 6);
    const rankOf = (snap, kw) => {
      const x = kwList(snap).find(y => y.kw === kw);
      return x ? x.rank : undefined;
    };
    const seen = new Set();
    const kwOrder = [];
    cols.forEach(c => kwList(c).forEach(x => { if (!seen.has(x.kw)) { seen.add(x.kw); kwOrder.push(x.kw); } }));
    const latestRanks = new Map(kwList(cols[0]).filter(x => x.rank != null).map(x => [x.kw, x.rank]));
    kwOrder.sort((a, b) => {
      const ra = latestRanks.has(a) ? latestRanks.get(a) : Infinity;
      const rb = latestRanks.has(b) ? latestRanks.get(b) : Infinity;
      return ra - rb;
    });

    const bodyRows = kwOrder.map(kw => {
      const cells = cols.map((c, i) => {
        const r = rankOf(c, kw);
        if (r === undefined) return '<td class="muted">—</td>';
        let delta = '';
        for (let j = i + 1; j < cols.length; j++) {
          const pr = rankOf(cols[j], kw);
          if (pr === undefined) continue;
          if (pr != null && r != null) {
            const d = pr - r;
            delta = d > 0 ? `<span class="kw-up">↑${d}</span>` : (d < 0 ? `<span class="kw-down">↓${-d}</span>` : '<span class="muted">持平</span>');
          }
          break;
        }
        const title = r != null ? `第${Math.ceil(r / 48)}页 · ${((r - 1) % 48) + 1}/48位 · 总第${r}位` : '未记录排名';
        return `<td title="${title}">${r != null ? r : '<span class="muted">无排名</span>'} ${delta}</td>`;
      }).join('');
      return `<tr><td class="kw-word">${esc(kw)}</td>${cells}</tr>`;
    }).join('');

    kwSection = `
      <div class="card" style="margin-top:16px">
        <div class="spread" style="margin-bottom:6px">
          <h3 style="margin:0">🔍 关键词搜索位置追踪</h3>
          <button class="btn btn-sm" id="kw-edit-latest" data-kweditdate="${cols[0].date}">✏️ 编辑 ${cols[0].date}</button>
        </div>
        <div class="muted" style="font-size:12.5px;margin-bottom:8px">
          数字 = 亚马逊自然搜索总位次（每页约 48 个自然位，悬停看分页换算）。<span class="kw-up">↑红</span> = 升位、<span class="kw-down">↓绿</span> = 降位，与左侧更近一次记录比。点日期可编辑当天关键词。
        </div>
        <table class="kw-table kw-matrix">
          <thead><tr><th>关键词</th>${cols.map(c => `<th><button class="dlink" data-kweditdate="${c.date}">${c.date}</button></th>`).join('')}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
        ${kwSnaps.length > 6 ? `<div class="muted" style="font-size:12px;margin-top:6px">仅显示最近 6 个记录日，共 ${kwSnaps.length} 天有关键词记录。</div>` : ''}
      </div>`;
  }

  container.innerHTML = `<div class="ct-page">${header}${charts}${groupCompare}${kwSection}<div class="card" style="margin-top:16px"><h3>快照记录（共 ${snaps.length} 条）</h3>${table}</div></div>`;

  // 渲染图表
  renderLineChart(container.querySelector('#c-price'), { series: [mkSeries('price', '价格')], valueFmt: (v) => '$' + v });
  renderLineChart(container.querySelector('#c-bsr'), { series: [mkSeries('bsr', 'BSR')] });
  renderLineChart(container.querySelector('#c-rating'), { series: [mkSeries('rating', '评分')], valueFmt: (v) => v });
  renderLineChart(container.querySelector('#c-review'), { series: [mkSeries('review_count', '评论')] });

  // 返回列表
  container.querySelector('#back-list').addEventListener('click', () => { if (_dctx) _dctx.navigate('competitor'); });

  // 录入快照
  container.querySelector('#add-snap').addEventListener('click', () => {
    openFillModal({ target: product, products: all, date: todayStr(), groupKey: 'p-' + id, refresh: () => renderDetail(id) });
  });

  // 删除快照
  container.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('删除该条快照？')) return;
    try { await deleteSnapshot(id, btn.dataset.del); toast('已删除'); renderDetail(id); }
    catch (e) { toast(e.message); }
  }));

  // 编辑某天的关键词排名
  container.querySelectorAll('[data-kweditdate]').forEach(b => b.addEventListener('click', () => {
    openKwEditModal(product, b.dataset.kweditdate, () => renderDetail(id));
  }));
}
