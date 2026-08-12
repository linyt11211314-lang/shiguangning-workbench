/**
 * 选品库页面：产品素材管理，一键导入 AI Listing 工坊
 * 三大分类（列表）：牛马人 / 昭梧 / 沣洋，产品可在分类间复制、移动。
 */
import { icon } from '../ui/icons.js';
import { esc, normalizeUrl, formatDate, fileToDataURL, extractImageFromEvent, uid } from '../utils.js';
import { listProducts, getProduct, addProductTracked, updateProductTracked, removeProductTracked } from '../store/productStore.js';
import { getSettings } from '../store/settingsStore.js';
import { AMAZON_SITES, PER_SITE_RATES, CATEGORIES, CATEGORY_IDS, categoryLabel, PRICE_TIERS, PRICE_TIER_IDS, priceTierById, MAX_IMAGES, MAX_IMAGE_MB, ALLOWED_IMAGE_TYPES } from '../config.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { calculateQuote, DEFAULT_QUOTE, quickQuote, calcChargeableWeight } from '../services/pricing.js';
import { exportProductsExcel, importProductsExcel } from '../services/productTransfer.js';

let filter = '';
let currentPage = 0;
let selectedIds = new Set();
let currentCategory = CATEGORIES[0].id;

/* ---------------- 复制 / 移动 ---------------- */
function copyProductTo(id, targetCat) {
  const p = getProduct(id);
  if (!p) return;
  const { id: _id, ...rest } = p;
  addProductTracked({ ...rest, category: targetCat });
  toastSuccess(`已复制到「${categoryLabel(targetCat)}」`);
}
function moveProductTo(id, targetCat) {
  const p = getProduct(id);
  if (!p) return;
  const { id: _id, ...rest } = p;
  removeProductTracked(id);
  addProductTracked({ ...rest, category: targetCat });
  toastSuccess(`已移动到「${categoryLabel(targetCat)}」`);
}

/* ---------------- 下拉菜单（复制/移动到哪个分类） ---------------- */
let activeMenu = null;
function closeCategoryMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  document.removeEventListener('click', onDocClickClose, true);
}
function onDocClickClose(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeCategoryMenu();
}
function openCategoryMenu(anchor, heading, excludeId, onPick) {
  closeCategoryMenu();
  const menu = document.createElement('div');
  menu.className = 'menu-pop';
  menu.innerHTML = `
    <div class="menu-pop-head">${esc(heading)}</div>
    ${CATEGORIES.filter((c) => c.id !== excludeId).map((c) => `
      <div class="menu-pop-item" data-cat="${c.id}">${esc(c.label)}</div>`).join('')}
  `;
  document.body.appendChild(menu);
  activeMenu = menu;
  const r = anchor.getBoundingClientRect();
  const mw = 170, mh = 96;
  let top = r.bottom + 6;
  let left = r.left;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, left) + 'px';
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = el.dataset.cat;
      closeCategoryMenu();
      onPick(target);
    });
  });
  setTimeout(() => document.addEventListener('click', onDocClickClose, true), 0);
}
function openMenuForProduct(id, type, anchorEl) {
  const p = getProduct(id);
  if (!p) return;
  const anchor = anchorEl || container.querySelector(`.lib-table-row[data-id="${id}"]`) || container;
  openCategoryMenu(anchor, type === 'copy' ? '复制到...' : '移动到...', p.category, (targetCat) => {
    if (type === 'copy') copyProductTo(id, targetCat);
    else moveProductTo(id, targetCat);
  });
}

