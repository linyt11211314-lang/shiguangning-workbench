/**
 * 设置页（按工作台设置布局重设计）
 * 左侧子导航 + 右侧分区卡片：外观与主题 / AI 服务接入 / 默认参数 / 数据与备份 / 使用说明
 */
import { icon } from '../ui/icons.js';
import { esc } from '../utils.js';
import {
  getSettings,
  saveSettings,
  saveTheme,
  applyTheme,
  syncFollowSystem,
  hasApiKey,
  maskedKey,
} from '../store/settingsStore.js';
import { DEEPSEEK_MODELS, AMAZON_SITES, PER_SITE_RATES } from '../config.js';
import { testConnection } from '../services/aiProvider.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';
import { downloadBackup, parseBackupFile, summarizeBackup, applyBackup } from '../services/dataBackup.js';
import { confirmDialog } from '../ui/modal.js';

/** 主题色选项（含色卡配色 + 文案） */
const THEME_OPTIONS = [
  { id: 'default', label: '荧光黄', caption: '明亮 · 活力', colors: ['#F9FFCE', '#D3EF2E', '#B6E000'], ring: '#D3EF2E' },
  { id: 'pink', label: '蜜桃粉', caption: '温柔 · 甜美', colors: ['#FFE3F0', '#FF6E9E', '#FF9EC2'], ring: '#FF6E9E' },
  { id: 'rose', label: '玫红', caption: '热情 · 醒目', colors: ['#FFC2D4', '#D61F52', '#E6396F'], ring: '#E6396F' },
  { id: 'mistblue', label: '雾蓝', caption: '清爽 · 宁静', colors: ['#DCEAFB', '#7FA6D8', '#A9C5E8'], ring: '#8FA9CE' },
  { id: 'green', label: '果绿', caption: '自然 · 治愈', colors: ['#D9FBE8', '#16A95C', '#5FD99A'], ring: '#2ED57F' },
];

const SECTIONS = [
  { id: 'appearance', label: '外观与主题' },
  { id: 'ai', label: 'AI 服务接入' },
  { id: 'defaults', label: '默认参数' },
  { id: 'backup', label: '数据与备份' },
  { id: 'help', label: '使用说明' },
];

