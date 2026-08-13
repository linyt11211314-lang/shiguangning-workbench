/**
 * AI Listing 工坊 —— 三视图
 *  1. 项目列表（list）
 *  2. 创建 / 编辑表单（form）
 *  3. 生成结果（result）
 */
import { icon } from '../ui/icons.js';
import { esc, copyText, timeAgo, clean } from '../utils.js';
import { AMAZON_SITES, CATEGORY_SUGGESTIONS } from '../config.js';
import { listProjects, getProject, createProjectTracked, updateProjectTracked, removeProjectTracked } from '../store/projectStore.js';
import { getProduct, listProducts } from '../store/productStore.js';
import { getSettings, hasApiKey, maskedKey } from '../store/settingsStore.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { createImageUploader } from '../ui/fields.js';
import { generateFullListing, generateSection } from '../services/listingService.js';

let state = {
  view: 'list',          // list | form | result
  project: null,         // 当前项目对象
  formData: null,        // 表单数据（未保存时的草稿）
};

const EMPTY_FORM = () => ({
  image: '',
  name: '',
  category: '',
  site: 'US',
  sellingPoints: '',
  competitorUrl: '',
  competitorText: '',
  keywords: '',
  brand: '',
  bannedWords: '',
  spec: '',
  color: '',
  size: '',
  material: '',
  supply1688: '',
  supplies: [],
  quote: null,
});

export function render(container, route, { navigate, rerender }) {
  const parts = route.split(':');

  if (parts[0] === 'listing' && parts[1] === 'new') {
    // 从选品库导入 or 空白新建
    if (parts[2]) {
      const prod = getProduct(parts[2]);
      if (prod) {
        state.formData = {
          ...EMPTY_FORM(),
          image: prod.image || '',
          name: prod.name || '',
          amazonUrl: prod.amazonUrl || '',
          category: prod.category || '',
          site: prod.site || 'US',
          sellingPoints: prod.description || '',
          supply1688: (prod.supplies || []).map((s) => s.link).filter(Boolean).join(' / ') || prod.supply1688 || '',
          supplies: prod.supplies || [],
          quote: prod.quote || null,
        };
        state.project = null;
      } else {
        state.formData = { ...EMPTY_FORM() };
        state.project = null;
      }
    } else {
      state.formData = { ...EMPTY_FORM() };
      state.project = null;
    }
    state.view = 'form';
  } else if (parts[0] === 'listing' && parts[1] === 'open') {
    const p = getProject(parts[2]);
    if (!p) { state.view = 'list'; }
    else {
      state.project = p;
      state.formData = { ...EMPTY_FORM(), ...(p.productInfo || {}) };
      state.view = 'result';
    }
  } else if (parts[0] === 'listing' && parts[1] === 'edit') {
    const p = getProject(parts[2]);
    if (!p) { state.view = 'list'; }
    else {
      state.project = p;
      state.formData = { ...EMPTY_FORM(), ...(p.productInfo || {}) };
      state.view = 'form';
    }
  } else {
    state.view = 'list';
  }

  container.innerHTML = '';
  if (state.view === 'list') renderList(container, { navigate, rerender });
  else if (state.view === 'form') renderForm(container, { navigate, rerender });
  else if (state.view === 'result') renderResult(container, { navigate, rerender });
}

/* ============================================================
 * 视图一：项目列表
 * ============================================================ */
