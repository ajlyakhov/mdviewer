const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let mainWindow;
let pendingOpenFile = null;

function getWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow;
}

function showOpenDialog(options, callback) {
  const win = getWindow();
  dialog.showOpenDialog(win, options).then(callback);
}

function setupMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            showOpenDialog(
              { properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] },
              (result) => {
                if (!result.canceled && result.filePaths?.length && mainWindow) {
                  mainWindow.webContents.send('open-files', result.filePaths);
                }
              }
            );
          },
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            showOpenDialog(
              { properties: ['openDirectory'] },
              (result) => {
                if (!result.canceled && result.filePaths?.length && mainWindow) {
                  mainWindow.webContents.send('open-folder', result.filePaths[0]);
                }
              }
            );
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('open-settings'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (pendingOpenFile) {
      mainWindow.webContents.send('open-file', pendingOpenFile);
      pendingOpenFile = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.setAboutPanelOptions({
  applicationName: 'MD Viewer',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 Alexander Lyakhov',
  authors: ['Alexander Lyakhov'],
});

app.whenReady().then(() => {
  setupMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (win) {
    win.webContents.send('open-file', filePath);
  } else {
    pendingOpenFile = filePath;
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  }
});

function showFolderDialog() {
  dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }).then((result) => {
    if (!result.canceled && result.filePaths?.length && mainWindow) {
      mainWindow.webContents.send('open-folder', result.filePaths[0]);
    }
  });
}

ipcMain.handle('open-external', (_, url) => {
  if (url) shell.openExternal(url);
});

ipcMain.handle('show-tab-context-menu', (event, index) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Close Tab',
      click: () => event.sender.send('tab-context-action', { action: 'close', index }),
    },
    {
      label: 'Close All Other Tabs',
      click: () => event.sender.send('tab-context-action', { action: 'closeOthers', index }),
    },
  ]);
  menu.popup({ window: win });
});

ipcMain.handle('show-folder-dialog', () => {
  showFolderDialog();
});

ipcMain.handle('read-file', async (_, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(err.message);
  }
});

async function collectMdFiles(dirPath) {
  const out = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) {
      out.push(full);
    } else if (e.isDirectory()) {
      out.push(...(await collectMdFiles(full)));
    }
  }
  return out;
}

function findDuti() {
  const candidates = ['/opt/homebrew/bin/duti', '/usr/local/bin/duti'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

ipcMain.handle('set-default-md-app', async () => {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Only supported on macOS' };
  }
  if (!app.isPackaged) {
    return { ok: false, error: 'Build and install the app first (npm run build), then use this setting.' };
  }
  const duti = findDuti();
  if (!duti) {
    return {
      ok: false,
      error: 'duti not found. Install: brew install duti',
      help: 'https://github.com/moretension/duti',
    };
  }
  const bundleId = 'com.mdviewer.app';
  const env = { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:' + (process.env.PATH || '') };
  try {
    execSync(`${duti} -s ${bundleId} net.daringfireball.markdown all`, { stdio: 'pipe', timeout: 5000, env });
    execSync(`${duti} -s ${bundleId} md all`, { stdio: 'pipe', timeout: 5000, env });
    execSync(`${duti} -s ${bundleId} markdown all`, { stdio: 'pipe', timeout: 5000, env });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('read-dir', async (_, targetPath) => {
  const stat = await fs.promises.stat(targetPath);
  if (stat.isFile()) {
    return /\.(md|markdown)$/i.test(targetPath) ? [targetPath] : [];
  }
  return collectMdFiles(targetPath);
});
