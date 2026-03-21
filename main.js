const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { chatCompletion: llmChatCompletion, buildStreamRequest } = require('./llm-adapter');
const { Worker } = require('worker_threads');

let store;
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

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store');
  store = new Store({
    defaults: {
      aiProviders: [],
      aiApiKeys: {},
      chatMessages: [],
      chatSessions: [],
      activeSessionId: null,
      openTabs: [],
      activeTabPath: null,
    },
  });
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

// AI / Chat
ipcMain.handle('get-ai-config', () => {
  return {
    aiProviders: store.get('aiProviders', []),
    aiApiKeys: store.get('aiApiKeys', {}),
  };
});

ipcMain.handle('save-ai-config', (_, { aiProviders, aiApiKeys }) => {
  if (aiProviders !== undefined) store.set('aiProviders', aiProviders);
  if (aiApiKeys !== undefined) store.set('aiApiKeys', aiApiKeys);
  return { ok: true };
});

ipcMain.handle('chat-completion', async (_, { providerId, messages, contextDocuments }) => {
  const providers = store.get('aiProviders', []);
  const apiKeys = store.get('aiApiKeys', {});
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return { error: 'Provider not found' };
  const merged = { ...provider };
  const keyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  if (provider.type === 'lmstudio') merged.baseUrl = provider.baseUrl || apiKeys.lmstudio?.baseUrl || 'http://127.0.0.1:1234';
  else merged.apiKey = provider.apiKey || apiKeys[keyMap[provider.type]]?.apiKey || '';
  try {
    const content = await llmChatCompletion(merged, messages, contextDocuments || []);
    return { content };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('chat-completion-stream', async (event, { providerId, messages, contextDocuments }) => {
  const providers = store.get('aiProviders', []);
  const apiKeys = store.get('aiApiKeys', {});
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return { error: 'Provider not found' };
  const merged = { ...provider };
  const keyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  if (provider.type === 'lmstudio') merged.baseUrl = provider.baseUrl || apiKeys.lmstudio?.baseUrl || 'http://127.0.0.1:1234';
  else merged.apiKey = provider.apiKey || apiKeys[keyMap[provider.type]]?.apiKey || '';
  const request = buildStreamRequest(merged, messages, contextDocuments || []);
  if (!request) return { error: 'Failed to build stream request' };
  try {
    return await new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'llm-stream-worker.js');
      const worker = new Worker(workerPath, { workerData: {} });
      worker.postMessage({ url: request.url, options: request.options, body: request.body });
      worker.on('message', (msg) => {
        if (msg.type === 'chunk' && msg.content) {
          event.sender.send('chat-stream-chunk', msg.content);
        } else if (msg.type === 'done') {
          worker.terminate();
          event.sender.send('chat-stream-done', msg.error ? { error: msg.error } : {});
          resolve({ ok: true });
        }
      });
      worker.on('error', (err) => {
        worker.terminate();
        event.sender.send('chat-stream-done', { error: err.message });
        resolve({ error: err.message });
      });
    });
  } catch (err) {
    event.sender.send('chat-stream-done', { error: err.message || String(err) });
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('get-chat-messages', () => {
  return store.get('chatMessages', []);
});

ipcMain.handle('save-chat-messages', (_, messages) => {
  store.set('chatMessages', messages || []);
  return { ok: true };
});

ipcMain.handle('get-chat-sessions', () => {
  return {
    sessions: store.get('chatSessions', []),
    activeSessionId: store.get('activeSessionId'),
  };
});

ipcMain.handle('save-chat-sessions', (_, { sessions, activeSessionId }) => {
  if (sessions !== undefined) store.set('chatSessions', sessions);
  if (activeSessionId !== undefined) store.set('activeSessionId', activeSessionId);
  return { ok: true };
});

function httpGet(url, headers = {}) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (ch) => (data += ch));
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(data) });
          } catch (e) {
            resolve({ ok: false, data: null, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000);
    req.end();
  });
}

ipcMain.handle('fetch-lmstudio-models', async (_, baseUrl) => {
  try {
    let url = (baseUrl || 'http://127.0.0.1:1234').replace(/\/$/, '').replace(/localhost/gi, '127.0.0.1');
    url = url.endsWith('/api/v1') ? url : url + '/api/v1';
    const apiUrl = `${url}/models`;
    const { ok, data } = await httpGet(apiUrl);
    if (!ok || !data) return { models: [], error: data?.raw || 'Request failed' };
    const list = data?.models ?? data?.data ?? (Array.isArray(data) ? data : []);
    const seen = new Set();
    const models = list
      .filter((m) => m.type === 'llm')
      .map((m) => ({
        id: m.key ?? m.id ?? m.name ?? m.model,
        name: m.display_name ?? m.key ?? m.id ?? m.name ?? m.model,
        maxContextLength: m.max_context_length ?? m.context_length ?? m.maxContextLength,
      }))
      .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id));
    return { models };
  } catch (e) {
    return { models: [], error: e.message };
  }
});

ipcMain.handle('fetch-openai-models', async (_, apiKey) => {
  try {
    if (!apiKey) return { models: [], error: 'API key required' };
    const { ok, data, raw } = await httpGet('https://api.openai.com/v1/models', {
      Authorization: `Bearer ${apiKey}`,
    });
    if (!ok) return { models: [], error: data?.error?.message || (raw && raw.slice(0, 200)) || 'Request failed' };
    const list = data?.data ?? [];
    const models = list
      .filter((m) => m.id && !m.id.startsWith('ft:'))
      .map((m) => ({ id: m.id, name: m.id, maxContextLength: null }))
      .slice(0, 100);
    return { models };
  } catch (e) {
    return { models: [], error: e.message };
  }
});

ipcMain.handle('fetch-anthropic-models', async (_, apiKey) => {
  try {
    if (!apiKey) return { models: [], error: 'API key required' };
    const { ok, data, raw } = await httpGet('https://api.anthropic.com/v1/models', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    });
    if (!ok) return { models: [], error: data?.error?.message || (raw && raw.slice(0, 200)) || 'Request failed' };
    const list = data?.data ?? [];
    const models = list.map((m) => ({
      id: m.id,
      name: m.display_name ?? m.id,
      maxContextLength: m.max_input_tokens ?? null,
    }));
    return { models };
  } catch (e) {
    return { models: [], error: e.message };
  }
});

ipcMain.handle('fetch-google-models', async (_, apiKey) => {
  try {
    if (!apiKey) return { models: [], error: 'API key required' };
    const { ok, data, raw } = await httpGet(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!ok) return { models: [], error: data?.error?.message || (raw && raw.slice(0, 200)) || 'Request failed' };
    const list = data?.models ?? [];
    const models = list
      .filter((m) => {
        const methods = m.supported_generation_methods ?? m.supportedGenerationMethods ?? [];
        return m.name && (methods.includes('generateContent') || methods.includes('generate_content'));
      })
      .map((m) => ({
        id: (m.name || '').replace(/^models\//, ''),
        name: m.display_name ?? m.displayName ?? m.name,
        maxContextLength: m.input_token_limit ?? m.inputTokenLimit ?? null,
      }))
      .filter((m) => m.id);
    return { models };
  } catch (e) {
    return { models: [], error: e.message };
  }
});

ipcMain.handle('get-open-tabs', () => {
  return {
    openTabs: store.get('openTabs', []),
    activeTabPath: store.get('activeTabPath'),
  };
});

ipcMain.handle('save-open-tabs', (_, { openTabs, activeTabPath }) => {
  store.set('openTabs', openTabs || []);
  store.set('activeTabPath', activeTabPath);
  return { ok: true };
});