export function render(container, { navigate, rerender }) {
  currentPage = 0;
  const products = listProducts();
  const counts = {};
  CATEGORIES.forEach((c) => { counts[c.id] = products.filter((p) => p.category === c.id).length; });
  const total = products.length;

  const tabsHtml = CATEGORIES.map((c) => `
    <button class="cat-tab ${c.id === currentCategory ? 'active' : ''}" data-tab="${c.id}">
      <span>${esc(c.label)}</span>
      <span class="badge">${counts[c.id]}</span>
    </button>`).join('');

  container.innerHTML = `
    <div class="cat-tabs">
      ${tabsHtml}
      <span class="topbar-spacer"></span>
      <button class="btn btn-primary" data-add>${icon('plus')} 添加产品</button>
      <button class="btn btn-ghost" data-export>${icon('file')} 导出 Excel</button>
      <button class="btn btn-soft" data-import-excel>${icon('upload')} 导入 Excel</button>
    </div>

    <div class="card" style="padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div class="flex-1" style="position:relative;min-width:220px">
        <span class="search-icon">${icon('search')}</span>
        <input class="input" data-search placeholder="搜索产品名称 / 类目 / 1688链接..." style="padding-left:38px;background:var(--card-soft)">
      </div>
      <button class="btn btn-danger-soft" data-bulk-del style="display:none" title="批量删除所选产品">${icon('trash')} 删除所选(<span data-bulk-count>0</span>)</button>
    </div>

    <div data-grid></div>
    <input type="file" accept=".xlsx,.xls" data-excel-file hidden>
  `;

  // 分类 Tab 切换
  container.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentCategory = tab.dataset.tab;
      rerender();
    });
  });

  container.querySelector('[data-search]').addEventListener('input', (e) => {
    filter = e.target.value.trim().toLowerCase();
    renderGrid();
  });
  container.querySelector('[data-add]').addEventListener('click', () => openProductModal(null, rerender));

  // ---------- 导出 Excel ----------
  container.querySelector('[data-export]').addEventListener('click', () => {
    try {
      const n = exportProductsExcel();
      toastSuccess(`已导出 ${n} 个产品（Excel）`);
    } catch (e) {
      toastError(e.message || '导出失败');
    }
  });

  // ---------- 导入 Excel ----------
  const fileInput = container.querySelector('[data-excel-file]');
  container.querySelector('[data-import-excel]').addEventListener('click', () => {
    confirmDialog({
      title: '导入 Excel 产品',
      message: '请使用「导出 Excel」生成的同一模板（含表头）填写产品数据后导入。\n\n产品名称必填；报价列可留空，系统将按成本/尺寸重量自动重新测算。\n带「分类」列时按列归类，否则归入当前分类「' + categoryLabel(currentCategory) + '」。',
      confirmText: '选择文件',
      onConfirm: () => fileInput.click(),
    });
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { count, skipped } = await importProductsExcel(file, currentCategory);
      if (count > 0) {
        toastSuccess(`成功导入 ${count} 个产品${skipped ? `，跳过 ${skipped} 行（缺产品名称）` : ''}`);
        rerender();
      } else if (skipped > 0) {
        toastError(`导入失败：${skipped} 行均缺少产品名称`);
      } else {
        toastInfo('未解析到有效产品数据');
      }
    } catch (e) {
      toastError(`导入失败：${e.message}`);
    }
  });

  // 快捷键：选中单个产品后 Ctrl+C 复制 / Ctrl+X 移动
  if (!container.__libKeyBound) {
    container.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if ((k === 'c' || k === 'x') && selectedIds.size === 1) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const id = [...selectedIds][0];
        openMenuForProduct(id, k === 'c' ? 'copy' : 'move');
      }
    });
    container.__libKeyBound = true;
  }

  function updateBulkBar() {
    const btn = container.querySelector('[data-bulk-del]');
    if (!btn) return;
    const count = selectedIds.size;
    btn.style.display = count > 0 ? 'inline-flex' : 'none';
    const span = btn.querySelector('[data-bulk-count]');
    if (span) span.textContent = count;
  }

  function renderGrid() {
    const grid = container.querySelector('[data-grid]');
    let list = products.filter((p) => p.category === currentCategory);
    if (filter) {
      list = list.filter((p) =>
        `${p.name} ${p.productCategory} ${p.supply1688} ${p.description}`.toLowerCase().includes(filter));
    }
    // 清理已不存在的选中项
    const validIds = new Set(list.map((p) => p.id));
    selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));

    if (!list.length) {
      grid.innerHTML = `
        <div class="card"><div class="empty-state">
          <div class="empty-icon" style="font-size:34px">📭</div>
          <div class="empty-title">${filter ? '没有匹配的产品' : '该分类暂无产品'}</div>
          <div class="empty-sub">${filter ? '换个关键词试试' : '点击「添加产品」或导入 Excel 添加'}</div>
          ${filter ? '' : '<div class="mt-12"><button class="btn btn-primary" data-add2>添加产品</button></div>'}
        </div></div>`;
      const add2 = grid.querySelector('[data-add2]');
      if (add2) add2.addEventListener('click', () => openProductModal(null, rerender));
      updateBulkBar();
      return;
    }

    const allChecked = list.every((p) => selectedIds.has(p.id));

    grid.innerHTML = `
      <div class="card" style="overflow:visible">
        <div class="lib-grid-table">
          <div class="lib-table-head">
            <label class="lib-check" title="全选"><input type="checkbox" data-check-all ${allChecked ? 'checked' : ''}></label>
            <span>产品图片</span>
            <span>产品名称</span>
            <span>采购成本</span>
            <span>产品定价</span>
            <span>规格</span>
            <span>利润总览</span>
            <span>选品时间</span>
            <span style="text-align:right">操作</span>
          </div>
          ${list.map((p) => {
          const siteInfo = AMAZON_SITES.find((s) => s.code === p.site);
          const r = quickQuote(p.quote, p.site);
          const sym = (r && r.symbol) || (siteInfo && siteInfo.symbol) || '$';
          const costText = r && r.breakdown && r.breakdown.costUsd != null ? `${sym}${r.breakdown.costUsd}` : '—';
          const priceText = r && r.price != null ? `${sym}${r.price}` : '—';
          const lwh = [p.quote && p.quote.lengthCm, p.quote && p.quote.widthCm, p.quote && p.quote.heightCm].filter((v) => v !== '' && v != null);
          const wt = p.quote && p.quote.weightG;
          const wtKg = (wt != null && wt !== '') ? Math.round((Number(wt) / 1000) * 1000) / 1000 : null;
          const wtText = wtKg != null ? `${wtKg}kg` : '';
          const sizeText = (lwh.length === 3 && wtKg != null) ? `${lwh[0]}×${lwh[1]}×${lwh[2]}cm · ${wtText}` : (lwh.length || wtKg != null ? `${lwh.join('×')}${lwh.length && wtKg != null ? ' · ' : ''}${wtText}` : '—');
          const profitText = r && r.profit != null ? `${sym}${r.profit} · ${Math.round((r.margin || 0) * 100)}%` : '—';
          const rowSel = selectedIds.has(p.id);
          return `
          <div class="lib-table-row ${rowSel ? 'selected' : ''}" data-id="${p.id}" title="点击编辑产品">
            <label class="lib-check" title="选择"><input type="checkbox" data-check="${p.id}" ${rowSel ? 'checked' : ''}></label>
            <div class="lib-thumb-sm">
              ${mainImageOf(p) ? `<img src="${esc(mainImageOf(p))}" alt="">` : `<span class="no-img-sm">${icon('image')}</span>`}
            </div>
            <div class="lib-name-cell">
              <div class="lib-name">${esc(p.name || '未命名产品')}</div>
              <div class="lib-meta" style="margin-top:4px">
                ${p.productCategory ? `<span class="tag tag-primary">${esc(p.productCategory)}</span>` : ''}
                ${(p.sites || [p.site]).map((s) => {
                  const si = AMAZON_SITES.find((x) => x.code === s);
                  return `<span class="tag tag-blue">${si ? si.flag + ' ' + s : esc(s)}</span>`;
                }).join('')}
                ${(p.supplies || []).length ? `<span class="tag" style="color:var(--amber);background:var(--amber-soft);border-color:#F3DFB0">1688 ×${p.supplies.length}</span>` : ''}
              </div>
            </div>
            <div class="lib-cell">${costText}</div>
            <div class="lib-cell price">${priceText}</div>
            <div class="lib-cell size">${sizeText}</div>
            <div class="lib-cell profit">${profitText}</div>
            <div class="lib-cell">${formatDate(p.createdAt)}</div>
            <div class="lib-actions">
              <button class="btn btn-primary btn-sm" data-import="${p.id}">${icon('sparkles')} 创建 Listing</button>
              <button class="btn btn-ghost btn-sm" data-edit="${p.id}">${icon('edit')} 编辑</button>
              <button class="btn btn-danger-soft btn-sm" data-del="${p.id}">${icon('trash')} 删除</button>
              <button class="btn btn-soft btn-sm" data-copy="${p.id}">${icon('copy')} 复制 ▾</button>
              <button class="btn btn-soft btn-sm" data-move="${p.id}">移动 ▾</button>
            </div>
          </div>`;
        }).join('')}
        </div>
      </div>`;

    const checkAll = grid.querySelector('[data-check-all]');
    checkAll.addEventListener('change', () => {
      if (checkAll.checked) list.forEach((p) => selectedIds.add(p.id));
      else selectedIds.clear();
      grid.querySelectorAll('[data-check]').forEach((cb) => { cb.checked = checkAll.checked; });
      grid.querySelectorAll('.lib-table-row').forEach((row) => {
        row.classList.toggle('selected', checkAll.checked);
      });
      updateBulkBar();
    });
    grid.querySelectorAll('[data-check]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = cb.dataset.check;
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        cb.closest('.lib-table-row').classList.toggle('selected', cb.checked);
        const all = grid.querySelectorAll('[data-check]');
        checkAll.checked = all.length > 0 && [...all].every((c) => c.checked);
        updateBulkBar();
      });
    });
    grid.querySelectorAll('.lib-table-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.lib-check')) return;
        const p = listProducts().find((x) => x.id === row.dataset.id);
        if (p) openProductModal(p, rerender);
      });
    });
    grid.querySelectorAll('[data-import]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(`listing:new:${btn.dataset.import}`);
      });
    });
    grid.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = listProducts().find((x) => x.id === btn.dataset.edit);
        if (p) openProductModal(p, rerender);
      });
    });
    grid.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = listProducts().find((x) => x.id === btn.dataset.del);
        confirmDialog({
          title: '删除产品',
          message: `确定删除「${p?.name || '该产品'}」吗？\n（不会影响已生成的 Listing 项目）`,
          confirmText: '删除',
          danger: true,
          onConfirm: () => {
            removeProductTracked(btn.dataset.del);
            toastSuccess('已删除');
            rerender();
          },
        });
      });
    });
    grid.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenuForProduct(btn.dataset.copy, 'copy', btn);
      });
    });
    grid.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenuForProduct(btn.dataset.move, 'move', btn);
      });
    });
    updateBulkBar();
  }

  // 批量删除
  const bulkBtn = container.querySelector('[data-bulk-del]');
  bulkBtn.addEventListener('click', () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const names = ids.map((id) => {
      const p = listProducts().find((x) => x.id === id);
      return p ? p.name : '未命名产品';
    }).slice(0, 5);
    const more = ids.length > 5 ? `\n…等 ${ids.length} 个产品` : '';
    confirmDialog({
      title: `批量删除（${ids.length} 个产品）`,
      message: `确定删除以下产品吗？\n${names.map((n) => `· ${n}`).join('\n')}${more}\n\n（不会影响已生成的 Listing 项目）`,
      confirmText: '全部删除',
      danger: true,
      onConfirm: () => {
        ids.forEach((id) => removeProductTracked(id));
        selectedIds.clear();
        toastSuccess(`已删除 ${ids.length} 个产品`);
        rerender();
      },
    });
  });

  renderGrid();
}

