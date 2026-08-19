/**
 * 拾光柠工作台 · PDF 工具箱
 * 仿 iLovePDF 的卡片式本地工具集（纯前端，离线可用）。
 * 依赖：window.PDFLib（/vendor/pdf-lib.min.js）、window.pdfjsLib（/vendor/pdf.min.js）
 * 注：PDF↔Word/Excel/PPT 真格式互转、OCR 需服务端，纯前端无法保真，故未实现。
 */
import { icon } from '../ui/icons.js';
import { toastSuccess, toastError, toastInfo } from '../ui/toast.js';

const TOOLS = [
  { id: 'merge', label: '合并 PDF', icon: 'pdf', desc: '把多个 PDF 按选择顺序拼成一个文件' },
  { id: 'split', label: '拆分 PDF', icon: 'pdf', desc: '每页拆成独立文件，打包下载' },
  { id: 'rotate', label: '旋转 PDF', icon: 'refresh', desc: '整份页面统一旋转 90 / 180 / 270°' },
  { id: 'organize', label: '组织页面', icon: 'drag', desc: '删除、重排页面（带缩略图预览）' },
  { id: 'img2pdf', label: '图片转 PDF', icon: 'image', desc: 'JPG / PNG 转成一个 PDF' },
  { id: 'pdf2img', label: 'PDF 转图片', icon: 'image', desc: '每页导出为 JPG / PNG（打包下载）' },
  { id: 'compress', label: '压缩 PDF', icon: 'zap', desc: '图片化重封装，体积更小（不可选文本）' },
  { id: 'pagenum', label: '添加页码', icon: 'list', desc: '页脚 / 页眉加页码' },
  { id: 'watermark', label: '添加水印', icon: 'tag', desc: '整份平铺水印文字' },
  { id: 'encrypt', label: '加密保护', icon: 'lock', desc: '设置打开密码' },
  { id: 'decrypt', label: '解密解锁', icon: 'unlock', desc: '用已知密码去除保护' },
];

let activeTool = 'merge';
let pdfjsReady = false;

function ensureLibs() {
  if (!window.PDFLib) throw new Error('PDF 核心库（pdf-lib）未加载，请刷新页面重试');
}
function ensurePdfjs() {
  if (!window.pdfjsLib) throw new Error('PDF 渲染库（pdf.js）未加载，请刷新页面重试');
  if (!pdfjsReady) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    pdfjsReady = true;
  }
}