function renderList(container, { navigate, rerender }) {
  const projects = listProjects();
  const generatedCount = projects.filter((p) => p.status !== 'draft').length;
  const todayCount = projects.filter((p) => {
    const d = new Date(p.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }).length;

  const metrics = [
    { label: 'Listing 项目', value: projects.length, sub: '全部项目' },
    { label: '已生成', value: generatedCount, sub: 'AI 已完成生成' },
    { label: '今日创建', value: todayCount, sub: '今天新建的项目' },
    { label: 'AI 服务', value: hasApiKey() ? '就绪' : '未配置', sub: hasApiKey() ? `Key ${maskedKey(getSettings().apiKey)}` : '前往设置配置 Key' },
  ];

  container.innerHTML = `
    <div class="metrics-row" data-metrics>
      ${metrics.map((m) => `
        <div class="metric-card">
          <div class="metric-body">
            <div class="metric-value">${m.value}</div>
            <div class="metric-label">${m.label}</div>
            <div class="metric-trend">${esc(m.sub)}</div>
          </div>
        </div>`).join('')}
    </div>

    <div class="card" style="padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="flex-1">
        <div style="font-size:14.5px;font-weight:700">Listing 项目</div>
        <div style="font-size:12.5px;color:var(--text-sub);margin-top:2px">刷新后仍在 · 随时打开继续编辑</div>
      </div>
      <button class="btn btn-ghost" data-tester title="POST /api/listing/generate 接口测试">${icon('link')} 接口测试台</button>
      <button class="btn btn-primary" data-new>${icon('plus')} 创建 Listing</button>
    </div>
    <div data-grid></div>
  `;

  container.querySelector('[data-new]').addEventListener('click', () => navigate('listing:new'));
  container.querySelector('[data-tester]').addEventListener('click', () => {
    window.open('/api-tester.html', '_blank', 'noopener');
  });

  const grid = container.querySelector('[data-grid]');
  if (!projects.length) {
    grid.innerHTML = `
      <div class="card"><div class="empty-state">
        <div class="empty-icon">${icon('sparkles')}</div>
        <div class="empty-title">还没有 Listing 项目</div>
        <div class="empty-sub">创建 Listing 前需要先填写产品信息（图片 / 名称 / 类目 / 站点 / 核心卖点）<br>也可以从选品库一键导入</div>
        <div class="mt-16" style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" data-new2>${icon('plus')} 独立创建</button>
          <button class="btn btn-soft" data-import2>${icon('box')} 从选品库导入</button>
        </div>
      </div></div>`;
    grid.querySelector('[data-new2]').addEventListener('click', () => navigate('listing:new'));
    grid.querySelector('[data-import2]').addEventListener('click', () => openLibraryPicker((prodId) => navigate(`listing:new:${prodId}`)));
    return;
  }

  grid.innerHTML = `
    <div class="project-grid">
      ${projects.map((p) => {
        const info = p.productInfo || {};
        const statusTag = p.status === 'saved'
          ? '<span class="tag tag-green">已保存</span>'
          : p.status === 'generated' ? '<span class="tag tag-blue">已生成</span>'
          : '<span class="tag">草稿</span>';
        return `
        <div class="card project-card" data-open="${p.id}">
          <div class="project-head">
            ${info.image ? `<img class="project-thumb" src="${esc(info.image)}" alt="">` : '<div class="project-thumb no-img">无图</div>'}
            <div style="min-width:0">
              <div class="project-name">${esc(info.name || '未命名产品')}</div>
              <div class="project-meta">${statusTag}<span>${esc(info.site || 'US')} 站</span></div>
            </div>
          </div>
          <div class="project-body">
            ${p.title ? `<div class="pb-row"><b>标题</b><span class="pb-val">${esc(p.title)}</span></div>` : ''}
            ${p.bulletPoints?.length ? `<div class="pb-row"><b>五点</b><span class="pb-val">${p.bulletPoints.length} 条已生成</span></div>` : ''}
            ${p.searchTerms?.length ? `<div class="pb-row"><b>关键词</b><span class="pb-val">${p.searchTerms.length} 个已生成</span></div>` : ''}
            <div class="pb-row"><b>更新</b><span class="pb-val">${timeAgo(p.updatedAt)}</span></div>
          </div>
          <div class="project-foot">
            <button class="btn btn-primary btn-sm flex-1" data-open2="${p.id}">${icon('edit')} 打开编辑</button>
            <button class="btn btn-danger-soft btn-sm" data-del="${p.id}">${icon('trash')} 删除</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  grid.querySelectorAll('[data-open], [data-open2]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate(`listing:open:${el.dataset.open || el.dataset.open2}`);
    });
  });
  grid.querySelectorAll('[data-del]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = getProject(el.dataset.del);
      confirmDialog({
        title: '删除项目',
        message: `确定删除「${p?.productInfo?.name || '该项目'}」吗？此操作不可恢复。`,
        confirmText: '删除',
        danger: true,
        onConfirm: () => {
          removeProjectTracked(el.dataset.del);
          toastSuccess('已删除');
          rerender();
        },
      });
    });
  });
}

/* ============================================================
 * 视图二：创建 / 编辑表单
 * ============================================================ */