/** 取产品主图（兼容旧单图 image 与新 images 数组） */
function mainImageOf(p) {
  if (Array.isArray(p.images) && p.images.length) {
    const m = p.images.find((i) => i.isMain) || p.images[0];
    return m && m.data ? m.data : '';
  }
  return p.image || '';
}

/**
 * 多图片画廊组件（点击 / 拖拽 / Ctrl+V 粘贴上传，Base64 存储）
 * 返回 { el, getValue, setValue, setSilent }
 */
function createImageGallery({ onChange } = {}) {
  const el = document.createElement('div');
  el.className = 'img-gallery';
  el.innerHTML = `
    <div class="ig-drop" data-ig-drop>
      <div class="ig-drop-inner">
        ${icon('upload')}
        <div class="ig-title">点击上传 / 拖拽上传 / Ctrl+V 粘贴</div>
        <div class="ig-sub">支持 JPG / PNG / WebP，单张不超过 ${MAX_IMAGE_MB}MB，最多 ${MAX_IMAGES} 张</div>
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-ig-input>
    </div>
    <div class="ig-grid" data-ig-grid></div>
  `;
  const input = el.querySelector('[data-ig-input]');
  const drop = el.querySelector('[data-ig-drop]');
  const grid = el.querySelector('[data-ig-grid]');
  let images = [];

  function emit() { if (onChange) onChange(images); }
  function setImages(arr, silent) {
    images = (Array.isArray(arr) ? arr : []).map((x) => ({ id: x.id || uid('img'), data: x.data, isMain: Boolean(x.isMain) }));
    if (images.length && !images.some((i) => i.isMain)) images[0].isMain = true;
    render();
    if (!silent) emit();
  }
  function render() {
    grid.innerHTML = '';
    if (!images.length) {
      drop.style.display = '';
    } else {
      drop.style.display = 'none';
      images.forEach((img) => {
        const tile = document.createElement('div');
        tile.className = 'ig-tile' + (img.isMain ? ' is-main' : '');
        tile.innerHTML = `
          <img src="${img.data}" alt="">
          ${img.isMain ? '<span class="ig-star">⭐</span>' : ''}
          <button class="ig-del" type="button" title="删除" data-ig-del="${img.id}">✕</button>
          <span class="ig-setmain" data-ig-main="${img.id}">${img.isMain ? '主图' : '设为主图'}</span>`;
        grid.appendChild(tile);
      });
      const addTile = document.createElement('div');
      addTile.className = 'ig-tile ig-add';
      addTile.innerHTML = `<div class="ig-add-inner">${icon('plus')}<span>添加</span></div>`;
      grid.appendChild(addTile);
    }
    bindGrid();
  }
  function bindGrid() {
    grid.querySelectorAll('[data-ig-del]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        images = images.filter((x) => x.id !== b.dataset.igDel);
        if (images.length && !images.some((x) => x.isMain)) images[0].isMain = true;
        render(); emit();
      };
    });
    grid.querySelectorAll('[data-ig-main]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const id = b.dataset.igMain;
        images.forEach((x) => { x.isMain = x.id === id; });
        render(); emit();
      };
    });
    const addTile = grid.querySelector('.ig-add');
    if (addTile) addTile.onclick = () => input.click();
  }
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) {
      if (images.length >= MAX_IMAGES) { toastError(`最多 ${MAX_IMAGES} 张图片`); break; }
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { toastError('仅支持 JPG / PNG / WebP 格式'); continue; }
      if (file.size > MAX_IMAGE_MB * 1024 * 1024) { toastError(`图片超过 ${MAX_IMAGE_MB}MB，请压缩后上传`); continue; }
      try {
        const dataUrl = await fileToDataURL(file);
        images.push({ id: uid('img'), data: dataUrl, isMain: images.length === 0 });
        render(); emit();
      } catch (_) {
        toastError('图片上传失败：读取文件出错');
      }
    }
  }
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragover', 'dragenter'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('ig-drag'); }));
  ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('ig-drag'); }));
  el.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) addFiles(dt.files);
  });
  document.addEventListener('paste', (e) => {
    if (!el.isConnected) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const file = extractImageFromEvent(e);
    if (file) { e.preventDefault(); addFiles([file]); }
  });
  return {
    el,
    getValue: () => images,
    setValue: (arr) => setImages(arr, false),
    setSilent: (arr) => setImages(arr, true),
  };
}