function readFileBytes(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result));
    r.onerror = () => rej(r.error || new Error('文件读取失败'));
    r.readAsArrayBuffer(file);
  });
}
function readFileDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('文件读取失败'));
    r.readAsDataURL(file);
  });
}
function basename(name) {
  return (name || 'file').replace(/\.pdf$/i, '');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function downloadBytes(uint8, filename, type = 'application/pdf') {
  downloadBlob(new Blob([uint8], { type }), filename);
}

/* ---------------------- 工具栏实现 ---------------------- */

async function doMerge(files, status) {
  ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  let total = 0;
  for (const f of files) {
    const bytes = await readFileBytes(f);
    const doc = await PDFDocument.load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    total += pages.length;
  }
  const buf = await out.save();
  downloadBytes(buf, `${basename(files[0].name)}-合并后.pdf`);
  status(`已合并 ${files.length} 个文件、共 ${total} 页`);
  toastSuccess('合并完成，已开始下载');
}

async function doSplit(file, status) {
  ensureLibs();
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('压缩包组件未加载');
  const { PDFDocument } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  const n = doc.getPageCount();
  const zip = new JSZip();
  for (let i = 0; i < n; i++) {
    const one = await PDFDocument.create();
    const [p] = await one.copyPages(doc, [i]);
    one.addPage(p);
    const b = await one.save();
    zip.file(`${String(i + 1).padStart(3, '0')}.pdf`, b);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${basename(file.name)}-拆分.zip`);
  status(`已拆分为 ${n} 个单页文件`);
  toastSuccess('拆分完成，已开始下载 ZIP');
}

async function doRotate(file, angle, status) {
  ensureLibs();
  const { PDFDocument, degrees } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  doc.getPages().forEach((pg) => {
    const cur = pg.getRotation().angle;
    pg.setRotation(degrees((cur + angle) % 360));
  });
  const buf = await doc.save();
  downloadBytes(buf, `${basename(file.name)}-旋转${angle}.pdf`);
  status(`已旋转 ${doc.getPageCount()} 页`);
  toastSuccess('旋转完成，已开始下载');
}

async function doOrganize(file, order, status) {
  ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  const srcCount = doc.getPageCount();
  const out = await PDFDocument.create();
  // order: 0-based 页面索引数组（已重排/已剔除）
  const pages = await out.copyPages(doc, order);
  pages.forEach((p) => out.addPage(p));
  const buf = await out.save();
  downloadBytes(buf, `${basename(file.name)}-整理后.pdf`);
  status(`原 ${srcCount} 页 → 整理后 ${order.length} 页`);
  toastSuccess('整理完成，已开始下载');
}

async function doImg2Pdf(files, status) {
  ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  for (const f of files) {
    const bytes = await readFileBytes(f);
    let img;
    if (/png/i.test(f.type) || isPng(bytes)) img = await out.embedPng(bytes);
    else if (/jpe?g/i.test(f.type) || isJpg(bytes)) img = await out.embedJpg(bytes);
    else throw new Error(`不支持的图片类型：${f.name}`);
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const buf = await out.save();
  downloadBytes(buf, `图片合集-${files.length}张.pdf`);
  status(`已把 ${files.length} 张图片合成 PDF`);
  toastSuccess('转换完成，已开始下载');
}

async function doPdf2Img(file, fmt, quality, status) {
  ensurePdfjs();
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('压缩包组件未加载');
  const pdfjsLib = window.pdfjsLib;
  const bytes = await readFileBytes(file);
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const n = pdf.numPages;
  const zip = new JSZip();
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, fmt === 'png' ? 'image/png' : 'image/jpeg', quality));
    const arr = new Uint8Array(await blob.arrayBuffer());
    zip.file(`${String(i).padStart(3, '0')}.${fmt}`, arr);
    status(`正在渲染第 ${i}/${n} 页…`);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  downloadBlob(out, `${basename(file.name)}-图片.zip`);
  toastSuccess('转换完成，已开始下载 ZIP');
}

async function doCompress(file, scale, quality, status) {
  ensurePdfjs();
  const { PDFDocument } = window.PDFLib;
  const pdfjsLib = window.pdfjsLib;
  const bytes = await readFileBytes(file);
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const srcDoc = await PDFDocument.load(bytes);
  const n = pdf.numPages;
  const out = await PDFDocument.create();
  for (let i = 1; i <= n; i++) {
    status(`正在压缩第 ${i}/${n} 页…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const sp = srcDoc.getPage(i - 1).getSize();
    const p = out.addPage(sp);
    p.drawImage(jpg, { x: 0, y: 0, width: sp[0], height: sp[1] });
  }
  const buf = await out.save();
  downloadBytes(buf, `${basename(file.name)}-压缩后.pdf`);
  toastSuccess('压缩完成，已开始下载');
}

async function doPageNum(file, opts, status) {
  ensureLibs();
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  doc.getPages().forEach((pg, idx) => {
    const [w, h] = pg.getSize();
    const text = opts.format === 'of' ? `${idx + opts.start} / ${total}` : `${idx + opts.start}`;
    const size = 10;
    const pad = 16;
    let x = w / 2 - font.widthOfTextAtSize(text, size) / 2;
    let y = pad;
    if (opts.pos === 'top-right') { x = w - pad - font.widthOfTextAtSize(text, size); y = h - pad - size; }
    else if (opts.pos === 'bottom-right') { x = w - pad - font.widthOfTextAtSize(text, size); y = pad; }
    else if (opts.pos === 'bottom-center') { x = w / 2 - font.widthOfTextAtSize(text, size) / 2; y = pad; }
    else if (opts.pos === 'top-center') { x = w / 2 - font.widthOfTextAtSize(text, size) / 2; y = h - pad - size; }
    pg.drawText(text, { x, y, size, font, color: rgb(0.45, 0.45, 0.45) });
  });
  const buf = await doc.save();
  downloadBytes(buf, `${basename(file.name)}-带页码.pdf`);
  status(`已在 ${total} 页添加页码`);
  toastSuccess('添加页码完成，已开始下载');
}

async function doWatermark(file, text, status) {
  ensureLibs();
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 26;
  doc.getPages().forEach((pg) => {
    const [w, h] = pg.getSize();
    const stepX = 220;
    const stepY = 150;
    for (let y = stepY / 2; y < h; y += stepY) {
      for (let x = stepX / 2; x < w; x += stepX) {
        pg.drawText(text, {
          x, y, size, font,
          color: rgb(0.6, 0.6, 0.6),
          opacity: 0.18,
          rotate: degrees(-30),
        });
      }
    }
  });
  const buf = await doc.save();
  downloadBytes(buf, `${basename(file.name)}-水印.pdf`);
  status(`已添加水印：${text}`);
  toastSuccess('水印完成，已开始下载');
}

async function doEncrypt(file, userPwd, ownerPwd, status) {
  ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes);
  const buf = await doc.save({
    encrypt: {
      userPassword: userPwd,
      ownerPassword: ownerPwd || userPwd,
      permissions: { printing: 'highResolution', copying: true, modifying: false },
    },
  });
  downloadBytes(buf, `${basename(file.name)}-加密.pdf`);
  status('已加密（设置打开密码）');
  toastSuccess('加密完成，已开始下载');
}