function renderForm(container, { navigate }) {
  const data = state.formData || EMPTY_FORM();
  const editing = Boolean(state.project?.id);

  const uploader = createImageUploader({});
  uploader.setValue(data.image);

  const optionalOpen = Boolean(data.competitorUrl || data.competitorText || data.keywords || data.brand ||
    data.bannedWords || data.spec || data.color || data.size || data.material);

  container.innerHTML = `
    <div class="listing-steps">
      <div class="step-item active">
        <div class="step-dot">1</div><span class="step-label">填写产品信息</span>
      </div>
      <div class="step-line"></div>
      <div class="step-item">
        <div class="step-dot">2</div><span class="step-label">AI 生成</span>
      </div>
      <div class="step-line"></div>
      <div class="step-item">
        <div class="step-dot">3</div><span class="step-label">编辑与保存</span>
      </div>
      <span class="flex-1"></span>
      <button class="btn btn-ghost btn-sm" data-back>← 返回列表</button>
    </div>

    <div class="card listing-form-card">
      <div class="card-pad">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <div style="font-size:17.5px;font-weight:700">${editing ? '编辑产品信息' : '创建 Listing'}</div>
          ${editing ? '<span class="tag tag-green">编辑已有项目</span>' : ''}
        </div>
        <div style="font-size:13px;color:var(--text-sub)">生成前请先完整填写产品信息 —— AI 将基于以下内容生成 Amazon Listing</div>

        <div class="form-section-title">① 必填信息</div>
        <div class="form-grid">
          <div class="field span-2">
            <div class="field-label">产品图片 <span class="req">*</span> <span class="hint">点击上传 · Ctrl+V 粘贴 · 拖拽</span></div>
            <div data-uploader></div>
          </div>
          <div class="field">
            <div class="field-label">产品名称 <span class="req">*</span></div>
            <input class="input" data-f="name" placeholder="例如：Mini Portable Blender USB Rechargeable" value="${esc(data.name)}">
          </div>
          <div class="field">
            <div class="field-label">产品类目 <span class="req">*</span></div>
            <input class="input" data-f="category" list="categoryList" placeholder="选择或输入类目" value="${esc(data.category)}">
            <datalist id="categoryList">
              ${CATEGORY_SUGGESTIONS.map((c) => `<option value="${esc(c)}">`).join('')}
            </datalist>
          </div>
          <div class="field span-2">
            <div class="field-label">目标 Amazon 站点 <span class="req">*</span></div>
            <div class="site-chips" data-sites>
              ${AMAZON_SITES.map((s) => `
                <button type="button" class="site-chip ${data.site === s.code ? 'active' : ''}" data-site="${s.code}">${s.flag} ${s.code} · ${s.label}</button>`).join('')}
            </div>
          </div>
          <div class="field span-2">
            <div class="field-label">核心卖点 <span class="req">*</span> <span class="hint">产品优势、功能特点、目标人群</span></div>
            <textarea class="textarea" data-f="sellingPoints" rows="4" placeholder="例如：&#10;· 350ml 容量，一次充电可榨 20 杯&#10;· 6 片不锈钢刀片，30 秒破壁&#10;· 防滑硅胶底座，静音设计">${esc(data.sellingPoints)}</textarea>
          </div>
        </div>

        <div class="form-section-title">② 可选信息</div>
        <div class="collapse-wrap ${optionalOpen ? 'open' : ''}">
          <div class="collapse-head" data-collapse>
            <span>高级选项（竞品 / 关键词 / 品牌 / 规格等）</span>
            <span class="ch-arrow">${icon('chevronDown')}</span>
          </div>
          <div class="collapse-body">
            <div class="form-grid" style="margin-top:10px">
              <div class="field">
                <div class="field-label">竞品链接 <span class="hint">Amazon 商品 URL</span></div>
                <input class="input" data-f="competitorUrl" placeholder="https://www.amazon.com/dp/B0XXXXXX" value="${esc(data.competitorUrl)}">
              </div>
              <div class="field">
                <div class="field-label">竞品信息 <span class="hint">链接抓取失败时，可粘贴竞品标题 / 五点</span></div>
                <textarea class="textarea" data-f="competitorText" rows="2" placeholder="粘贴竞品 Listing 文本…">${esc(data.competitorText)}</textarea>
              </div>
              <div class="field">
                <div class="field-label">目标关键词</div>
                <input class="input" data-f="keywords" placeholder="portable blender, mini juicer, USB blender..." value="${esc(data.keywords)}">
              </div>
              <div class="field">
                <div class="field-label">品牌名称</div>
                <input class="input" data-f="brand" placeholder="品牌名（用于标题）" value="${esc(data.brand)}">
              </div>
              <div class="field">
                <div class="field-label">禁止词 <span class="hint">AI 将避免使用</span></div>
                <input class="input" data-f="bannedWords" placeholder="例如：best, cheapest, free shipping" value="${esc(data.bannedWords)}">
              </div>
              <div class="field">
                <div class="field-label">产品规格</div>
                <input class="input" data-f="spec" placeholder="例如：350ml, 22000RPM, USB-C" value="${esc(data.spec)}">
              </div>
              <div class="field">
                <div class="field-label">颜色</div>
                <input class="input" data-f="color" placeholder="例如：White / Black / Green" value="${esc(data.color)}">
              </div>
              <div class="field">
                <div class="field-label">尺寸</div>
                <input class="input" data-f="size" placeholder="例如：7.4 x 7.4 x 19.3 cm" value="${esc(data.size)}">
              </div>
              <div class="field">
                <div class="field-label">材质</div>
                <input class="input" data-f="material" placeholder="例如：食品级 Tritan + 不锈钢" value="${esc(data.material)}">
              </div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;flex-wrap:wrap">
          <button class="btn btn-ghost" data-cancel>取消</button>
          <button class="btn btn-soft" data-import>${icon('box')} 从选品库导入</button>
          <button class="btn btn-primary btn-lg" data-generate>${icon('sparkles')} 生成 Listing</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-uploader]').appendChild(uploader.el);

  // 站点选择
  container.querySelectorAll('[data-site]').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('[data-site]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // 折叠
  container.querySelector('[data-collapse]').addEventListener('click', () => {
    container.querySelector('.collapse-wrap').classList.toggle('open');
  });

  const back = () => {
    // 未保存离开时提醒（有内容才提醒）
    if (hasFormContent(container)) {
      confirmDialog({
        title: '离开当前编辑？',
        message: '尚未生成或保存，返回列表将丢失本次填写的内容。',
        confirmText: '离开',
        onConfirm: () => navigate('listing'),
      });
    } else {
      navigate('listing');
    }
  };
  container.querySelector('[data-back]').addEventListener('click', back);
  container.querySelector('[data-cancel]').addEventListener('click', back);

  container.querySelector('[data-import]').addEventListener('click', () => {
    openLibraryPicker((prodId) => {
      const prod = getProduct(prodId);
      if (!prod) return;
      // 覆盖当前表单
      state.formData = {
        ...readForm(container, uploader),
        image: prod.image || uploader.getValue(),
        name: prod.name || '',
        amazonUrl: prod.amazonUrl || '',
        category: prod.category || '',
        site: prod.site || 'US',
        sellingPoints: prod.description || '',
        supply1688: (prod.supplies || []).map((s) => s.link).filter(Boolean).join(' / ') || prod.supply1688 || '',
        supplies: prod.supplies || [],
        quote: prod.quote || null,
      };
      toastSuccess(`已导入「${prod.name}」，可继续补充卖点后生成`);
      // 直接重绘表单，而不是重新走 route 渲染（后者会重置 state.formData）
      container.innerHTML = '';
      renderForm(container, { navigate });
    });
  });

  container.querySelector('[data-generate]').addEventListener('click', () => {
    const formData = readForm(container, uploader);
    // 校验必填
    const errors = [];
    if (!formData.image) errors.push('产品图片（点击上传或 Ctrl+V 粘贴）');
    if (!formData.name) errors.push('产品名称');
    if (!formData.category) errors.push('产品类目');
    if (!formData.site) errors.push('目标站点');
    if (!formData.sellingPoints.trim()) errors.push('核心卖点');
    if (errors.length) {
      toastError(`请先完善必填信息：${errors.join('、')}`);
      return;
    }
    if (!hasApiKey()) {
      confirmDialog({
        title: '尚未配置 AI 服务',
        message: '生成前需要配置 DeepSeek API Key。现在前往「设置」配置？',
        confirmText: '去设置',
        onConfirm: () => navigate('settings'),
      });
      return;
    }
    state.formData = formData;
    startGenerate(container, { navigate, editing });
  });
}

/** 读取表单数据 */
function readForm(container, uploader) {
  const val = (k) => {
    const el = container.querySelector(`[data-f="${k}"]`);
    return el ? el.value.trim() : '';
  };
  let site = 'US';
  const activeChip = container.querySelector('[data-sites] .site-chip.active');
  if (activeChip) site = activeChip.dataset.site;

  return {
    ...EMPTY_FORM(),
    image: uploader.getValue(),
    name: val('name'),
    category: val('category'),
    site,
    sellingPoints: val('sellingPoints'),
    competitorUrl: val('competitorUrl'),
    competitorText: val('competitorText'),
    keywords: val('keywords'),
    brand: val('brand'),
    bannedWords: val('bannedWords'),
    spec: val('spec'),
    color: val('color'),
    size: val('size'),
    material: val('material'),
    amazonUrl: (state.formData && state.formData.amazonUrl) || '',
    supply1688: (state.formData && state.formData.supply1688) || '',
    supplies: (state.formData && state.formData.supplies) || [],
    quote: (state.formData && state.formData.quote) || null,
  };
}

function hasFormContent(container) {
  const vals = container.querySelectorAll('[data-f]');
  for (const v of vals) if (v.value.trim()) return true;
  return false;
}

/** 生成流程（含进度遮罩） */
async function startGenerate(container, { navigate, editing }) {
  const productInfo = state.formData;

  // 生成进度遮罩
  const overlay = document.createElement('div');
  overlay.className = 'generating-overlay';
  overlay.innerHTML = `
    <div class="gen-progress">
      <div class="gp-icon">
        <div class="ring"></div>
        ${icon('sparkles')}
      </div>
      <div class="gp-title">AI 正在创作你的 Listing…</div>
      <div class="gp-sub">调用 DeepSeek 生成标题 / 五点 / 描述 / 关键词 / 图片文案</div>
      <div class="gp-steps" data-steps></div>
    </div>`;
  const stepsBox = overlay.querySelector('[data-steps]');
  const stageDefs = [
    { key: 'prep', label: '准备产品信息' },
    { key: 'title', label: '生成 Amazon 标题' },
    { key: 'bullets', label: '生成五点描述' },
    { key: 'description', label: '生成产品描述' },
    { key: 'searchTerms', label: '生成后台关键词' },
    { key: 'imageSuggestions', label: '生成图片文案建议' },
    { key: 'competitor', label: '竞品分析' },
    { key: 'done', label: '完成' },
  ];
  const steps = stageDefs.map((s) => {
    const el = document.createElement('div');
    el.className = 'gp-step';
    el.dataset.key = s.key;
    el.innerHTML = `<span class="gs-dot"></span><span>${s.label}</span>`;
    stepsBox.appendChild(el);
    return el;
  });
  function setStage(key) {
    steps.forEach((el) => {
      const k = el.dataset.key;
      el.classList.toggle('active', k === key);
      el.classList.toggle('done', stageDefs.findIndex((s) => s.key === k) < stageDefs.findIndex((s) => s.key === key) && key !== 'fail');
    });
  }
  setStage('prep');
  container.appendChild(overlay);

  try {
    const results = await generateFullListing(productInfo, {
      onStage: (s) => setStage(s.key),
    });

    // 组装项目
    const payload = {
      productId: state.project?.productId ?? (state.project ? state.project.productId : null),
      productInfo,
      title: results.title || '',
      bulletPoints: results.bullets || [],
      description: results.description || '',
      searchTerms: results.terms || [],
      imageSuggestions: results.imageSuggestions || { main: '', bullets: [], aPlus: [] },
      competitorAnalysis: results.competitorAnalysis || '',
      competitorWarn: results.competitorWarn || '',
      status: 'generated',
    };

    let project;
    if (state.project?.id) {
      project = updateProjectTracked(state.project.id, payload);
    } else {
      project = createProjectTracked(payload);
    }
    state.project = project;
    state.view = 'result';

    overlay.remove();
    // 重绘结果页
    container.innerHTML = '';
    renderResult(container, { navigate });
    toastSuccess('Listing 生成完成，可继续编辑或保存');
  } catch (e) {
    overlay.remove();
    toastError(`AI 生成失败，请检查 AI 服务配置。${e.message ? `（${e.message}）` : ''}`);
  }
}

/* ============================================================
 * 视图三：生成结果
 * ============================================================ */
function renderResult(container, { navigate }) {
  const p = state.project;
  if (!p) { state.view = 'list'; renderList(container, { navigate }); return; }
  const info = p.productInfo || {};
  const siteInfo = AMAZON_SITES.find((s) => s.code === info.site);

  container.innerHTML = `
    <div class="listing-steps">
      <div class="step-item done"><div class="step-dot">✓</div><span class="step-label">填写产品信息</span></div>
      <div class="step-line"></div>
      <div class="step-item done"><div class="step-dot">✓</div><span class="step-label">AI 生成</span></div>
      <div class="step-line"></div>
      <div class="step-item active"><div class="step-dot">3</div><span class="step-label">编辑与保存</span></div>
      <span class="flex-1"></span>
      <button class="btn btn-ghost btn-sm" data-list>项目列表</button>
    </div>

    <div class="result-layout">
      <!-- 顶部：产品信息卡（固定高度） -->
      <div class="card result-product-card" data-product-card>
        ${info.image ? `<img class="rp-thumb" src="${esc(info.image)}" alt="">` : '<div class="rp-thumb no-img">无图</div>'}
        <div class="rp-info">
          <div class="rp-name">${esc(info.name || '未命名产品')}</div>
          <div class="rp-meta">
            ${info.category ? `<span class="tag tag-primary">${esc(info.category)}</span>` : ''}
            ${info.site ? `<span class="tag tag-blue">${esc(siteInfo ? siteInfo.flag + ' ' + siteInfo.label : info.site)}</span>` : ''}
            ${info.brand ? `<span class="tag">${esc(info.brand)}</span>` : ''}
            ${(info.supplies || []).length
              ? `<span class="tag" style="color:var(--amber);background:var(--amber-soft);border-color:#F3DFB0">1688 货源 ×${info.supplies.length}</span>`
              : (info.supply1688 ? `<span class="tag tag-amber" style="color:var(--amber)">1688 货源</span>` : '')}
            ${info.quote && info.quote.result && info.quote.result.price
              ? `<span class="tag tag-green">建议售价 $${info.quote.result.price}</span>` : ''}
            ${p.status === 'saved' ? '<span class="tag tag-green">已保存</span>' : '<span class="tag tag-blue">已生成</span>'}
          </div>
          <div class="rp-sell">${esc(info.sellingPoints || '')}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-editinfo title="编辑产品信息">${icon('edit')} 编辑信息</button>
      </div>

      <div data-results></div>

      <!-- 底部操作区 -->
      <div class="result-actions">
        <span class="ra-note">${p.status === 'saved' ? '已保存 · 修改后请再次保存' : '生成内容尚未保存为正式项目'}</span>
        <span class="ra-spacer"></span>
        <button class="btn btn-ghost" data-copyall>${icon('copy')} 复制全部</button>
        <button class="btn btn-soft" data-regenall>${icon('refresh')} 重新生成全部</button>
        <button class="btn btn-primary" data-save>${icon('save')} 保存项目</button>
      </div>
    </div>
  `;

  const resultsBox = container.querySelector('[data-results]');

  // 标题
  resultsBox.appendChild(genBlock({
    badge: 'Title',
    title: 'Amazon 标题',
    tip: p.title ? `${p.title.length} / 200 字符` : '',
    content: () => `<div class="gen-title">${esc(p.title || '（尚未生成）')}</div>`,
    editContent: () => `<textarea class="result-textarea" data-edit-val rows="3">${esc(p.title || '')}</textarea>`,
    onCopy: () => copyText(p.title || ''),
    onRegen: (setBusy) => regenSection('title', p, (nv) => { p.title = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    onSaveEdit: (val) => { p.title = val; },
  }));

  // 五点描述
  resultsBox.appendChild(genBlock({
    badge: 'Bullet Points',
    title: '五点描述',
    tip: Array.isArray(p.bulletPoints) ? `${p.bulletPoints.filter(Boolean).length} / 5 条` : '0 / 5 条',
    content: () => {
      const bullets = Array.isArray(p.bulletPoints) && p.bulletPoints.length ? p.bulletPoints : ['', '', '', '', ''];
      return `<div class="bullet-list">${bullets.map((b, i) => `
        <div class="bullet-item">
          <div class="bullet-num">${i + 1}</div>
          <div class="bullet-text">${b ? esc(b) : '<span class="faint">（未生成）</span>'}</div>
        </div>`).join('')}</div>`;
    },
    editContent: () => {
      const bullets = Array.isArray(p.bulletPoints) && p.bulletPoints.length ? p.bulletPoints : ['', '', '', '', ''];
      return `<div class="bullet-list">${bullets.map((b, i) => `
        <div class="bullet-item" style="align-items:flex-start">
          <div class="bullet-num">${i + 1}</div>
          <textarea class="result-textarea" data-edit-val="${i}" rows="3" style="min-height:0">${esc(b)}</textarea>
        </div>`).join('')}</div>`;
    },
    onCopy: () => copyText((p.bulletPoints || []).filter(Boolean).map((b, i) => `${i + 1}. ${b}`).join('\n\n')),
    onRegen: (setBusy) => regenSection('bullets', p, (nv) => { p.bulletPoints = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    onSaveEdit: (vals) => { p.bulletPoints = vals.map((v) => v.trim()); },
  }));

  // 产品描述
  resultsBox.appendChild(genBlock({
    badge: 'Description',
    title: 'Product Description',
    tip: '支持简单 HTML',
    content: () => `<div class="gen-desc-text">${esc(p.description || '（尚未生成）')}</div>`,
    editContent: () => `<textarea class="result-textarea" data-edit-val rows="8">${esc(p.description || '')}</textarea>`,
    onCopy: () => copyText(p.description || ''),
    onRegen: (setBusy) => regenSection('description', p, (nv) => { p.description = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    onSaveEdit: (val) => { p.description = val; },
  }));

  // Search Terms
  resultsBox.appendChild(genBlock({
    badge: 'Search Terms',
    title: '后台关键词',
    tip: Array.isArray(p.searchTerms) ? `${p.searchTerms.length} 个（已去重）` : '0 个',
    content: () => {
      const terms = Array.isArray(p.searchTerms) ? p.searchTerms : [];
      return `<div class="search-terms-box">${
        terms.length ? terms.map((t) => `<span class="term-chip">${esc(t)}</span>`).join('')
        : '<span class="faint">（尚未生成）</span>'}</div>`;
    },
    editContent: () => `<textarea class="result-textarea" data-edit-val rows="5" placeholder="每行一个关键词，或空格/逗号分隔">${esc((p.searchTerms || []).join('\n'))}</textarea>`,
    onCopy: () => copyText((p.searchTerms || []).join(', ')),
    onRegen: (setBusy) => regenSection('searchTerms', p, (nv) => { p.searchTerms = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    onSaveEdit: (val) => {
      p.searchTerms = [...new Set(val.split(/[\s,，;；\n]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
    },
  }));

  // 图片文案建议
  const img = p.imageSuggestions || { main: '', bullets: [], aPlus: [] };
  resultsBox.appendChild(genBlock({
    badge: 'Image Copy',
    title: '图片文案建议',
    tip: '主图 / 五点图 / A+ 模块',
    content: () => `
      <div class="img-suggest-grid">
        <div class="img-suggest-card">
          <div class="isc-title">${icon('image')} 主图卖点</div>
          <div class="isc-body">${esc(img.main || '（尚未生成）')}</div>
        </div>
        <div class="img-suggest-card">
          <div class="isc-title">${icon('list')} 五点图文案</div>
          <div class="isc-body">${(img.bullets || []).length ? img.bullets.map((b, i) => `${i + 1}. ${b}`).join('\n') : '（尚未生成）'}</div>
        </div>
        <div class="img-suggest-card">
          <div class="isc-title">${icon('sparkles')} A+ 模块文案方向</div>
          <div class="isc-body">${(img.aPlus || []).length ? img.aPlus.map((a) => `【${a.title}】${a.body}`).join('\n\n') : '（尚未生成）'}</div>
        </div>
      </div>`,
    editContent: () => `
      <div class="form-grid">
        <div class="field span-2">
          <div class="field-label">主图卖点</div>
          <textarea class="result-textarea" data-edit-img="main" rows="2">${esc(img.main || '')}</textarea>
        </div>
        <div class="field span-2">
          <div class="field-label">五点图文案 <span class="hint">每行一条</span></div>
          <textarea class="result-textarea" data-edit-img="bullets" rows="5">${esc((img.bullets || []).map((b, i) => `${i + 1}. ${b}`).join('\n'))}</textarea>
        </div>
        <div class="field span-2">
          <div class="field-label">A+ 模块文案 <span class="hint">每行一条：【标题】内容</span></div>
          <textarea class="result-textarea" data-edit-img="aPlus" rows="5">${esc((img.aPlus || []).map((a) => `【${a.title}】${a.body}`).join('\n'))}</textarea>
        </div>
      </div>`,
    onCopy: () => copyText(`【主图卖点】\n${img.main || ''}\n\n【五点图文案】\n${(img.bullets || []).map((b, i) => `${i + 1}. ${b}`).join('\n')}\n\n【A+ 模块】\n${(img.aPlus || []).map((a) => `【${a.title}】${a.body}`).join('\n')}`),
    onRegen: (setBusy) => regenSection('imageSuggestions', p, (nv) => { p.imageSuggestions = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    onSaveEdit: (vals) => {
      p.imageSuggestions = {
        main: vals.main || '',
        bullets: (vals.bullets || '').split('\n').map((s) => s.replace(/^\d+\.\s*/, '').trim()).filter(Boolean),
        aPlus: (vals.aPlus || '').split('\n').map((line) => {
          const m = line.match(/^【(.+?)】(.+)$/);
          return m ? { title: m[1].trim(), body: m[2].trim() } : { title: '', body: line.trim() };
        }).filter((a) => a.title || a.body),
      };
    },
  }));

  // 竞品分析
  const ca = p.competitorAnalysis;
  if (ca && (ca.titleStructure || (ca.highFrequencyKeywords || []).length)) {
    const block = genBlock({
      badge: 'Competitor',
      title: '竞品分析',
      tip: '标题结构 / 关键词 / 卖点 / 差异化机会',
      content: () => `
        <div class="competitor-grid">
          <div class="competitor-card">
            <div class="cb-title">${icon('target')} 标题结构</div>
            <div class="cb-body">${esc(ca.titleStructure || '')}</div>
          </div>
          ${(ca.highFrequencyKeywords || []).length ? `
          <div class="competitor-card">
            <div class="cb-title">${icon('tag')} 高频关键词</div>
            <div class="cb-body">${(ca.highFrequencyKeywords || []).map((k) => `#${esc(k)}`).join('　')}</div>
          </div>` : ''}
          ${(ca.sellingAngles || []).length ? `
          <div class="competitor-card">
            <div class="cb-title">${icon('zap')} 竞品卖点方向</div>
            <div class="cb-body">${(ca.sellingAngles || []).map((a, i) => `${i + 1}. ${esc(a)}`).join('\n')}</div>
          </div>` : ''}
          ${(ca.differentiationOpportunities || []).length ? `
          <div class="competitor-card">
            <div class="cb-title">${icon('target')} 差异化机会</div>
            <div class="cb-body">${(ca.differentiationOpportunities || []).map((a, i) => `${i + 1}. ${esc(a)}`).join('\n')}</div>
          </div>` : ''}
          ${(ca.optimizationSuggestions || []).length ? `
          <div class="competitor-card">
            <div class="cb-title">${icon('sparkles')} Listing 优化建议</div>
            <div class="cb-body">${(ca.optimizationSuggestions || []).map((a, i) => `${i + 1}. ${esc(a)}`).join('\n')}</div>
          </div>` : ''}
        </div>`,
      onCopy: () => copyText(JSON.stringify(ca, null, 2)),
      onRegen: (setBusy) => regenSection('competitor', p, (nv) => { p.competitorAnalysis = nv; resultsBox.replaceChildren(...[]); renderResult(container, { navigate }); }, setBusy),
    });
    resultsBox.appendChild(block);
  }
  if (p.competitorWarn) {
    resultsBox.insertAdjacentHTML('beforeend', `
      <div class="card card-pad" style="border-color:var(--primary-border);background:var(--card-soft)">
        <div style="font-size:13px;color:var(--amber);line-height:1.6">⚠️ ${esc(p.competitorWarn)}</div>
      </div>`);
  }

  // 事件绑定
  container.querySelector('[data-list]').addEventListener('click', () => navigate('listing'));
  container.querySelector('[data-editinfo]').addEventListener('click', () => {
    // 保存当前改动到 productInfo 后进入表单编辑
    saveProject(p, false);
    navigate(`listing:edit:${p.id}`);
  });
  container.querySelector('[data-save]').addEventListener('click', () => {
    saveProject(p, true);
    toastSuccess('项目已保存，刷新后仍然存在');
    renderResult(container, { navigate });
  });
  container.querySelector('[data-regenall]').addEventListener('click', () => {
    confirmDialog({
      title: '重新生成全部',
      message: '将基于当前产品信息重新生成所有内容（标题 / 五点 / 描述 / 关键词 / 图片文案），当前编辑内容将被覆盖。',
      confirmText: '重新生成',
      onConfirm: () => {
        container.innerHTML = '';
        state.view = 'form';
        // 保留 productInfo，回到表单直接触发生成
        renderForm(container, { navigate });
        // 触发生成
        const fake = { querySelector: () => null };
        // 直接调用生成（表单已重建，readForm 用 state.formData）
        startGenerateDirect(container, { navigate });
      },
    });
  });
  container.querySelector('[data-copyall]').addEventListener('click', async () => {
    const text = buildFullText(p);
    const ok = await copyText(text);
    ok ? toastSuccess('已复制全部内容') : toastError('复制失败，请手动选择复制');
  });
}

