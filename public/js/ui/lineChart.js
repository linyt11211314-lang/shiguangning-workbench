/**
 * 轻量自绘 SVG 双轴折线图（无第三方依赖）
 * - 左轴：金额（花费 / 销售额）
 * - 右轴：ACOS（%）
 * - 悬停数据点显示 tooltip；点击数据点触发 onPointClick(fullDate)
 */

function fmtNum(v, dec = 2) {
  const n = Number(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtShort(v) {
  v = Math.round(v);
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}
/** 轴最大值取整到「好看」的刻度 */
function niceMax(v) {
  if (v <= 0) return 10;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  let nf;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 2.5) nf = 2.5;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * base;
}
/** 构建折线路径，支持 null（断点） */
function buildPath(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p === null) {
      pen = false;
      continue;
    }
    d += (pen ? ' L' : ' M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    pen = true;
  }
  return d;
}

/**
 * @param {HTMLElement} host 图表挂载容器（内部会设为 position:relative）
 * @param {Object} opts
 * @param {string[]} opts.dates  x 轴标签（MM-DD）
 * @param {string[]} opts.fullDates 与 dates 平行的完整日期（YYYY-MM-DD），用于回调
 * @param {Object} opts.series { cost:number[], sales:number[], acos:(number|null)[] }
 * @param {(fullDate:string)=>void} [opts.onPointClick]
 */
export function renderLineChart(host, opts) {
  const { dates = [], fullDates = [], series = { cost: [], sales: [], acos: [] }, onPointClick } = opts;
  host.innerHTML = '';
  host.style.position = 'relative';

  if (!dates.length) {
    host.innerHTML = '<div class="ads-empty">该时间范围内暂无数据可绘制趋势</div>';
    return;
  }

  const n = dates.length;
  const W = 920;
  const H = 340;
  const m = { top: 22, right: 54, bottom: 44, left: 64 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const maxMoney = Math.max(1, ...series.cost, ...series.sales);
  const moneyMax = niceMax(maxMoney * 1.12);
  const maxAcos = Math.max(0, ...series.acos.filter((v) => v != null));
  const acosMax = niceMax(Math.max(maxAcos, 50) * 1.12);

  const X = (i) => (n === 1 ? m.left + pw / 2 : m.left + (i / (n - 1)) * pw);
  const Ym = (v) => m.top + ph * (1 - v / moneyMax);
  const Ya = (v) => m.top + ph * (1 - v / acosMax);

  // 网格 + 轴标签
  let grid = '';
  let leftLabels = '';
  let rightLabels = '';
  for (let i = 0; i <= 4; i++) {
    const y = m.top + ph * (i / 4);
    const mv = (moneyMax * (4 - i)) / 4;
    const av = (acosMax * (4 - i)) / 4;
    grid += `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + pw}" y2="${y.toFixed(1)}" class="lc-grid"/>`;
    leftLabels += `<text x="${m.left - 10}" y="${(y + 4).toFixed(1)}" class="lc-axis" text-anchor="end">${fmtShort(mv)}</text>`;
    rightLabels += `<text x="${m.left + pw + 10}" y="${(y + 4).toFixed(1)}" class="lc-axis" text-anchor="start">${av.toFixed(0)}%</text>`;
  }

  // x 轴标签（抽稀避免拥挤）
  const step = Math.ceil(n / 8);
  let xLabels = '';
  for (let i = 0; i < n; i += step) {
    xLabels += `<text x="${X(i).toFixed(1)}" y="${m.top + ph + 22}" class="lc-axis" text-anchor="middle">${dates[i]}</text>`;
  }
  if ((n - 1) % step !== 0) {
    xLabels += `<text x="${X(n - 1).toFixed(1)}" y="${m.top + ph + 22}" class="lc-axis" text-anchor="middle">${dates[n - 1]}</text>`;
  }

  // 数据点与路径
  const costPts = series.cost.map((v, i) => ({ x: X(i), y: Ym(v) }));
  const salesPts = series.sales.map((v, i) => ({ x: X(i), y: Ym(v) }));
  const acosPts = series.acos.map((v, i) => (v == null ? null : { x: X(i), y: Ya(v) }));
  const costPath = buildPath(costPts);
  const salesPath = buildPath(salesPts);
  const acosPath = buildPath(acosPts);

  let circles = '';
  for (let i = 0; i < n; i++) {
    const fd = fullDates[i] || '';
    circles += `<circle cx="${costPts[i].x.toFixed(1)}" cy="${costPts[i].y.toFixed(1)}" r="3.6" class="lc-pt lc-cost" data-fd="${fd}"></circle>`;
    circles += `<circle cx="${salesPts[i].x.toFixed(1)}" cy="${salesPts[i].y.toFixed(1)}" r="3.6" class="lc-pt lc-sales" data-fd="${fd}"></circle>`;
    if (acosPts[i]) circles += `<circle cx="${acosPts[i].x.toFixed(1)}" cy="${acosPts[i].y.toFixed(1)}" r="3.6" class="lc-pt lc-acos" data-fd="${fd}"></circle>`;
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" class="lc-svg" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <line x1="${m.left}" y1="${m.top}" x2="${m.left}" y2="${m.top + ph}" class="lc-axis-line"></line>
    <line x1="${m.left}" y1="${m.top + ph}" x2="${m.left + pw}" y2="${m.top + ph}" class="lc-axis-line"></line>
    <path d="${costPath}" class="lc-line lc-cost-l"></path>
    <path d="${salesPath}" class="lc-line lc-sales-l"></path>
    <path d="${acosPath}" class="lc-line lc-acos-l"></path>
    ${leftLabels}${rightLabels}${xLabels}
    ${circles}
  </svg>`;

  const legend = `<div class="lc-legend">
    <span class="lc-key"><i class="lc-sw lc-cost"></i>花费</span>
    <span class="lc-key"><i class="lc-sw lc-sales"></i>销售额</span>
    <span class="lc-key"><i class="lc-sw lc-acos"></i>ACOS</span>
    <span class="lc-hint">悬停查看数值 · 点击数据点定位明细</span>
  </div>`;

  const tip = `<div class="lc-tip" style="display:none"></div>`;
  host.innerHTML = svg + legend + tip;

  const tipEl = host.querySelector('.lc-tip');
  host.querySelectorAll('.lc-pt').forEach((pt) => {
    pt.addEventListener('mouseenter', () => {
      const fd = pt.dataset.fd;
      const idx = fullDates.indexOf(fd);
      if (idx < 0) return;
      const cost = series.cost[idx];
      const sales = series.sales[idx];
      const acos = series.acos[idx];
      tipEl.innerHTML = `<div class="lc-tip-d">${fd}</div>
        <div class="lc-tip-r"><i class="lc-sw lc-cost"></i>花费 <b>¥${fmtNum(cost)}</b></div>
        <div class="lc-tip-r"><i class="lc-sw lc-sales"></i>销售额 <b>¥${fmtNum(sales)}</b></div>
        <div class="lc-tip-r"><i class="lc-sw lc-acos"></i>ACOS <b>${acos == null ? '—' : acos.toFixed(1) + '%'}</b></div>`;
      tipEl.style.display = 'block';
      const r = pt.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      tipEl.style.left = r.left - hr.left + r.width / 2 + 'px';
      tipEl.style.top = r.top - hr.top + 'px';
    });
    pt.addEventListener('mouseleave', () => {
      tipEl.style.display = 'none';
    });
    pt.addEventListener('click', () => {
      if (onPointClick) onPointClick(pt.dataset.fd);
    });
  });
}