async function doDecrypt(file, pwd, status) {
  ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const bytes = await readFileBytes(file);
  const doc = await PDFDocument.load(bytes, { password: pwd });
  const buf = await doc.save();
  downloadBytes(buf, `${basename(file.name)}-已解密.pdf`);
  status('已去除密码保护');
  toastSuccess('解密完成，已开始下载');
}

function isJpg(b) { return b[0] === 0xff && b[1] === 0xd8; }
function isPng(b) { return b[0] === 0x89 && b[1] === 0x50; }

/* ---------------------- 渲染 ---------------------- */

export function render(container, ctx) {
  activeTool = activeTool || 'merge';
  container.innerHTML = `
    <div class="pdf-tool">
      <div class="pdf-intro">
        <span class="pdf-intro-ico">${icon('pdf')}</span>
        <div>
          <div class="pdf-intro-title">PDF 工具箱 · 本地离线处理</div>
          <div class="pdf-intro-sub">文件不会上传任何服务器，全部在你的电脑上完成。合并/拆分/旋转/组织/图片互转/页码/水印/加密 均可用；PDF↔Word/Excel/PPT 真格式互转与 OCR 需服务端，暂不支持。</div>
        </div>
      </div>
      <div class="pdf-grid" id="pdfGrid">
        ${TOOLS.map((t) => `
          <div class="pdf-card" data-tool="${t.id}">
            <span class="pdf-card-ico">${icon(t.icon)}</span>
            <div class="pdf-card-label">${t.label}</div>
            <div class="pdf-card-desc">${t.desc}</div>
          </div>`).join('')}
      </div>
      <div class="pdf-panel" id="pdfPanel"></div>
    </div>`;

  container.querySelectorAll('[data-tool]').forEach((el) => {
    el.addEventListener('click', () => { activeTool = el.dataset.tool; renderPanel(container); });
  });
  renderPanel(container);
}

function renderPanel(container) {
  const panel = container.querySelector('#pdfPanel');
  const t = TOOLS.find((x) => x.id === activeTool) || TOOLS[0];
  container.querySelectorAll('.pdf-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === t.id);
  });
  panel.innerHTML = `<div class="pdf-panel-head">${icon(t.icon)} <b>${t.label}</b><span>${t.desc}</span></div>` + toolBody(t.id);
  bindPanel(panel, t.id);
}

function fileInput(accept, multiple, id) {
  return `<input type="file" id="${id}" accept="${accept}" ${multiple ? 'multiple' : ''} class="pdf-file" />`;
}
function statusLine() { return `<div class="pdf-status" id="pdfStatus"></div>`; }
function runBtn(label) { return `<button class="btn btn-primary" id="pdfRun">${label}</button>`; }