/** 产品添加/编辑弹窗 */
function openProductModal(existing, onDone) {
  let isExisting = Boolean(existing);
  let selectedTier = 'aggressive';
  let lastTiers = {};
  let formReady = false;
  // 报价显示统一 .99 结尾：仅改显示格式，底层计算与输入字段不变
  // 负数 / 0 → 0.99；正数 → 取整 + 0.99
  function to99Format(value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) return 0.99;
    return Math.floor(v) + 0.99;
  }
  const gallery = createImageGallery({ onChange: () => scheduleSave('image') });
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field">
      <div class="field-label">产品图片 <span class="hint">点击 / 拖拽 / Ctrl+V 粘贴上传，最多 ${MAX_IMAGES} 张</span></div>
      <div data-uploader></div>
    </div>
    <div class="field">
      <div class="field-label">产品名称 <span class="req">*</span></div>
      <input class="input" data-f="name" placeholder="例如：Portable Blender 便携榨汁杯">
    </div>
    <div class="field" style="margin-top:-6px">
      <div class="field-label">Amazon 链接 <span class="hint">可选 · 展示为可跳转链接</span></div>
      <input class="input" data-f="amazonUrl" placeholder="https://www.amazon.com/dp/B0XXXXXX 或 amazon.com/dp/B0XXXXXX">
    </div>

    <div class="form-section-title">存入分类 <span style="font-weight:400;font-size:12.5px;color:var(--text-faint)">选择产品归属的列表（可在列表中复制 / 移动）</span></div>
    <div class="cat-radio" data-cat-radio>
      ${CATEGORIES.map((c, i) => `
        <label class="cat-radio-item ${i === 0 ? 'active' : ''}">
          <input type="radio" name="libcat" value="${c.id}" ${i === 0 ? 'checked' : ''}>
          <span>${esc(c.label)}</span>
        </label>`).join('')}
    </div>

    <div class="form-grid">
      <div class="field">
        <div class="field-label">产品类目 <span class="hint">自由文本，如 Home &amp; Kitchen</span></div>
        <input class="input" data-f="productCategory" placeholder="例如：Home & Kitchen">
      </div>
    </div>

    <div class="form-section-title">1688 货源信息 <span style="font-weight:400;font-size:12.5px;color:var(--text-faint)">最多 3 条 · 每条可填写规格颜色</span></div>
    <div data-supplies></div>
    <button class="btn btn-ghost btn-sm" data-add-supply type="button">${icon('plus')} 添加货源</button>

    <div class="form-section-title">亚马逊利润测算 <span style="font-weight:400;font-size:12.5px;color:var(--text-faint)">一份基础数据 · 勾选多个站点自动同步生成各站报价</span></div>
    <div class="field">
      <div class="field-label">目标站点 <span class="hint">可多选（至少 1 个），每个站点自动按对应汇率/FBA/VAT 生成报价</span></div>
      <div class="site-chips" data-site-chips>
        ${AMAZON_SITES.map((s) => `<button type="button" class="site-chip" data-site-toggle="${s.code}">${s.flag} ${s.code} ${s.label}</button>`).join('')}
      </div>
    </div>
    <div class="form-grid">
      <div class="field">
        <div class="field-label">长 <span class="hint">cm</span></div>
        <input class="input" type="number" min="0" step="0.1" data-q="lengthCm" placeholder="15">
      </div>
      <div class="field">
        <div class="field-label">宽 <span class="hint">cm</span></div>
        <input class="input" type="number" min="0" step="0.1" data-q="widthCm" placeholder="10">
      </div>
      <div class="field">
        <div class="field-label">高 <span class="hint">cm</span></div>
        <input class="input" type="number" min="0" step="0.1" data-q="heightCm" placeholder="8">
      </div>
      <div class="field">
        <div class="field-label">重量 <span class="hint">kg · 实重</span></div>
        <input class="input" type="number" min="0" step="0.01" data-q="weightG" placeholder="0.4">
      </div>
      <div class="field">
        <div class="field-label">采购成本 <span class="hint">¥ / 件</span></div>
        <input class="input" type="number" min="0" step="0.01" data-q="cost" placeholder="25">
      </div>
      <div class="field">
        <div class="field-label">海运单价 <span class="hint">¥/kg · 头程=计费重×单价÷汇率</span></div>
        <input class="input" type="number" min="0" step="0.01" data-q="seaFreightRate" placeholder="如 12">
      </div>
      <div class="field">
        <div class="field-label">体积重除数 <span class="hint">体积重=长×宽×高÷此数（可改 5000/6000…）</span></div>
        <input class="input" type="number" min="1000" step="500" data-q="volWeightDivisor" value="6000">
      </div>
    </div>
    <div data-site-cards></div>
    <div data-quote-summary></div>

    <div class="field">
      <div class="field-label">产品描述 <span class="hint">导入工坊时自动带入</span></div>
      <textarea class="textarea" data-f="description" rows="3" placeholder="产品描述 / 卖点素材"></textarea>
    </div>
  `;
  body.querySelector('[data-uploader]').appendChild(gallery.el);

  // 分类单选高亮
  const catRadio = body.querySelector('[data-cat-radio]');
  catRadio.querySelectorAll('input').forEach((r) => {
    r.addEventListener('change', () => {
      catRadio.querySelectorAll('.cat-radio-item').forEach((l) => l.classList.toggle('active', l.querySelector('input').checked));
      scheduleSave('category');
    });
  });

  // ---------- 1688 货源（最多 3 条） ----------
  const suppliesBox = body.querySelector('[data-supplies]');
  const addSupplyBtn = body.querySelector('[data-add-supply]');
  let supplyCount = 0;
  function renderSupplies() {
    suppliesBox.innerHTML = '';
    for (let i = 0; i < supplyCount; i++) {
      const row = document.createElement('div');
      row.className = 'supply-row';
      row.dataset.supplyRow = '1';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="tag tag-primary">货源 ${i + 1}</span>
          <span class="flex-1"></span>
          <button class="btn btn-ghost btn-sm" type="button" data-del-supply>${icon('trash')} 移除</button>
        </div>
        <div class="field" style="margin-bottom:8px">
          <div class="field-label">链接 / 供应商</div>
          <input class="input" data-sl-link placeholder="https://detail.1688.com/... 或供应商名称">
        </div>
        <div class="field" style="margin-bottom:0">
          <div class="field-label">规格颜色</div>
          <input class="input" data-sl-spec placeholder="例如：350ml 白色 / 500ml 粉色 / 粉色×3 个装">
        </div>`;
      suppliesBox.appendChild(row);
      row.querySelector('[data-del-supply]').addEventListener('click', () => {
        supplyCount--;
        renderSupplies();
      });
    }
    addSupplyBtn.style.display = supplyCount >= 3 ? 'none' : 'inline-flex';
    const left = 3 - supplyCount;
    addSupplyBtn.innerHTML = `${icon('plus')} 添加货源${left > 0 ? `（还可加 ${left} 条）` : ''}`;
  }
  addSupplyBtn.addEventListener('click', () => {
    if (supplyCount < 3) { supplyCount++; renderSupplies(); }
  });
  if (existing && (existing.supplies || []).length) {
    supplyCount = Math.min(existing.supplies.length, 3);
    renderSupplies();
    (existing.supplies || []).slice(0, 3).forEach((s, i) => {
      const row = suppliesBox.children[i];
      if (!row) return;
      row.querySelector('[data-sl-link]').value = s.link || '';
      row.querySelector('[data-sl-spec]').value = s.specColor || '';
    });
  } else {
    supplyCount = 1;
    renderSupplies();
  }

  // ---------- 多站点报价测算 ----------
  const cardsBox = body.querySelector('[data-site-cards]');
  const summaryBox = body.querySelector('[data-quote-summary]');
  const selectedSites = new Set();
  const siteFieldCache = {};

  function siteInfoOf(code) {
    return AMAZON_SITES.find((s) => s.code === code) || AMAZON_SITES[0];
  }
  function siteDefaults(code) {
    const si = siteInfoOf(code);
    const rates = PER_SITE_RATES[code] || PER_SITE_RATES.US;
    const qd = (getSettings().quoteDefaults || {}).sites || {};
    const d = qd[code] || {};
    return {
      exchangeRate: d.exchangeRate != null && d.exchangeRate !== '' ? d.exchangeRate : si.rate,
      targetProfitRate: d.targetProfitRate != null && d.targetProfitRate !== '' ? d.targetProfitRate : 30,
      adRate: d.adRate != null && d.adRate !== '' ? d.adRate : 1,
      referralRate: d.referralRate != null && d.referralRate !== '' ? d.referralRate : 15,
      avtRate: d.avtRate != null && d.avtRate !== '' ? d.avtRate : rates.avt,
      storageRate: d.storageRate != null && d.storageRate !== '' ? d.storageRate : rates.storage,
      returnRate: d.returnRate != null && d.returnRate !== '' ? d.returnRate : rates.return,
      fbaFee: '', shippingPerUnit: 0,
    };
  }
  function readBase() {
    const q = {};
    body.querySelectorAll('[data-q]').forEach((el) => {
      q[el.dataset.q] = el.value === '' ? '' : Number(el.value);
    });
    return q;
  }
  function readSiteFields(code) {
    const out = { ...siteDefaults(code), ...(siteFieldCache[code] || {}) };
    const card = cardsBox.querySelector(`[data-site-card="${code}"]`);
    if (card) {
      card.querySelectorAll('[data-sq]').forEach((el) => {
        out[el.dataset.sq] = el.value === '' ? '' : Number(el.value);
      });
    }
    return out;
  }
  function syncSiteCache() {
    cardsBox.querySelectorAll('[data-site-card]').forEach((card) => {
      const code = card.dataset.siteCard;
      if (!siteFieldCache[code]) siteFieldCache[code] = {};
      card.querySelectorAll('[data-sq]').forEach((el) => {
        siteFieldCache[code][el.dataset.sq] = el.value;
      });
    });
  }
  function renderSiteChips() {
    body.querySelectorAll('[data-site-toggle]').forEach((btn) => {
      btn.classList.toggle('active', selectedSites.has(btn.dataset.siteToggle));
    });
  }
  function renderSiteCards() {
    cardsBox.innerHTML = '';
    selectedSites.forEach((code) => {
      const si = siteInfoOf(code);
      const f = { ...siteDefaults(code), ...(siteFieldCache[code] || {}) };
      const card = document.createElement('div');
      card.className = 'site-quote-card';
      card.dataset.siteCard = code;
      card.innerHTML = `
        <div class="sq-head">
          <span class="sq-title">${si.flag} ${si.label}（${si.domain}）</span>
          <span class="flex-1"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-site="${code}" ${selectedSites.size <= 1 ? 'disabled' : ''}>${icon('x')} 移除</button>
        </div>
        <div class="sq-grid">
          <label class="sq-item"><span>汇率</span><input class="input input-sm" type="number" min="0" step="0.001" data-sq="exchangeRate" value="${f.exchangeRate}"><span class="sq-curr">CNY→${si.currency}</span></label>
          <label class="sq-item"><span>目标利润 %</span><input class="input input-sm" type="number" min="0" max="90" step="1" data-sq="targetProfitRate" value="${f.targetProfitRate}"></label>
          <label class="sq-item"><span>广告费率 %</span><input class="input input-sm" type="number" min="0" max="60" step="1" data-sq="adRate" value="${f.adRate}"></label>
          <label class="sq-item"><span>佣金率 %</span><input class="input input-sm" type="number" min="0" max="45" step="1" data-sq="referralRate" value="${f.referralRate}"></label>
          <label class="sq-item"><span>VAT %</span><input class="input input-sm" type="number" min="0" max="30" step="0.1" data-sq="avtRate" value="${f.avtRate}"></label>
          <label class="sq-item"><span>仓储 %</span><input class="input input-sm" type="number" min="0" max="10" step="0.1" data-sq="storageRate" value="${f.storageRate}"></label>
          <label class="sq-item"><span>退货率 %</span><input class="input input-sm" type="number" min="0" max="50" step="0.5" data-sq="returnRate" value="${f.returnRate}"></label>
          <label class="sq-item"><span>FBA 费</span><input class="input input-sm" type="number" min="0" step="0.01" data-sq="fbaFee" value="${f.fbaFee}" placeholder="如 4.46"><span class="sq-curr">${si.symbol}</span></label>
          <label class="sq-item"><span>头程费</span><input class="input input-sm" type="number" min="0" step="0.01" data-sq="shippingPerUnit" value="${f.shippingPerUnit}" placeholder="同步长宽高重量和采购价"><span class="sq-curr">${si.symbol}·计费重×单价÷汇率</span></label>
        </div>
        <div class="sq-result" data-sq-result></div>`;
      cardsBox.appendChild(card);
    });
    cardsBox.querySelectorAll('[data-remove-site]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (selectedSites.size <= 1) { toastInfo('至少保留一个目标站点'); return; }
        selectedSites.delete(btn.dataset.removeSite);
        renderSiteChips();
        renderSiteCards();
        recomputeAll();
      });
    });
    cardsBox.querySelectorAll('[data-sq]').forEach((el) => {
      const code = el.closest('[data-site-card]').dataset.siteCard;
      const fld = el.dataset.sq;
      el.addEventListener('input', () => {
        if (fld === 'shippingPerUnit') el.dataset.manual = '1';
        syncSiteCache();
        recomputeAll();
      });
      el.addEventListener('change', recomputeAll);
    });
  }
  function recomputeAll() {
    syncSiteCache();
    const base = readBase();
    const cw = calcChargeableWeight({
      lengthCm: base.lengthCm, widthCm: base.widthCm, heightCm: base.heightCm,
      weightG: (base.weightG === '' ? 0 : base.weightG) * 1000,
      volWeightDivisor: base.volWeightDivisor,
    });
    const summary = [];
    const allTiers = {};
    selectedSites.forEach((code) => {
      const si = siteInfoOf(code);
      const card = cardsBox.querySelector(`[data-site-card="${code}"]`);
      if (!card) return;
      const f = readSiteFields(code);
      const resEl = card.querySelector('[data-sq-result]');
      const shipInput = card.querySelector('[data-sq="shippingPerUnit"]');
      const seaRate = Number(base.seaFreightRate) || 0;
      const exch = Number(f.exchangeRate) || 0;
      if (!shipInput.dataset.manual && cw.chargeable > 0 && seaRate > 0 && exch > 0) {
        f.shippingPerUnit = Math.round(cw.chargeable * seaRate / exch * 100) / 100;
        shipInput.value = f.shippingPerUnit;
      }
      const result = calculateQuote({
        cost: base.cost, exchangeRate: f.exchangeRate, targetProfitRate: f.targetProfitRate / 100,
        adRate: f.adRate / 100, referralRate: f.referralRate / 100,
        avtRate: f.avtRate / 100, storageRate: f.storageRate / 100, returnRate: f.returnRate / 100,
        fbaFee: f.fbaFee === '' ? 0 : f.fbaFee, shippingPerUnit: f.shippingPerUnit === '' ? 0 : f.shippingPerUnit,
        symbol: si.symbol || '$',
      });
      // 三档推荐报价（1% / 15% / 30%）—— 沿用现有成本/费率字段，仅改变目标利润率
      const tiers = {};
      PRICE_TIERS.forEach((t) => {
        const r = calculateQuote({
          cost: base.cost, exchangeRate: f.exchangeRate, targetProfitRate: t.margin,
          adRate: f.adRate / 100, referralRate: f.referralRate / 100,
          avtRate: f.avtRate / 100, storageRate: f.storageRate / 100, returnRate: f.returnRate / 100,
          fbaFee: f.fbaFee === '' ? 0 : f.fbaFee, shippingPerUnit: f.shippingPerUnit === '' ? 0 : f.shippingPerUnit,
          symbol: si.symbol || '$',
        });
        tiers[t.id] = (r && !r.error) ? { price: r.price, profit: r.profit, margin: r.margin } : null;
      });
      allTiers[code] = tiers;
      if (result && !result.error) {
        const b = result.breakdown;
        const tInline = PRICE_TIERS.map((t) => `${t.label} ${si.symbol}${tiers[t.id] ? to99Format(tiers[t.id].price).toFixed(2) : '—'}`).join(' · ');
        resEl.innerHTML = `
          <div class="sq-res-main">三档报价：<b>${tInline}</b></div>
          <div class="sq-res-detail">采购 ${si.symbol}${b.costUsd} · FBA ${si.symbol}${b.fbaFee} · 头程 ${si.symbol}${b.shippingPerUnit} · VAT ${si.symbol}${b.avt} · 仓储 ${si.symbol}${b.storage} · 退货 ${si.symbol}${b.return} · 佣金 ${si.symbol}${b.referral} · 广告 ${si.symbol}${b.ad}</div>
          <div class="sq-res-note">计费重量 ${cw.chargeable}kg（实重 ${cw.actual}kg / 体积重 ${cw.vol}kg${base.volWeightDivisor ? `，除数 ${base.volWeightDivisor}` : ''}）</div>`;
      } else {
        resEl.innerHTML = `<div class="sq-res-note" style="color:var(--text-faint)">${result && result.error ? result.error : '填写采购成本后自动计算各站报价'}</div>`;
      }
      summary.push({ si, result });
    });
    renderTierBlock(allTiers, [...selectedSites][0]);
    if (formReady) scheduleSave('input');
  }

  function renderTierBlock(allTiers, primaryCode) {
    const si = siteInfoOf(primaryCode);
    const sym = (si && si.symbol) || '$';
    const tiers = (allTiers && allTiers[primaryCode]) || {};
    lastTiers = tiers;
    const sel = selectedTier;
    summaryBox.innerHTML = `
      <div class="tier-title">💰 推荐报价（基于当前成本与费率自动计算）</div>
      <div class="tier-cards">
        ${PRICE_TIERS.map((t) => {
          const tv = tiers[t.id];
          const isSel = sel === t.id;
          return `
          <div class="tier-card tier-${t.color} ${isSel ? 'selected' : ''}" data-tier="${t.id}">
            <div class="tier-head"><span class="tier-dot"></span>${t.label}</div>
            <div class="tier-margin-sub">利润率 ${Math.round(t.margin * 100)}%</div>
            ${tv ? `<div class="tier-price">${sym}${to99Format(tv.price).toFixed(2)}</div>
              <div class="tier-profit">利润 ${sym}${to99Format(tv.profit).toFixed(2)}</div>
              <div class="tier-margin2">利润率 ${Math.round(tv.margin * 100)}%</div>`
              : `<div class="tier-empty">填写成本后计算</div>`}
          </div>`;
        }).join('')}
      </div>
      <div class="tier-radio-row">
        <span class="tier-radio-label">当前选用：</span>
        ${PRICE_TIERS.map((t) => `
          <label class="tier-radio-opt">
            <input type="radio" name="tierSel" value="${t.id}" ${sel === t.id ? 'checked' : ''} data-tier-radio="${t.id}">
            <span>${t.label}</span>
          </label>`).join('')}
      </div>`;
    summaryBox.querySelectorAll('[data-tier]').forEach((card) => {
      card.addEventListener('click', () => selectTier(card.dataset.tier));
    });
    summaryBox.querySelectorAll('[data-tier-radio]').forEach((r) => {
      r.addEventListener('change', () => selectTier(r.value));
    });
  }
  function selectTier(id) {
    selectedTier = id;
    summaryBox.querySelectorAll('[data-tier]').forEach((c) => c.classList.toggle('selected', c.dataset.tier === id));
    summaryBox.querySelectorAll('[data-tier-radio]').forEach((r) => { r.checked = r.value === id; });
    scheduleSave('tier');
  }

  body.querySelectorAll('[data-site-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.siteToggle;
      if (selectedSites.has(code)) {
        if (selectedSites.size <= 1) { toastInfo('至少保留一个目标站点'); return; }
        selectedSites.delete(code);
      } else {
        selectedSites.add(code);
      }
      renderSiteChips();
      renderSiteCards();
      recomputeAll();
    });
  });
  body.querySelectorAll('[data-q]').forEach((el) => {
    el.addEventListener('input', recomputeAll);
    el.addEventListener('change', recomputeAll);
  });

  if (!existing || !existing.quote || existing.quote.volWeightDivisor == null || existing.quote.volWeightDivisor === '') {
    const vd = (getSettings().quoteDefaults || {}).volWeightDivisor;
    if (vd) body.querySelector('[data-q="volWeightDivisor"]').value = vd;
  }
  if (!existing || !existing.quote || existing.quote.seaFreightRate == null || existing.quote.seaFreightRate === '') {
    const sr = (getSettings().quoteDefaults || {}).seaFreightRate;
    if (sr) body.querySelector('[data-q="seaFreightRate"]').value = sr;
  }

  // 草稿恢复：编辑已有产品时，刷新后尝试恢复未保存数据（仅当草稿比已存数据新）
  // 新建产品：始终打开空白表单 —— 不恢复、并清除可能残留的草稿，避免「添加产品」被上次未保存/未完成的草稿污染（如误显示「太阳镜收纳盒」等已有产品数据）
  let src = existing;
  const draftKey = 'lib_draft_' + (existing ? existing.id : 'new');
  if (!existing) {
    try { localStorage.removeItem(draftKey); } catch (_) {}
  }
  try {
    const raw = localStorage.getItem(draftKey);
    if (raw && existing) {
      const d = JSON.parse(raw);
      if (d && d.data && d.ts > (existing.updatedAt || 0)) {
        src = { ...existing, ...d.data };
        toastInfo('已恢复上次未保存的草稿');
      }
    }
  } catch (_) {}

  const initSites = (src && Array.isArray(src.sites) && src.sites.length)
    ? src.sites
    : (src && src.quote && src.quote.site ? [src.quote.site] : (src ? [src.site || 'US'] : ['US']));
  initSites.forEach((s) => selectedSites.add(s));
  if (src) {
    const qs = src.quotes || (src.quote ? { [src.quote.site || src.site || 'US']: src.quote } : {});
    Object.entries(qs).forEach(([code, q]) => {
      if (!siteFieldCache[code]) siteFieldCache[code] = {};
      ['exchangeRate', 'targetProfitRate', 'adRate', 'referralRate', 'avtRate', 'storageRate', 'returnRate', 'fbaFee', 'shippingPerUnit'].forEach((k) => {
        if (q && q[k] !== '' && q[k] != null) siteFieldCache[code][k] = q[k];
      });
    });
    const qMain = src.quote || qs[initSites[0]] || null;
    if (qMain) {
      ['lengthCm', 'widthCm', 'heightCm', 'cost', 'seaFreightRate', 'volWeightDivisor'].forEach((k) => {
        const el = body.querySelector(`[data-q="${k}"]`);
        if (el && qMain[k] !== '' && qMain[k] != null) el.value = qMain[k];
      });
      if (qMain.weightG !== '' && qMain.weightG != null) {
        body.querySelector('[data-q="weightG"]').value = Number(qMain.weightG) / 1000;
      }
    }
    const initImages = (src.images && src.images.length) ? src.images : (src.image ? [{ id: uid('img'), data: src.image, isMain: true }] : []);
    gallery.setSilent(initImages);
    body.querySelector('[data-f="name"]').value = src.name || '';
    body.querySelector('[data-f="amazonUrl"]').value = src.amazonUrl || '';
    body.querySelector('[data-f="productCategory"]').value = src.productCategory || '';
    body.querySelector('[data-f="description"]').value = src.description || '';
    selectedTier = PRICE_TIER_IDS.includes(src.selectedPriceTier) ? src.selectedPriceTier : 'aggressive';
    // 分类单选
    const ec = CATEGORY_IDS.includes(src.category) ? src.category : CATEGORIES[0].id;
    const ecInput = catRadio.querySelector(`input[value="${ec}"]`);
    if (ecInput) { ecInput.checked = true; catRadio.querySelectorAll('.cat-radio-item').forEach((l) => l.classList.toggle('active', l.querySelector('input').checked)); }
  }
  renderSiteChips();
  renderSiteCards();
  recomputeAll();
  formReady = true;

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;gap:10px;width:100%;';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = '取消';
  const okBtn = document.createElement('button');
  okBtn.className = 'btn btn-primary';
  okBtn.innerHTML = `${icon('check')} 手动保存`;
  footer.appendChild(cancelBtn);
  footer.appendChild(okBtn);

  const m = openModal({
    title: existing ? '编辑产品' : '添加产品到选品库',
    body,
    footer,
    width: 'wide',
  });

  // ---------- 实时自动保存 + 状态指示 ----------
  const statusEl = document.createElement('div');
  statusEl.className = 'save-status save-status--saved';
  statusEl.innerHTML = '🟢 已保存';
  statusEl.title = '点击重试（保存失败时）';
  m.el.appendChild(statusEl);

  let saveTimer = null;
  const DRAFT_KEY = 'lib_draft_' + (existing ? existing.id : 'new');
  function saveDraft(data) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (_) {} }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }
  function buildData() {
    const supplies = [];
    body.querySelectorAll('[data-supply-row]').forEach((row) => {
      const link = row.querySelector('[data-sl-link]').value.trim();
      const specColor = row.querySelector('[data-sl-spec]').value.trim();
      if (link || specColor) supplies.push({ link, specColor });
    });
    syncSiteCache();
    const base = readBase();
    const sites = [...selectedSites];
    const quotes = {};
    sites.forEach((code) => {
      const si = siteInfoOf(code);
      const f = { ...siteDefaults(code), ...(siteFieldCache[code] || {}) };
      const card = body.querySelector(`[data-site-card="${code}"]`);
      if (card) {
        card.querySelectorAll('[data-sq]').forEach((el) => {
          f[el.dataset.sq] = el.value === '' ? '' : Number(el.value);
        });
      }
      const result = calculateQuote({
        cost: base.cost, exchangeRate: f.exchangeRate, targetProfitRate: f.targetProfitRate / 100,
        adRate: f.adRate / 100, referralRate: f.referralRate / 100,
        avtRate: f.avtRate / 100, storageRate: f.storageRate / 100, returnRate: f.returnRate / 100,
        fbaFee: f.fbaFee === '' ? 0 : f.fbaFee, shippingPerUnit: f.shippingPerUnit === '' ? 0 : f.shippingPerUnit,
        symbol: si.symbol || '$',
      });
      quotes[code] = {
        site: code,
        lengthCm: base.lengthCm, widthCm: base.widthCm, heightCm: base.heightCm,
        weightG: base.weightG === '' ? '' : Math.round(Number(base.weightG) * 1000),
        cost: base.cost, exchangeRate: f.exchangeRate,
        targetProfitRate: f.targetProfitRate, adRate: f.adRate, referralRate: f.referralRate,
        avtRate: f.avtRate, storageRate: f.storageRate, returnRate: f.returnRate,
        fbaFee: f.fbaFee === '' ? '' : Number(f.fbaFee),
        shippingPerUnit: f.shippingPerUnit === '' ? 0 : Number(f.shippingPerUnit),
        seaFreightRate: base.seaFreightRate, volWeightDivisor: base.volWeightDivisor,
        result: result && !result.error ? result : null,
      };
    });
    const mainSite = sites[0] || 'US';
    const catEl = body.querySelector('[data-cat-radio] input:checked');
    const cat = catEl ? catEl.value : CATEGORIES[0].id;
    const images = gallery.getValue();
    const mainImg = images.find((i) => i.isMain) || images[0];
    const selTier = (lastTiers && lastTiers[selectedTier]) ? selectedTier : (PRICE_TIERS[0] ? PRICE_TIERS[0].id : 'balanced');
    const rawPrice = (lastTiers && lastTiers[selTier]) ? lastTiers[selTier].price : '';
    const price = rawPrice !== '' && rawPrice != null ? Number(to99Format(rawPrice).toFixed(2)) : '';
    return {
      image: mainImg ? mainImg.data : '',
      name: body.querySelector('[data-f="name"]').value.trim(),
      amazonUrl: body.querySelector('[data-f="amazonUrl"]').value.trim(),
      category: cat,
      productCategory: body.querySelector('[data-f="productCategory"]').value.trim(),
      site: mainSite,
      sites,
      supplies,
      quotes,
      quote: quotes[mainSite] || null,
      images,
      selectedPriceTier: selTier,
      priceTiers: lastTiers || null,
      price,
      description: body.querySelector('[data-f="description"]').value.trim(),
    };
  }
  function setStatus(state, text) {
    statusEl.className = 'save-status save-status--' + state;
    statusEl.innerHTML = text;
  }
  function doSave() {
    const data = buildData();
    try {
      if (isExisting) {
        updateProductTracked(existing.id, data);
        clearDraft();
        setStatus('saved', '🟢 已保存');
      } else {
        saveDraft(data);
        setStatus('saved', '🟢 草稿已保存');
      }
    } catch (e) {
      saveDraft(data);
      setStatus('error', '🔴 保存失败，点击重试');
    }
  }
  function scheduleSave(kind) {
    if (kind === 'input') {
      setStatus('saving', '🟡 保存中...');
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => doSave(), 800);
    } else {
      if (saveTimer) clearTimeout(saveTimer);
      doSave();
    }
  }
  function persistNow() {
    const data = buildData();
    try {
      if (isExisting) { updateProductTracked(existing.id, data); clearDraft(); }
      else saveDraft(data);
    } catch (_) { saveDraft(data); }
  }
  function cleanup() { window.removeEventListener('beforeunload', persistNow); }
  statusEl.addEventListener('click', () => { if (statusEl.classList.contains('save-status--error')) doSave(); });
  window.addEventListener('beforeunload', persistNow);

  cancelBtn.onclick = () => { cleanup(); m.close(); };
  okBtn.onclick = () => {
    const name = body.querySelector('[data-f="name"]').value.trim();
    if (!name) { toastError('请填写产品名称'); return; }
    const data = buildData();
    try {
      if (isExisting) {
        updateProductTracked(existing.id, data);
        clearDraft();
        setStatus('saved', '🟢 已保存');
        toastSuccess('✅ 保存成功！');
      } else {
        const created = addProductTracked(data);
        existing = created; isExisting = true; clearDraft();
        setStatus('saved', '🟢 已保存');
        toastSuccess('✅ 产品添加成功');
        // 保存后自动切换到产品所在分类，确保新记录立即可见
        currentCategory = data.category || CATEGORIES[0].id;
      }
      cleanup();
      m.close();
      onDone && onDone();
    } catch (e) {
      saveDraft(data);
      setStatus('error', '🔴 保存失败，点击重试');
      toastError('❌ 保存失败，请检查网络');
    }
  };
}
