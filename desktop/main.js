/**
 * Electron 主进程（Windows 桌面版入口）
 *
 * 职责：
 *  - 解析数据目录：优先「文档/拾光柠工作台数据」，失败回退 userData/data
 *  - 在 127.0.0.1 上启动既有 Express 服务（静态托管 + AI 代理 + 竞品抓取）
 *  - 打开 BrowserWindow 加载本机服务，并注入 preload（把存储重定向到本地文件）
 *  - 提供应用菜单：打开数据文件夹 / 重新加载 / 开发者工具 / 关于 / 退出
 *  - 单实例锁，避免重复打开多个窗口
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { app, BrowserWindow, Menu, shell, dialog, clipboard, nativeImage } = require('electron');

// 复用根目录的 Express 服务（server.js 已 export app 并在被 require 时不自监听）
const expressApp = require('../server.js');

/**
 * 计算数据目录。必须在 app ready 之后调用（app.getPath 需要 ready）。
 * 提前把路径写入 process.env，确保渲染进程（preload）创建时能读到。
 */
let DATA_DIR = null;
function resolveDataDir() {
  let dir;
  try {
    dir = path.join(app.getPath('documents'), '拾光柠工作台数据');
  } catch (_) {
    dir = path.join(app.getPath('userData'), 'data');
  }
  return dir;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 取一个空闲端口（绑定 127.0.0.1:0 后释放，拿到系统分配的端口） */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let serverPort = null;
let mainWindow = null;

async function startServer() {
  serverPort = await getFreePort();
  await new Promise((resolve, reject) => {
    const srv = expressApp.listen(serverPort, '127.0.0.1', () => resolve());
    srv.on('error', reject);
  });
  console.log(`🍋 本地服务已就绪: http://127.0.0.1:${serverPort}`);
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据文件夹', click: () => shell.openPath(DATA_DIR) },
        { type: 'separator' },
        { label: '重新加载', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '视图',
      submenu: [
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
        { type: 'separator' },
        { label: '切换开发者工具', accelerator: 'F12', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于拾光柠工作台',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              title: '关于',
              message: '拾光柠工作台 v1.0\nWindows 桌面版',
              detail: '数据目录：\n' + DATA_DIR,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: '拾光柠工作台',
    backgroundColor: '#F5EBD6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);

  // 新窗口/外链在系统默认浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止跳离本机服务（竞品抓取是服务端完成，无需页面跳转）
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) event.preventDefault();
  });

  // 自定义右键菜单：图片可「复制图片 / 保存图片 / 复制图片地址」；文字可「复制 / 粘贴 / 全选」
  // 解决 Electron 对 data: 图片默认右键菜单不出现「复制图片」的问题
  mainWindow.webContents.on('context-menu', (event, params) => {
    const items = [];
    if (params.mediaType === 'image') {
      items.push({
        label: '复制图片',
        click: () => {
          try {
            const img = nativeImage.createFromDataURL(params.srcURL || '');
            if (!img.isEmpty()) clipboard.writeImage(img);
          } catch (e) { console.error('[context-menu] 复制图片失败：', e && e.message); }
        },
      });
      items.push({
        label: '保存图片…',
        click: async () => {
          try {
            const m = /^data:image\/(\w+)/.exec(params.srcURL || '');
            const ext = m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: '保存图片',
              defaultPath: `image.${ext}`,
              filters: [{ name: '图片', extensions: [ext] }],
            });
            if (!canceled && filePath) {
              const base64 = (params.srcURL || '').replace(/^data:image\/\w+;base64,/, '');
              fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
            }
          } catch (e) { console.error('[context-menu] 保存图片失败：', e && e.message); }
        },
      });
      items.push({
        label: '复制图片地址',
        click: () => { try { clipboard.writeText(params.srcURL || ''); } catch (_) {} },
      });
    } else {
      if (params.selectionText) items.push({ label: '复制', role: 'copy' });
      if (params.isEditable) items.push({ label: '粘贴', role: 'paste' }, { label: '剪切', role: 'cut' });
      items.push({ label: '全选', role: 'selectAll' });
    }
    items.push({ type: 'separator' });
    items.push({ label: '检查元素', click: () => mainWindow.webContents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    DATA_DIR = resolveDataDir();
    process.env.SGN_DATA_DIR = DATA_DIR; // 必须在创建窗口前设置，preload 才能读到
    ensureDataDir();
    await startServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