function toolBody(id) {
  switch (id) {
    case 'merge':
      return `<p class="pdf-tip">选择多个 PDF，按文件选择顺序从上到下拼接。</p>${fileInput('application/pdf', true, 'f')}${statusLine()}${runBtn('开始合并')}`;
    case 'split':
      return `<p class="pdf-tip">每个页面导出为一个独立 PDF，全部打进一个 ZIP。</p>${fileInput('application/pdf', false, 'f')}${statusLine()}${runBtn('开始拆分')}`;
    case 'rotate':
      return `<p class="pdf-tip">选择旋转角度（相对当前方向）。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>旋转</label>
        <select id="angle"><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></div>
        ${statusLine()}${runBtn('开始旋转')}`;
    case 'organize':
      return `<p class="pdf-tip">上传后勾选要保留的页面（取消即删除），可拖动调整顺序，然后点「应用」。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-thumbs" id="thumbs"></div>${statusLine()}${runBtn('应用整理')}`;
    case 'img2pdf':
      return `<p class="pdf-tip">支持 JPG / PNG，按选择顺序合成一个 PDF。</p>${fileInput('image/jpeg,image/png', true, 'f')}${statusLine()}${runBtn('转为 PDF')}`;
    case 'pdf2img':
      return `<p class="pdf-tip">每页渲染为图片，打进 ZIP。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>格式</label><select id="fmt"><option value="jpg">JPG</option><option value="png">PNG</option></select>
        <label>质量</label><select id="q"><option value="0.92">高</option><option value="0.7" selected>中</option><option value="0.5">低</option></select></div>
        ${statusLine()}${runBtn('开始转换')}`;
    case 'compress':
      return `<p class="pdf-tip">把每页重绘为图片再封装，体积通常更小，但文字不可选中、清晰度取决于质量。适合扫描件/图片型 PDF。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>清晰度</label><select id="cs"><option value="1.5">标准</option><option value="2" selected>较高</option><option value="3">最高</option></select>
        <label>图片质量</label><select id="cq"><option value="0.85">高</option><option value="0.7" selected>中</option><option value="0.5">低</option></select></div>
        ${statusLine()}${runBtn('开始压缩')}`;
    case 'pagenum':
      return `<p class="pdf-tip">在每页添加页码。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>位置</label><select id="pos">
          <option value="bottom-center">底部居中</option><option value="bottom-right">底部右侧</option>
          <option value="top-right">顶部右侧</option><option value="top-center">顶部居中</option></select>
        <label>格式</label><select id="pf"><option value="plain">纯数字</option><option value="of">X / 总页数</option></select>
        <label>起始</label><input type="number" id="ps" value="1" min="1" style="width:64px"></div>
        ${statusLine()}${runBtn('添加页码')}`;
    case 'watermark':
      return `<p class="pdf-tip">整份平铺水印文字（浅灰、半透明）。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>文字</label><input type="text" id="wt" value="拾光柠" style="width:200px"></div>
        ${statusLine()}${runBtn('添加水印')}`;
    case 'encrypt':
      return `<p class="pdf-tip">设置打开密码（owner 留空则同打开密码）。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>打开密码</label><input type="text" id="up" style="width:160px">
        <label>权限密码</label><input type="text" id="op" style="width:160px"></div>
        ${statusLine()}${runBtn('加密')}`;
    case 'decrypt':
      return `<p class="pdf-tip">输入当前打开密码，导出无密码版本。</p>${fileInput('application/pdf', false, 'f')}
        <div class="pdf-row"><label>当前密码</label><input type="text" id="dp" style="width:160px"></div>
        ${statusLine()}${runBtn('解密')}`;
    default:
      return '';
  }
}

