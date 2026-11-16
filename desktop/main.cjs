const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startBackend } = require('./runtime.cjs');
const { readConfig, saveConfig } = require('./config.cjs');

let backend;
let mainWindow;
let settingsWindow;
let quitting = false;
const smokeData = process.env.JUBEN_SMOKE_DATA;
if (smokeData) app.setPath('userData', path.resolve(smokeData));
const dataPath = path.join(app.getPath('userData'), 'workspace');
const settingsFile = path.join(__dirname, 'settings.html');
const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
  contextIsolation: true, sandbox: true, webSecurity: true,
};

function requireSender(event, target) {
  if (!target || event.sender !== target.webContents ||
      (event.senderFrame && event.senderFrame !== target.webContents.mainFrame)) {
    throw new Error('无效的窗口请求');
  }
}
function lockWindow(win, allowed) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({ title: '连接设置', width: 660, height: 780,
    parent: mainWindow, autoHideMenuBar: true, webPreferences });
  lockWindow(settingsWindow, url => url === require('node:url').pathToFileURL(settingsFile).href);
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadFile(settingsFile);
}
function installIPC() {
  ipcMain.handle('desktop:session', event => {
    requireSender(event, mainWindow);
    if (!backend || new URL(event.senderFrame.url).origin !== backend.origin) throw new Error('服务尚未就绪');
    return backend.session();
  });
  ipcMain.handle('desktop:config', event => {
    requireSender(event, settingsWindow);
    return readConfig(dataPath);
  });
  ipcMain.handle('desktop:save-config', (event, values) => {
    requireSender(event, settingsWindow);
    saveConfig(dataPath, values);
    setTimeout(() => {
      if (process.env.PORTABLE_EXECUTABLE_FILE) {
        app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE, args: [] });
      } else app.relaunch();
      app.quit();
    }, 300);
    return { saved: true };
  });
}
function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '连接设置…', click: openSettings },
      { label: '打开数据目录', click: () => shell.openPath(dataPath) },
      { type: 'separator' }, { label: '退出', role: 'quit' },
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'resetZoom' },
      { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [{ label: '关于', click: () => dialog.showMessageBox(mainWindow, {
      title: 'Juben', message: '剧本创作平台 · Windows 桌面版',
      detail: '独立窗口运行，内置界面与 Python 后端。\n模型调用需要配置 API Key。\n数据库、向量检索和图谱功能需要相应服务。',
    }) }] },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(async () => {
    fs.mkdirSync(dataPath, { recursive: true });
    mainWindow = new BrowserWindow({ title: '剧本创作平台', width: 1440, height: 940,
      minWidth: 1024, minHeight: 700, backgroundColor: '#0f172a', webPreferences });
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<html lang="zh-CN"><body style="background:#0f172a;color:#e2e8f0;font:20px system-ui;display:grid;place-items:center;height:90vh"><div>剧本创作平台<br><small>正在启动本地服务…</small></div></body></html>'));
    lockWindow(mainWindow, url => !!backend && new URL(url).origin === backend.origin);
    installMenu();
    installIPC();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    // Add the capability only to our own origin, including WebSocket upgrades.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      const url = new URL(details.url);
      if (backend && `${url.protocol === 'ws:' ? 'http:' : url.protocol}//${url.host}` === backend.origin) {
        headers['X-Juben-Desktop'] = backend.token;
      }
      callback({ requestHeaders: headers });
    });
    try {
      backend = await startBackend({ packaged: app.isPackaged, resourcesPath: process.resourcesPath,
        dataPath, onFailure: error => {
          if (!quitting) {
            if (!smokeData) dialog.showErrorBox('本地服务已停止', error.message);
            app.quit();
          }
        } });
      if (quitting || mainWindow.isDestroyed()) { await backend.stop(); return; }
      await mainWindow.loadURL(backend.origin);
    } catch (error) {
      fs.appendFileSync(path.join(dataPath, 'logs', 'desktop-launch.log'), `${new Date().toISOString()} ${error.stack}\n`);
      if (!quitting && !smokeData) dialog.showErrorBox('启动失败', `${error.message}\n日志目录：${path.join(dataPath, 'logs')}`);
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true;
    if (backend) { event.preventDefault(); backend.stop().finally(() => app.quit()); }
  });
}
