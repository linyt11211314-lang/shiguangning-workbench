/* 关键词搜索位置：竞品追踪模块共用（产品库卡片 + 详情页） */
import { esc } from '../utils.js';
import { openModal } from './modal.js';
import { toast, toastInfo } from './toast.js';
import { todayStr } from './competitorUtil.js';
import { kwListOf, batchSnapshots } from '../store/competitorStore.js';

// 供产品库卡片 / 详情页使用（与追踪站 kwList 同名）
export const kwList = kwListOf;

/** 排名数字 → 「第X页 · Y/48位」 */
export function rankPos(rank) {
  if (rank == null) return '<span class="muted">未记录</span>';
  if (rank <= 0) return '<span class="muted">未上榜</span>';
  const page = Math.ceil(rank / 48), pos = ((rank - 1) % 48) + 1;
  return `第${page}页 · <b>${pos}/48</b>位 <span class="muted kw-abs">总第${rank}位</span>`;
}

/** 关键词面板 HTML（展开在某行下方） */
export function kwPanelHtml(p, s, kws, kwsPrev, groupKey) {
  const prevMap = new Map(kwsPrev.filter((x) => x.rank != null).map((x) => [x.kw, x.rank]));
  const body = kws.length
    ? `<table class="kw-table">
        <thead><tr><th>关键词</th><th>自然排名</th><th>较上次</th></tr></thead>
        <tbody>${kws.map((x) => {
          const prevRank = prevMap.get(x.kw);
          const inPrev = kwsPrev.some((y) => y.kw === x.kw);
          let delta;
          if (!inPrev) delta = '<span class="muted">新增</span>';
          else if (x.rank != null && prevRank != null) {
            const d = prevRank - x.rank;
            if (d > 0) delta = `<span class="kw-up">↑ ${d} 位</span>`;
            else if (d < 0) delta = `<span class="kw-down">↓ ${-d} 位</span>`;
            else delta = '<span class="muted">持平</span>';
          } else delta = '<span class="muted">—</span>';
          return `<tr><td class="kw-word">${esc(x.kw)}</td><td>${rankPos(x.rank)}</td><td>${delta}</td></tr>`;
        }).join('')}</tbody>
      </table>`
    : `<div class="kw-empty">该日未记录关键词。点右侧「编辑」录入：每行一个关键词 + 自然排名。</div>`;
  return `<div class="kw-panel" data-kwpanel="${p.id}">
    <div class="kw-head">
      <span>🔍 关键词搜索位置 <span class="muted">· ${esc(s.date)}${kws.length ? ` · ${kws.length} 词` : ''}</span></span>
      <span>
        <button class="btn btn-sm" data-kwedit="${p.id}" data-date="${s.date || ''}" data-group="${groupKey}">✏️ 编辑</button>
        <button class="btn btn-sm" data-kw="${p.id}" data-group="${groupKey}">收起</button>
      </span>
    </div>
    ${body}
  </div>`;
}

/** 编辑某产品某天的关键词排名。refresh = 保存成功后重绘回调 */
export function openKwEditModal(p, date, refresh) {
  if (!p) return;
  const d = date || todayStr();
  const snap = (p.snapshots || []).find((s) => s.date === d) || null;
  const cur = kwListOf(snap || {});
  const prefill = cur.map((x) => (x.rank != null ? `${x.kw}, ${x.rank}` : x.kw)).join('\n');
  const m = openModal({
    title: `🔍 关键词排名 · ${p.title || p.asin}`,
    body: `
      <div class="muted" style="font-size:13px;margin-bottom:10px;line-height:1.6">
        每行一个关键词，格式：<b>关键词, 自然排名数字</b>（只写关键词不给排名也可以）。<br>
        排名 = 在亚马逊搜索结果里的总自然位次，如 <b>72</b> = 第2页 · 24/48位。留空则清空该日关键词。
      </div>
      <textarea id="kw-edit" class="kw-edit-area" placeholder="magnetic ring for phone, 72&#10;phone holder desk, 130&#10;mag.safe ring">${esc(prefill)}</textarea>
      <div class="spread" style="margin-top:14px">
        <button class="btn" id="kw-cancel">取消</button>
        <button class="btn btn-primary" id="kw-save">保存到 ${d}</button>
      </div>`,
  });
  const body = m.el.querySelector('.modal-body');
  body.querySelector('#kw-cancel').addEventListener('click', m.close);
  body.querySelector('#kw-save').addEventListener('click', async () => {
    const lines = body.querySelector('#kw-edit').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const arr = [];
    for (const line of lines) {
      const mm = line.match(/^(.+?)[,，=\t]\s*(\d+)\s*$/);
      if (mm) arr.push({ kw: mm[1].trim(), rank: Math.round(parseFloat(mm[2])) });
      else arr.push({ kw: line, rank: null });
    }
    if (!arr.length && cur.length && !confirm('内容为空，将清空 ' + d + ' 的关键词记录，继续？')) return;
    try {
      batchSnapshots({ date: d, rows: [{ id: p.id, traffic_keywords: arr }] });
      m.close();
      toastInfo(arr.length ? `已保存 ${arr.length} 个关键词` : '已清空该日关键词');
      if (typeof refresh === 'function') refresh();
    } catch (e) { toast(e.message); }
  });
}