/** 重新生成单分区 */
async function regenSection(section, project, onDone, setBusy) {
  setBusy(true);
  try {
    const part = await generateSection(project.productInfo, section, '');
    onDone(part[section === 'bullets' ? 'bullets' : section === 'searchTerms' ? 'terms' : section === 'imageSuggestions' ? 'imageSuggestions' : section]);
  } catch (e) {
    toastError(`AI 生成失败，请检查 AI 服务配置。（${e.message}）`);
  } finally {
    setBusy(false);
  }
}

/** 重新生成全部（从表单状态直接触发） */
async function startGenerateDirect(container, { navigate }) {
  const productInfo = state.formData;
  // 校验
  if (!productInfo.name || !productInfo.sellingPoints) {
    toastError('请先完善必填信息');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'generating-overlay';
  overlay.innerHTML = `
    <div class="gen-progress">
      <div class="gp-icon"><div class="ring"></div>${icon('sparkles')}</div>
      <div class="gp-title">AI 正在重新生成…</div>
      <div class="gp-steps" data-steps></div>
    </div>`;
  container.appendChild(overlay);
  const stepsBox = overlay.querySelector('[data-steps]');
  const labels = ['生成 Amazon 标题', '生成五点描述', '生成产品描述', '生成后台关键词', '生成图片文案建议', '竞品分析'];
  const stepEls = labels.map((l) => {
    const el = document.createElement('div');
    el.className = 'gp-step';
    el.innerHTML = `<span class="gs-dot"></span><span>${l}</span>`;
    stepsBox.appendChild(el);
    return el;
  });
  let idx = 0;
  const setStage = (i) => {
    stepEls.forEach((el, j) => {
      el.classList.toggle('active', j === i);
      el.classList.toggle('done', j < i);
    });
  };
  setStage(0);

  try {
    const results = await generateFullListing(productInfo, {
      onStage: (s) => {
        const i = ['title', 'bullets', 'description', 'searchTerms', 'imageSuggestions', 'competitor'].indexOf(s.key);
        if (i >= 0) setStage(i);
      },
    });
    const payload = {
      productId: state.project?.productId ?? null,
      productInfo,
      title: results.title || '',
      bulletPoints: results.bullets || [],
      description: results.description || '',
      searchTerms: results.terms || [],
      imageSuggestions: results.imageSuggestions || { main: '', bullets: [], aPlus: [] },
      competitorAnalysis: results.competitorAnalysis || '',
      competitorWarn: results.competitorWarn || '',
      status: 'generated',
    };
    const project = state.project?.id
      ? updateProjectTracked(state.project.id, payload)
      : createProjectTracked(payload);
    state.project = project;
    overlay.remove();
    container.innerHTML = '';
    renderResult(container, { navigate });
    toastSuccess('已重新生成');
  } catch (e) {
    overlay.remove();
    toastError(`AI 生成失败，请检查 AI 服务配置。（${e.message}）`);
    container.innerHTML = '';
    renderResult(container, { navigate });
  }
}

/** 保存项目（写入 localStorage） */
function saveProject(project, markSaved) {
  const payload = {
    ...project,
    status: markSaved ? 'saved' : (project.status || 'generated'),
    productInfo: state.formData || project.productInfo,
  };
  updateProjectTracked(project.id, payload);
  Object.assign(project, payload);
  state.project = project;
}

/** 生成块组件（带 编辑/复制/重新生成 操作） */
function genBlock({ badge, title, tip, content, editContent, onCopy, onRegen, onSaveEdit }) {
  const block = document.createElement('div');
  block.className = 'card gen-block';

  const head = document.createElement('div');
  head.className = 'gen-block-head';
  head.innerHTML = `
    <div class="gen-block-title"><span class="gb-badge">${badge}</span>${title}${tip ? `<span class="faint small" style="font-weight:400">${tip}</span>` : ''}</div>
    <div class="gen-block-actions">
      <button class="btn btn-ghost btn-sm" data-copy>${icon('copy')} 复制</button>
      <button class="btn btn-soft btn-sm" data-edit>${icon('edit')} 编辑</button>
      <button class="btn btn-primary btn-sm" data-regen>${icon('refresh')} 重新生成</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'gen-block-body content-area';
  body.innerHTML = content();

  block.appendChild(head);
  block.appendChild(body);

  // 复制
  head.querySelector('[data-copy]').addEventListener('click', async () => {
    const ok = await copyText(onCopy());
    ok ? toastSuccess('已复制') : toastError('复制失败');
  });

  // 重新生成
  head.querySelector('[data-regen]').addEventListener('click', () => {
    const btn = head.querySelector('[data-regen]');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spin"></span> 生成中';
    onRegen((busy) => {
      btn.disabled = !busy;
      btn.innerHTML = busy ? '<span class="btn-spin"></span> 生成中' : `${icon('refresh')} 重新生成`;
    });
  });

  // 编辑
  const editBtn = head.querySelector('[data-edit]');
  editBtn.addEventListener('click', () => {
    const editing = body.dataset.editing === '1';
    if (editing) {
      // 保存编辑
      let vals;
      if (body.querySelector('[data-edit-img]')) {
        vals = {};
        body.querySelectorAll('[data-edit-img]').forEach((ta) => { vals[ta.dataset.editImg] = ta.value; });
      } else {
        vals = [...body.querySelectorAll('[data-edit-val]')].map((ta) => ta.value);
      }
      onSaveEdit(vals);
      body.innerHTML = content();
      body.dataset.editing = '';
      editBtn.innerHTML = `${icon('edit')} 编辑`;
      toastSuccess('已更新内容');
    } else {
      body.innerHTML = editContent();
      body.dataset.editing = '1';
      editBtn.innerHTML = `${icon('check')} 完成`;
    }
  });

  return block;
}

/** 从选品库选择导入 */
function openLibraryPicker(onPick) {
  const products = listProducts();
  if (!products.length) {
    openModal({
      title: '从选品库导入',
      width: 'normal',
      body: `<div class="empty-state">
        <div class="empty-icon" style="background:var(--blue-soft)">${icon('box')}</div>
        <div class="empty-title">选品库为空</div>
        <div class="empty-sub">可先在「选品库」添加产品，或直接独立创建 Listing</div>
      </div>`,
    });
    return;
  }
  const body = document.createElement('div');
  body.innerHTML = `
    <div style="margin-bottom:12px">
      <input class="input" data-search placeholder="搜索产品…">
    </div>
    <div class="lib-pick-list" data-list></div>`;

  const listEl = body.querySelector('[data-list]');
  function renderList(kw = '') {
    const list = products.filter((p) => `${p.name}${p.category}`.toLowerCase().includes(kw.toLowerCase()));
    listEl.innerHTML = list.length ? list.map((p) => `
      <div class="lib-pick-item" data-id="${p.id}">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<div style="width:46px;height:46px;border-radius:10px;background:var(--bg-deep);display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:10.5px">无图</div>'}
        <div class="flex-1" style="min-width:0">
          <div class="lp-name truncate">${esc(p.name || '未命名产品')}</div>
          <div class="lp-meta">${esc(p.category || '未分类')} · ${esc(p.site || 'US')} 站</div>
        </div>
        <span class="tag tag-primary">导入</span>
      </div>`).join('')
      : '<div class="empty-state" style="padding:24px"><div class="empty-sub">没有匹配的产品</div></div>';
  }
  renderList();
  body.querySelector('[data-search]').addEventListener('input', (e) => renderList(e.target.value));
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    m.close();
    onPick && onPick(item.dataset.id);
  });

  const m = openModal({ title: `从选品库导入（${products.length} 个产品）`, body, width: 'normal' });
}

/** 组装全部文本（复制全部） */
function buildFullText(p) {
  const info = p.productInfo || {};
  const img = p.imageSuggestions || {};
  const lines = [];
  lines.push(`【产品】${info.name || ''}`);
  lines.push(`【站点】${info.site || 'US'}   【类目】${info.category || ''}`);
  lines.push('');
  lines.push('【Amazon 标题】');
  lines.push(p.title || '');
  lines.push('');
  lines.push('【五点描述】');
  (p.bulletPoints || []).forEach((b, i) => { if (b) lines.push(`${i + 1}. ${b}`); });
  lines.push('');
  lines.push('【Product Description】');
  lines.push(p.description || '');
  lines.push('');
  lines.push('【Search Terms（后台关键词）】');
  lines.push((p.searchTerms || []).join(', '));
  lines.push('');
  lines.push('【图片文案建议】');
  lines.push(`主图卖点：${img.main || ''}`);
  lines.push(`五点图文案：\n${(img.bullets || []).map((b, i) => `${i + 1}. ${b}`).join('\n')}`);
  lines.push(`A+ 模块：\n${(img.aPlus || []).map((a) => `【${a.title}】${a.body}`).join('\n')}`);
  if (p.competitorAnalysis) {
    lines.push('');
    lines.push('【竞品分析】');
    lines.push(JSON.stringify(p.competitorAnalysis, null, 2));
  }
  return lines.join('\n');
}
