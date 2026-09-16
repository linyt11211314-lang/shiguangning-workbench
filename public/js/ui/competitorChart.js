/**
 * 轻量 SVG 折线图（单轴，无外部依赖）—— 移植自追踪站 charts.js
 * 用法：renderLineChart(container, { series:[{name,points:[{x,y}]}], valueFmt })
 */
const COLORS = ['#2f6fed', '#e5484d', '#1a9d5a', '#d98a00', '#8b5cf6', '#0ea5b7'];

export function renderLineChart(container, config) {
  const W = 680, H = 220, pl = 46, pr = 14, pt = 14, pb = 28;
  const series = (config.series || []).filter((s) => s.points && s.points.length);
  if (!series.length) { container.innerHTML = '<div class="empty">暂无数据可绘图</div>'; return; }
  const allX = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null);
  let minY = Math.min(...allY), maxY = Math.max(...allY);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const pad = (maxY - minY) * 0.1;
  minY -= pad; maxY += pad;
  const xAt = (x) => pl + (allX.length === 1 ? 0 : (allX.indexOf(x) / (allX.length - 1)) * (W - pl - pr));
  const yAt = (y) => pt + (1 - (y - minY) / (maxY - minY)) * (H - pt - pb);
  const fmt = config.valueFmt || ((v) => v);

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
  for (let i = 0; i <= 4; i++) {
    const yv = minY + (maxY - minY) * (i / 4);
    const yy = yAt(yv);
    svg += `<line x1="${pl}" y1="${yy}" x2="${W - pr}" y2="${yy}" stroke="#eef1f5" stroke-width="1"/>`;
    svg += `<text x="${pl - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#9aa6b2">${fmt(Math.round(yv * 100) / 100)}</text>`;
  }
  const step = Math.ceil(allX.length / 6);
  allX.forEach((x, i) => {
    if (i % step === 0 || i === allX.length - 1) {
      svg += `<text x="${xAt(x)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#9aa6b2">${String(x).slice(5)}</text>`;
    }
  });
  series.forEach((s, si) => {
    const color = s.color || COLORS[si % COLORS.length];
    const pts = s.points.filter((p) => p.y != null).map((p) => `${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" />`;
    s.points.filter((p) => p.y != null).forEach((p) => {
      svg += `<circle cx="${xAt(p.x).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="2.6" fill="${color}"/>`;
    });
  });
  svg += `</svg>`;
  container.innerHTML = svg;
  let legend = '<div class="legend">';
  series.forEach((s, si) => {
    const color = s.color || COLORS[si % COLORS.length];
    legend += `<span><i style="background:${color}"></i>${s.name}</span>`;
  });
  legend += '</div>';
  container.insertAdjacentHTML('beforeend', legend);
}