function bindPanel(panel, id) {
  const run = panel.querySelector('#pdfRun');
  if (!run) return;
  const fileEl = panel.querySelector('#f');
  const status = panel.querySelector('#pdfStatus');
  const setStatus = (m) => { if (status) status.textContent = m; };
  run.addEventListener('click', async () => {
    run.disabled = true;
    try {
      if (id === 'organize') {
        const files = fileEl.files;
        if (!files.length) { toastInfo('请先选择 PDF'); run.disabled = false; return; }
        await runOrganize(files[0], panel, setStatus);
      } else if (id === 'merge') {
        const files = [...fileEl.files];
        if (files.length < 2) { toastInfo('请选择至少 2 个 PDF'); run.disabled = false; return; }
        await doMerge(files, setStatus);
      } else if (id === 'split') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doSplit(fileEl.files[0], setStatus);
      } else if (id === 'rotate') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doRotate(fileEl.files[0], Number(panel.querySelector('#angle').value), setStatus);
      } else if (id === 'img2pdf') {
        const files = [...fileEl.files];
        if (!files.length) { toastInfo('请选择图片'); run.disabled = false; return; }
        await doImg2Pdf(files, setStatus);
      } else if (id === 'pdf2img') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doPdf2Img(fileEl.files[0], panel.querySelector('#fmt').value, Number(panel.querySelector('#q').value), setStatus);
      } else if (id === 'compress') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doCompress(fileEl.files[0], Number(panel.querySelector('#cs').value), Number(panel.querySelector('#cq').value), setStatus);
      } else if (id === 'pagenum') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doPageNum(fileEl.files[0], {
          pos: panel.querySelector('#pos').value,
          format: panel.querySelector('#pf').value,
          start: Math.max(1, Number(panel.querySelector('#ps').value) || 1),
        }, setStatus);
      } else if (id === 'watermark') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        const wt = panel.querySelector('#wt').value.trim() || '拾光柠';
        await doWatermark(fileEl.files[0], wt, setStatus);
      } else if (id === 'encrypt') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        const up = panel.querySelector('#up').value;
        if (!up) { toastInfo('请填写打开密码'); run.disabled = false; return; }
        await doEncrypt(fileEl.files[0], up, panel.querySelector('#op').value, setStatus);
      } else if (id === 'decrypt') {
        if (!fileEl.files.length) { toastInfo('请选择 PDF'); run.disabled = false; return; }
        await doDecrypt(fileEl.files[0], panel.querySelector('#dp').value, setStatus);
      }
    } catch (e) {
      console.error(e);
      setStatus('出错：' + (e.message || e));
      toastError('处理失败：' + (e.message || e));
    } finally {
      run.disabled = false;
    }
  });

  if (id === 'organize' && fileEl) {
    fileEl.addEventListener('change', () => loadThumbs(fileEl.files[0], panel));
  }
}

async function loadThumbs(file, panel) {
  if (!file) return;
  ensurePdfjs();
  const thumbs = panel.querySelector('#thumbs');
  thumbs.innerHTML = '预览加载中…';
  try {
    const bytes = await readFileBytes(file);
    const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const n = pdf.numPages;
    let html = '';
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 0.25 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      html += `<div class="pdf-thumb" data-idx="${i - 1}"><label><input type="checkbox" data-keep="${i - 1}" checked> 第${i}页</label>${canvas.outerHTML}</div>`;
    }
    thumbs.innerHTML = html;
    // 简单拖动排序：点击缩略图列表下的「上移/下移」按钮
    thumbs.querySelectorAll('[data-idx]').forEach((el) => {
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', el.dataset.idx); });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = e.dataTransfer.getData('text/plain');
        const cur = el;
        const parent = cur.parentNode;
        const fromEl = parent.querySelector(`[data-idx="${from}"]`);
        if (fromEl && fromEl !== cur) parent.insertBefore(fromEl, cur);
      });
    });
  } catch (e) {
    thumbs.innerHTML = '预览失败：' + (e.message || e);
  }
}

async function runOrganize(file, panel, setStatus) {
  const order = [];
  panel.querySelectorAll('#thumbs [data-keep]').forEach((cb) => {
    if (cb.checked) order.push(Number(cb.dataset.keep));
  });
  // 按 DOM 顺序（拖动后）重排
  const domOrder = [...panel.querySelectorAll('#thumbs .pdf-thumb')].map((el) => Number(el.dataset.idx));
  const finalOrder = domOrder.filter((idx) => order.includes(idx));
  if (!finalOrder.length) { toastInfo('请至少保留一页'); return; }
  await doOrganize(file, finalOrder, setStatus);
}
