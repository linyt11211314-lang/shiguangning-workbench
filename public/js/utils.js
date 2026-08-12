/**
 * 通用工具函数
 */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return formatDate(ts);
}

/** HTML 转义（防注入） */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 将文本按行安全输出（自动转义） */
export function escLines(text) {
  return esc(text).replace(/\n/g, '<br>');
}

/** 复制文本到剪贴板（兼容降级） */
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* 继续降级 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

/** 从粘贴事件中提取图片文件（Clipboard / DataTransfer） */
export function extractImageFromEvent(e) {
  const items = e.clipboardData ? e.clipboardData.items : (e.dataTransfer ? e.dataTransfer.items : []);
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile ? item.getAsFile() : (item.kind === 'file' ? item : null);
      if (file) return file;
    }
  }
  const files = e.clipboardData ? e.clipboardData.files : (e.dataTransfer ? e.dataTransfer.files : null);
  if (files && files.length) return files[0];
  return null;
}

/** 读取图片文件为 DataURL（压缩至最大边长 1200） */
export function fileToDataURL(file, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        } catch (_) {
          resolve(reader.result);
        }
      };
      img.onerror = () => resolve(reader.result);
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 从 URL 抓取竞品信息（走后端代理） */
export async function fetchCompetitor(url) {
  const res = await fetch(`/api/competitor/fetch?url=${encodeURIComponent(url)}`);
  return res.json();
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 去除字符串多余空白 */
export function clean(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

/** URL 规范化：自动补全协议（https://）；拒绝 javascript:/data:/file: 等非 http(s)/ftp 协议，防 XSS */
export function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  // 非 http(s)/ftp 协议（javascript:、data:、file:、mailto: 等）一律拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|ftp):/i.test(u)) return '';
  if (/^(https?|ftp):\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u; // 协议相对形式 //example.com
  // 支持 amazon.cn 等带域名形式
  return `https://${u}`;
}