export function render(container, { rerender }) {
  const settings = getSettings();
  const configured = hasApiKey();
  const keyValue = settings.apiKey || '';
  const qd = settings.quoteDefaults || { volWeightDivisor: 6000, sites: {} };

  container.innerHTML = `
    <div class="settings-page">
      <aside class="settings-sidebar">
        ${SECTIONS.map((s, i) => `<div class="settings-nav-item ${i === 0 ? 'active' : ''}" data-sec="${s.id}"><span class="nav-dot"></span>${s.label}</div>`).join('')}
      </aside>
      <div class="settings-main">
        <div class="settings-header">
          <div class="settings-kicker">WORKSPACE PREFERENCES</div>
          <div class="settings-title">工作台设置</div>
          <div class="settings-desc">把这里调整成真正属于你的产品开发空间。</div>
        </div>

        <!-- 外观与主题 -->
        <section class="settings-section active" data-section="appearance">
          <div class="section-card">
            <div class="card-title">主题外观</div>
            <div class="card-sub">背景明暗 + 主题色，切换即时生效并自动保存。</div>

            <div class="set-row">
              <div class="set-info">
                <div class="set-name">背景模式</div>
                <div class="set-desc">${settings.mode === 'dark' ? '深色（黑色背景）' : '浅色（白色背景）'}</div>
              </div>
              <div class="set-control">
                <div class="segmented" data-mode>
                  <button class="seg-item ${settings.mode !== 'dark' ? 'active' : ''}" data-mode="light">☀️ 浅色</button>
                  <button class="seg-item ${settings.mode === 'dark' ? 'active' : ''}" data-mode="dark">🌙 深色</button>
                </div>
              </div>
            </div>

            <div class="set-row" style="border-bottom:none">
              <div class="set-info">
                <div class="set-name">主题色</div>
                <div class="set-desc">主按钮 / 导航高亮 / 徽标 / 图标的主色调</div>
              </div>
            </div>
            <div class="theme-cards" data-themes>
              ${THEME_OPTIONS.map((t) => `
                <div class="theme-card ${settings.primary === t.id ? 'active' : ''}" data-theme="${t.id}">
                  <div class="theme-check">✓</div>
                  <div class="theme-stripe">${t.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
                  <div class="theme-label">${t.label}</div>
                  <div class="theme-caption">${t.caption}</div>
                </div>`).join('')}
            </div>
            <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-reset-theme>${icon('refresh')} 恢复默认</button></div>
          </div>

          <div class="section-card">
            <div class="card-title">显示偏好</div>
            <div class="card-sub">调整页面密度、字号与圆角，让工作台更顺手。</div>
            <div class="pref-grid">
              <div class="pref-item">
                <div class="pref-name">页面密度</div>
                <div class="pref-segmented" data-pref="density">
                  <button data-v="compact" class="${settings.density === 'compact' ? 'active' : ''}">紧凑</button>
                  <button data-v="comfortable" class="${settings.density === 'comfortable' ? 'active' : ''}">适中</button>
                  <button data-v="cozy" class="${settings.density === 'cozy' ? 'active' : ''}">宽松</button>
                </div>
              </div>
              <div class="pref-item">
                <div class="pref-name">字体大小</div>
                <div class="pref-segmented" data-pref="fontSize">
                  <button data-v="small" class="${settings.fontSize === 'small' ? 'active' : ''}">小</button>
                  <button data-v="normal" class="${settings.fontSize === 'normal' ? 'active' : ''}">标准</button>
                  <button data-v="large" class="${settings.fontSize === 'large' ? 'active' : ''}">大</button>
                </div>
              </div>
              <div class="pref-item">
                <div class="pref-name">圆角风格</div>
                <div class="pref-segmented" data-pref="radius">
                  <button data-v="soft" class="${settings.radius === 'soft' ? 'active' : ''}">柔和</button>
                  <button data-v="sharp" class="${settings.radius === 'sharp' ? 'active' : ''}">锐利</button>
                </div>
              </div>
            </div>
            <div class="set-row" style="border-bottom:none;margin-top:14px">
              <div class="set-info">
                <div class="set-name">深色主题跟随系统</div>
                <div class="set-desc">开启后随系统浅色/深色自动切换（会覆盖上方背景模式）</div>
              </div>
              <div class="set-control">
                <label class="switch">
                  <input type="checkbox" data-follow ${settings.followSystem ? 'checked' : ''}>
                  <span class="track"></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- AI 服务接入 -->
        <section class="settings-section" data-section="ai">
          <div class="section-card">
            <div class="card-title">DeepSeek API 配置</div>
            <div class="card-sub">AI Listing 生成服务 · 数据仅保存在本地浏览器${configured ? '（<b style="color:var(--green)">已配置</b>）' : '（<b style="color:var(--red)">未配置</b>）'}</div>

            <div class="set-row">
              <div class="set-info">
                <div class="set-name">API Key</div>
                <div class="set-desc">${configured ? `当前：${maskedKey(keyValue)}（已保存）` : '前往 platform.deepseek.com 创建，格式 sk-...'}</div>
              </div>
            </div>
            <div class="api-key-box" style="margin-bottom:14px">
              <input class="input" data-apikey type="password" placeholder="sk-..." value="${esc(keyValue)}" autocomplete="off">
              <button class="btn btn-ghost" data-toggle type="button" style="flex-shrink:0">显示</button>
            </div>

            <div class="form-grid">
              <div class="field">
                <div class="field-label">模型</div>
                <select class="select" data-model>
                  ${DEEPSEEK_MODELS.map((m) => `<option value="${m.id}" ${settings.model === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <div class="field-label">创意温度 <span class="hint">${settings.temperature}</span></div>
                <input class="input" type="range" min="0" max="1.5" step="0.1" value="${settings.temperature}" data-temp style="padding:0;accent-color:var(--primary)">
              </div>
            </div>

            <div class="set-row" style="padding:6px 0 14px">
              <div class="set-info">
                <div class="set-name">生成后自动保存草稿</div>
                <div class="set-desc">AI 生成完成后自动写入项目列表（状态：已生成）</div>
              </div>
              <div class="set-control">
                <label class="switch">
                  <input type="checkbox" data-autosave ${settings.autoSave ? 'checked' : ''}>
                  <span class="track"></span>
                </label>
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-primary" data-save>${icon('save')} 保存配置</button>
              <button class="btn btn-soft" data-test>${icon('zap')} 测试连接</button>
              <button class="btn btn-ghost" data-clear>${icon('trash')} 清除 Key</button>
            </div>
            <div class="mt-16" data-test-result></div>
          </div>
        </section>

        <!-- 默认参数 -->
        <section class="settings-section" data-section="defaults">
          <div class="section-card">
            <div class="card-title">利润测算默认参数</div>
            <div class="card-sub">新建选品时自动套用；每个站点可独立设置默认值，弹窗内仍可临时修改。</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
              <button class="btn btn-ghost btn-sm" data-reset-qd>${icon('refresh')} 恢复内置默认</button>
              <button class="btn btn-primary btn-sm" data-save-qd>${icon('save')} 保存默认参数</button>
            </div>

            <div class="set-row" style="padding:6px 0 12px">
              <div class="set-info"><div class="set-name">体积重除数</div><div class="set-desc">头程计费重量 = 长×宽×高 ÷ 此数（与实重取较大值）</div></div>
              <div class="set-control"><input class="input input-sm" style="width:110px" type="number" min="1000" step="500" data-qd-vd value="${qd.volWeightDivisor}"></div>
            </div>
            <div class="set-row" style="padding:6px 0 12px">
              <div class="set-info"><div class="set-name">海运单价</div><div class="set-desc">头程费 = 计费重量 × 海运单价 ÷ 汇率（新建选品时自动填入）</div></div>
              <div class="set-control"><input class="input input-sm" style="width:110px" type="number" min="0" step="0.01" data-qd-sea value="${qd.seaFreightRate || ''}" placeholder="如 12"></div>
            </div>

            <div class="qd-table">
              <div class="qd-row qd-head">
                <span class="qd-check" title="全选/取消全选"><input type="checkbox" data-qd-check-all></span>
                <span>站点</span><span>汇率</span><span>目标利润%</span><span>广告%</span><span>佣金%</span><span>VAT%</span><span>仓储%</span><span>退货%</span>
              </div>
              <div class="qd-row qd-batch">
                <span class="qd-check qd-batch-tag"></span>
                <span class="qd-site qd-batch-tag" data-qd-count>已选 0</span>
                <input class="input input-sm" type="number" data-qd-batch="exchangeRate" placeholder="统一" title="批量设置勾选站点的汇率">
                <input class="input input-sm" type="number" data-qd-batch="targetProfitRate" placeholder="统一" title="批量设置勾选站点的目标利润率">
                <input class="input input-sm" type="number" data-qd-batch="adRate" placeholder="统一" title="批量设置勾选站点的广告费率">
                <input class="input input-sm" type="number" data-qd-batch="referralRate" placeholder="统一" title="批量设置勾选站点的佣金率">
                <input class="input input-sm" type="number" data-qd-batch="avtRate" placeholder="统一" title="批量设置勾选站点的VAT">
                <input class="input input-sm" type="number" data-qd-batch="storageRate" placeholder="统一" title="批量设置勾选站点的仓储率">
                <input class="input input-sm" type="number" data-qd-batch="returnRate" placeholder="统一" title="批量设置勾选站点的退货率">
              </div>
              ${AMAZON_SITES.map((s) => {
                const d = (qd.sites || {})[s.code] || {};
                const rates = PER_SITE_RATES[s.code] || PER_SITE_RATES.US;
                const v = (f, fb) => (d[f] != null && d[f] !== '' ? d[f] : fb);
                return `
                <div class="qd-row">
                  <span class="qd-check"><input type="checkbox" data-qd-check="${s.code}" title="勾选后参与批量设置"></span>
                  <span class="qd-site">${s.flag} ${s.code}</span>
                  <input class="input input-sm" type="number" min="0" step="0.001" data-qd="${s.code}:exchangeRate" value="${v('exchangeRate', s.rate)}">
                  <input class="input input-sm" type="number" min="0" max="90" step="1" data-qd="${s.code}:targetProfitRate" value="${v('targetProfitRate', 30)}">
                  <input class="input input-sm" type="number" min="0" max="60" step="1" data-qd="${s.code}:adRate" value="${v('adRate', 1)}">
                  <input class="input input-sm" type="number" min="0" max="45" step="1" data-qd="${s.code}:referralRate" value="${v('referralRate', 15)}">
                  <input class="input input-sm" type="number" min="0" max="30" step="0.1" data-qd="${s.code}:avtRate" value="${v('avtRate', rates.avt)}">
                  <input class="input input-sm" type="number" min="0" max="10" step="0.1" data-qd="${s.code}:storageRate" value="${v('storageRate', rates.storage)}">
                  <input class="input input-sm" type="number" min="0" max="50" step="0.5" data-qd="${s.code}:returnRate" value="${v('returnRate', rates.return)}">
                </div>`;
              }).join('')}
            </div>
          </div>
        </section>

        <!-- 数据与备份 -->
        <section class="settings-section" data-section="backup">
          <div class="section-card">
            <div class="card-title">数据备份 / 迁移</div>
            <div class="card-sub">导出全部本地数据为 JSON，换设备时再导入恢复（选品库 / Listing 项目 / 设置 / 统计）</div>
            <div style="font-size:13px;line-height:1.85;color:var(--text-sub);margin-bottom:14px">
              <div>· 数据仅保存在你当前浏览器，换电脑 / 换浏览器会丢失，建议定期备份。</div>
              <div>· 导入为<strong>覆盖式</strong>：会用备份替换当前设备数据，导入前可先点「导出数据」留底。</div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-primary" data-backup-export>${icon('download')} 导出数据（JSON）</button>
              <button class="btn btn-soft" data-backup-import>${icon('upload')} 导入数据（JSON）</button>
            </div>
          </div>
        </section>

        <!-- 使用说明 -->
        <section class="settings-section" data-section="help">
          <div class="section-card">
            <div class="card-title">使用说明</div>
            <div class="card-sub">AI Listing 工坊工作流</div>
            <div style="font-size:13.5px;line-height:1.9;color:var(--text-sub)">
              <div>1. <b style="color:var(--text)">填写产品信息</b>：上传图片（支持 Ctrl+V 粘贴）、名称、类目、目标站点、核心卖点；可选填竞品链接、关键词、品牌、禁止词与规格。</div>
              <div>2. <b style="color:var(--text)">关联选品库</b>：从选品库导入产品素材，也可完全独立创建。</div>
              <div>3. <b style="color:var(--text)">AI 生成</b>：DeepSeek 自动生成标题、五点描述、产品描述、后台关键词、图片文案；填写竞品链接时附带竞品分析。</div>
              <div>4. <b style="color:var(--text)">编辑优化</b>：每个区块均可单独编辑、复制、重新生成。</div>
              <div>5. <b style="color:var(--text)">保存项目</b>：项目保存在本地浏览器，刷新后依然存在。</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  // ---------- 左侧子导航切换 ----------
  const navItems = container.querySelectorAll('.settings-nav-item');
  const sections = container.querySelectorAll('.settings-section');
  navItems.forEach((nav) => {
    nav.addEventListener('click', () => {
      const id = nav.dataset.sec;
      navItems.forEach((n) => n.classList.toggle('active', n === nav));
      sections.forEach((s) => s.classList.toggle('active', s.dataset.section === id));
    });
  });

  // ---------- 主题：背景模式 ----------
  container.querySelectorAll('[data-mode] .seg-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      saveTheme({ mode });
      container.querySelectorAll('[data-mode] .seg-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const desc = btn.closest('.set-row').querySelector('.set-desc');
      if (desc) desc.textContent = mode === 'dark' ? '深色（黑色背景）' : '浅色（白色背景）';
      toastSuccess(mode === 'dark' ? '已切换深色模式（黑底）' : '已切换浅色模式（白底）');
    });
  });

  // ---------- 主题：主题色卡片 ----------
  container.querySelectorAll('[data-theme]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const id = opt.dataset.theme;
      saveTheme({ primary: id });
      container.querySelectorAll('[data-theme]').forEach((o) => o.classList.toggle('active', o.dataset.theme === id));
      const t = THEME_OPTIONS.find((x) => x.id === id);
      toastSuccess(`已切换主题色：${t ? t.label : id}`);
    });
  });

  container.querySelector('[data-reset-theme]').addEventListener('click', () => {
    saveTheme({ mode: 'light', primary: 'default' });
    toastSuccess('已恢复默认主题（白色背景 · 荧光黄）');
    rerender();
  });

  // ---------- 显示偏好 ----------
  container.querySelectorAll('[data-pref]').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const key = seg.dataset.pref;
        const val = b.dataset.v;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        saveSettings({ [key]: val });
        applyTheme();
        toastSuccess('已应用显示偏好');
      });
    });
  });

  container.querySelector('[data-follow]').addEventListener('change', (e) => {
    saveSettings({ followSystem: e.target.checked });
    syncFollowSystem();
    applyTheme();
    toastSuccess(e.target.checked ? '已开启深色跟随系统' : '已关闭深色跟随系统');
  });

  // ---------- AI 服务接入 ----------
  const keyInput = container.querySelector('[data-apikey]');
  const toggleBtn = container.querySelector('[data-toggle]');
  toggleBtn.addEventListener('click', () => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? '隐藏' : '显示';
  });

  container.querySelector('[data-temp]').addEventListener('input', (e) => {
    container.querySelector('.field-label .hint').textContent = e.target.value;
  });

  container.querySelector('[data-save]').addEventListener('click', () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) { toastError('请填写 API Key'); return; }
    saveSettings({
      apiKey,
      model: container.querySelector('[data-model]').value,
      temperature: parseFloat(container.querySelector('[data-temp]').value),
      autoSave: container.querySelector('[data-autosave]').checked,
    });
    toastSuccess('配置已保存');
    rerender();
  });

  container.querySelector('[data-test]').addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) { toastError('请先填写 API Key'); return; }
    const prev = getSettings().apiKey;
    saveSettings({ apiKey });
    const btn = container.querySelector('[data-test]');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spin"></span> 测试中';
    const resultBox = container.querySelector('[data-test-result]');
    resultBox.innerHTML = '';
    try {
      const r = await testConnection();
      resultBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:12px;background:var(--green-soft);color:var(--green);font-size:13.5px">
          <b>✓ 连接成功</b> <span style="opacity:.8">DeepSeek API Key 可用 · 模型 ${esc(container.querySelector('[data-model]').value)}</span>
        </div>`;
      toastSuccess('API Key 验证通过');
      saveSettings({ apiKey: keyInput.value.trim() });
      rerender();
    } catch (e) {
      resultBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:9px;padding:12px 14px;border-radius:12px;background:var(--red-soft);color:var(--red);font-size:13.5px;line-height:1.6">
          <b>✕ 连接失败</b> <span style="opacity:.85">${esc(e.message)}</span>
        </div>`;
      toastError(`连接失败：${e.message}`);
      if (!prev) saveSettings({ apiKey: '' });
      rerender();
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('zap')} 测试连接`;
    }
  });

  container.querySelector('[data-clear]').addEventListener('click', () => {
    saveSettings({ apiKey: '' });
    toastInfo('已清除 API Key');
    rerender();
  });

  container.querySelector('[data-model]').addEventListener('change', (e) => {
    saveSettings({ model: e.target.value });
    toastSuccess('模型已切换');
  });
  container.querySelector('[data-autosave]').addEventListener('change', (e) => {
    saveSettings({ autoSave: e.target.checked });
  });

  // ---------- 利润测算默认参数 ----------
  const collectQd = () => {
    const sites = {};
    container.querySelectorAll('[data-qd]').forEach((el) => {
      const [code, field] = el.dataset.qd.split(':');
      if (!sites[code]) sites[code] = {};
      sites[code][field] = el.value === '' ? '' : Number(el.value);
    });
    return sites;
  };
  container.querySelector('[data-save-qd]').addEventListener('click', () => {
    const vd = Number(container.querySelector('[data-qd-vd]').value);
    const sea = container.querySelector('[data-qd-sea]').value.trim();
    saveSettings({
      quoteDefaults: {
        volWeightDivisor: vd > 0 ? vd : 6000,
        seaFreightRate: sea === '' ? '' : Number(sea),
        sites: collectQd(),
      },
    });
    toastSuccess('已保存利润测算默认参数（新建选品时生效）');
  });
  container.querySelector('[data-reset-qd]').addEventListener('click', () => {
    container.querySelector('[data-qd-vd]').value = 6000;
    container.querySelector('[data-qd-sea]').value = '';
    container.querySelectorAll('[data-qd]').forEach((el) => {
      const [code, field] = el.dataset.qd.split(':');
      const si = AMAZON_SITES.find((s) => s.code === code) || AMAZON_SITES[0];
      const rates = PER_SITE_RATES[code] || PER_SITE_RATES.US;
      const fb = { exchangeRate: si.rate, targetProfitRate: 30, adRate: 1, referralRate: 15, avtRate: rates.avt, storageRate: rates.storage, returnRate: rates.return };
      el.value = fb[field] != null ? fb[field] : '';
    });
    toastInfo('已恢复内置默认（点击「保存默认参数」生效）');
  });

  const qdChecks = () => container.querySelectorAll('[data-qd-check]');
  const qdCountEl = container.querySelector('[data-qd-count]');
  const qdCheckAllEl = container.querySelector('[data-qd-check-all]');
  const updateQdCount = () => {
    const all = qdChecks().length;
    const n = [...qdChecks()].filter((c) => c.checked).length;
    qdCheckAllEl.checked = n > 0 && n === all;
    qdCheckAllEl.indeterminate = n > 0 && n < all;
    if (qdCountEl) qdCountEl.textContent = n ? `已选 ${n}/${all}` : '已选 0';
  };
  qdCheckAllEl.addEventListener('change', (e) => {
    qdChecks().forEach((c) => { c.checked = e.target.checked; });
    updateQdCount();
  });
  qdChecks().forEach((c) => c.addEventListener('change', updateQdCount));
  const QD_FIELD_LABEL = { exchangeRate: '汇率', targetProfitRate: '目标利润%', adRate: '广告费率%', referralRate: '佣金率%', avtRate: 'VAT%', storageRate: '仓储%', returnRate: '退货率%' };
  container.querySelectorAll('[data-qd-batch]').forEach((el) => {
    const applyBatch = () => {
      const field = el.dataset.qdBatch;
      const v = el.value.trim();
      if (v === '') { toastInfo('请先输入要批量设置的值'); return; }
      const sel = [...qdChecks()].filter((c) => c.checked);
      if (!sel.length) { toastInfo('请先勾选要批量设置的站点（表头方框可全选）'); return; }
      sel.forEach((c) => {
        const input = container.querySelector(`[data-qd="${c.dataset.qdCheck}:${field}"]`);
        if (input) input.value = v;
      });
      toastSuccess(`已批量设置「${QD_FIELD_LABEL[field] || field}」= ${v}（${sel.length} 个站点）`);
      el.value = '';
    };
    el.addEventListener('change', applyBatch);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyBatch(); } });
  });

  // ---------- 数据备份 / 迁移 ----------
  const backupFileInput = document.createElement('input');
  backupFileInput.type = 'file';
  backupFileInput.accept = 'application/json,.json';
  backupFileInput.style.display = 'none';
  container.appendChild(backupFileInput);

  backupFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = await parseBackupFile(file);
      const s = summarizeBackup(parsed);
      const lines = [
        `${s.settings ? '✓' : '✗'} 设置 / API 配置`,
        `✓ 选品库 ${s.products} 条`,
        `✓ Listing 项目 ${s.projects} 条`,
        `${s.stats ? '✓' : '✗'} 统计`,
      ];
      if (s.hasApiKey) lines.push('（含已保存的 DeepSeek API Key）');
      confirmDialog({
        title: '确认导入备份',
        message: `即将用备份覆盖当前设备上的数据：\n\n${lines.join('\n')}\n\n覆盖后无法撤销，建议先「导出数据」留底。`,
        confirmText: '覆盖导入',
        danger: true,
        onConfirm: async () => {
          await applyBackup(parsed);
          toastSuccess('导入成功，正在刷新…');
          setTimeout(() => location.reload(), 600);
        },
      });
    } catch (err) {
      toastError(`导入失败：${err.message}`);
    }
  });

  container.querySelector('[data-backup-export]').addEventListener('click', async () => {
    await downloadBackup();
    toastSuccess('已导出备份文件（JSON）到本地下载目录');
  });
  container.querySelector('[data-backup-import]').addEventListener('click', () => backupFileInput.click());
}
