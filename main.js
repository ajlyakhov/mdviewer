const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const { chatCompletion: llmChatCompletion, buildStreamRequest } = require('./llm-adapter');
const { Worker } = require('worker_threads');
const { createKnowledgebaseService, DEFAULT_EMBEDDING_MODEL } = require('./knowledgebase/service');

let store;
let mainWindow;
let pendingOpenFile = null;
let pdfParseLoader = null;
let knowledgebase = null;

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
        {
          label: 'Import PDF...',
          click: () => {
            showOpenDialog(
              { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] },
              async (result) => {
                if (result.canceled || !result.filePaths?.length || !mainWindow) return;
                const sourcePdfPath = result.filePaths[0];
                await importPdfAndOpen(sourcePdfPath, getWindow() || mainWindow);
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
      knowledgebase: {
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        topK: 12,
        maxPerDocument: 3,
      },
    },
  });
  knowledgebase = createKnowledgebaseService(app.getPath('userData'));
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
      label: 'Add to knowledgebase',
      click: () => event.sender.send('tab-context-action', { action: 'addToKnowledgebase', index }),
    },
    { type: 'separator' },
    {
      label: 'Close Tab',
      click: () => event.sender.send('tab-context-action', { action: 'close', index }),
    },
    {
      label: 'Close All Other Tabs',
      click: () => event.sender.send('tab-context-action', { action: 'closeOthers', index }),
    },
    {
      label: 'Close All',
      click: () => event.sender.send('tab-context-action', { action: 'closeAll' }),
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

async function loadPdfParse() {
  if (!pdfParseLoader) {
    // pdf-parse@1.x uses a Node-oriented PDF.js bundle and avoids DOMMatrix warnings in Electron main.
    pdfParseLoader = require('pdf-parse');
  }
  return pdfParseLoader;
}

function buildImportedMdPath(pdfPath) {
  const dir = path.dirname(pdfPath);
  const baseName = path.basename(pdfPath, path.extname(pdfPath));
  const candidates = [
    path.join(dir, `${baseName}.md`),
    path.join(dir, `${baseName}.imported.md`),
  ];
  for (let i = 2; i <= 999; i++) {
    candidates.push(path.join(dir, `${baseName}.imported-${i}.md`));
  }
  const available = candidates.find((candidate) => !fs.existsSync(candidate));
  return available || path.join(dir, `${baseName}.imported-${Date.now()}.md`);
}

function sanitizePdfImportErrorMessage(err) {
  const raw = String(err?.message || err || '').trim();
  if (!raw) return 'Unknown PDF import error';
  if (raw.includes('Likely scanned/image-only PDF')) {
    return raw;
  }
  if (raw.includes('PasswordException')) {
    return 'This PDF is encrypted/password-protected and cannot be imported.';
  }
  if (/InvalidPDFException|FormatError/i.test(raw)) {
    return 'The selected file is not a valid PDF or is corrupted.';
  }
  return raw;
}

function median(values) {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeLineText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function itemFontSize(item) {
  const h = Number(item?.height);
  if (Number.isFinite(h) && h > 0) return h;
  const t = item?.transform || [];
  const fallback = Math.sqrt((Number(t[2]) || 0) ** 2 + (Number(t[3]) || 0) ** 2);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 12;
}

function pageTextToMarkdown(items) {
  const prepared = (items || [])
    .map((item) => {
      const text = normalizeLineText(item?.str || '');
      if (!text) return null;
      const t = item?.transform || [];
      return {
        text,
        x: Number(t[4]) || 0,
        y: Number(t[5]) || 0,
        size: itemFontSize(item),
        fontName: String(item?.fontName || ''),
      };
    })
    .filter(Boolean);

  if (!prepared.length) return { markdown: '', charCount: 0 };
  const yTolerance = 2.2;
  const lines = [];
  for (const seg of prepared.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(last.y - seg.y) > yTolerance) {
      lines.push({ y: seg.y, segments: [seg] });
    } else {
      last.segments.push(seg);
    }
  }

  const lineData = lines
    .map((line) => {
      const segments = line.segments.sort((a, b) => a.x - b.x);
      const joined = normalizeLineText(segments.map((s) => s.text).join(' '));
      if (!joined) return null;
      return {
        text: joined,
        maxSize: Math.max(...segments.map((s) => s.size)),
        avgSize: segments.reduce((acc, s) => acc + s.size, 0) / segments.length,
        boldHint: segments.some((s) => /bold|black|demi/i.test(s.fontName)),
      };
    })
    .filter(Boolean);

  if (!lineData.length) return { markdown: '', charCount: 0 };
  const baseSize = median(lineData.map((l) => l.avgSize));
  const mdLines = [];
  let chars = 0;

  for (const line of lineData) {
    const text = line.text;
    chars += text.length;
    const headingLike = (line.maxSize >= baseSize * 1.38 || (line.boldHint && line.maxSize >= baseSize * 1.22)) && text.length <= 120;
    if (headingLike) {
      mdLines.push(`## ${text}`);
      mdLines.push('');
      continue;
    }
    if (/^([•◦▪●\-*]|(\d+[\.\)]))\s+/.test(text)) {
      mdLines.push(text.replace(/^([•◦▪●])/u, '-'));
      continue;
    }
    mdLines.push(text);
  }
  return { markdown: mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), charCount: chars };
}

async function importPdfToMarkdown(pdfPath, onProgress) {
  const pdfParse = await loadPdfParse();
  const targetPath = buildImportedMdPath(pdfPath);
  const bytes = await fs.promises.readFile(pdfPath);
  const pages = [];
  let totalChars = 0;
  let processedPages = 0;
  const parsed = await pdfParse(bytes, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      processedPages += 1;
      const pageCount = Number(pageData?._pdfInfo?.numPages) || null;
      const { markdown, charCount } = pageTextToMarkdown(content?.items || []);
      totalChars += charCount;
      pages.push(`<!-- Page ${processedPages} -->\n\n${markdown}`);
      if (typeof onProgress === 'function') {
        onProgress({
          current: processedPages,
          total: pageCount,
          taskStatus: pageCount && processedPages >= pageCount ? 'finished' : 'processing',
        });
      }
      return markdown;
    },
  });

  const pageCount = Number(parsed?.numpages) || processedPages;
  const markdown = pages.join('\n\n---\n\n').trim();
  if (pageCount === 0) {
    throw new Error('PDF has no pages.');
  }
  if (!markdown) {
    throw new Error('No extractable text found in PDF.');
  }
  if (totalChars < Math.max(40, pageCount * 16)) {
    throw new Error(
      'Likely scanned/image-only PDF: extracted text is too small for reliable markdown conversion. OCR fallback is required.'
    );
  }
  await fs.promises.writeFile(targetPath, markdown, 'utf-8');
  return targetPath;
}

async function importPdfAndOpen(sourcePdfPath, win) {
  const targetWindow = win || getWindow() || mainWindow;
  const sender = targetWindow?.webContents;
  sender?.send('pdf-import-progress', {
    taskStatus: 'started',
    current: 0,
    total: null,
    filePath: sourcePdfPath,
  });
  try {
    const mdPath = await importPdfToMarkdown(sourcePdfPath, (progress) => {
      sender?.send('pdf-import-progress', {
        taskStatus: progress.taskStatus || 'processing',
        current: Number(progress.current) || 0,
        total: Number(progress.total) || null,
        filePath: sourcePdfPath,
      });
    });
    sender?.send('pdf-import-done', {
      ok: true,
      filePath: sourcePdfPath,
      outputPath: mdPath,
    });
    mainWindow?.webContents?.send('open-files', [mdPath]);
    return { ok: true, outputPath: mdPath };
  } catch (err) {
    const detail = sanitizePdfImportErrorMessage(err);
    sender?.send('pdf-import-done', {
      ok: false,
      filePath: sourcePdfPath,
      error: detail,
    });
    dialog.showMessageBox(targetWindow || mainWindow, {
      type: 'error',
      title: 'Import PDF failed',
      message: 'Could not import PDF',
      detail,
    });
    return { ok: false, error: detail };
  }
}

function findDuti() {
  const candidates = ['/opt/homebrew/bin/duti', '/usr/local/bin/duti'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function normalizeLocalBaseUrl(url, fallback) {
  const raw = String(url || '').trim();
  return (raw || fallback).replace(/\/$/, '').replace(/localhost/gi, '127.0.0.1');
}

function lineChunks(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripTerminalControl(input) {
  const raw = String(input || '');
  const withoutAnsi = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[@-Z\\-_]/g, '');
  return withoutAnsi
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .trim();
}

function unitToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const key = String(unit || '').toUpperCase();
  const multipliers = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const m = multipliers[key];
  if (!m) return null;
  return Math.round(n * m);
}

function parseOllamaPullLine(rawLine) {
  const line = stripTerminalControl(rawLine);
  if (!line) return null;
  const percentMatch = line.match(/(\d{1,3})%/);
  if (percentMatch) {
    const pct = Math.max(0, Math.min(100, Number(percentMatch[1]) || 0));
    return { current: pct, total: 100, meta: line };
  }
  const bytesMatch = line.match(/(\d+(?:\.\d+)?)\s*([KMGT]?B)\s*\/\s*(\d+(?:\.\d+)?)\s*([KMGT]?B)/i);
  if (bytesMatch) {
    const current = unitToBytes(bytesMatch[1], bytesMatch[2]);
    const total = unitToBytes(bytesMatch[3], bytesMatch[4]);
    if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
      return { current, total, meta: line };
    }
  }
  return { meta: line };
}

function runCommandCapture(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ ok: false, code: -1, error: error?.message || String(error), stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: Number(code) || 0, stdout, stderr });
    });
  });
}

function runCommandProgress(command, args = [], options = {}) {
  const onLine = options.onLine;
  const spawnOpts = { ...options };
  delete spawnOpts.onLine;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...spawnOpts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (typeof onLine === 'function') {
        const lines = text.split(/\r|\n/).map(stripTerminalControl).filter(Boolean);
        for (const line of lines) onLine(line, 'stdout');
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (typeof onLine === 'function') {
        const lines = text.split(/\r|\n/).map(stripTerminalControl).filter(Boolean);
        for (const line of lines) onLine(line, 'stderr');
      }
    });
    child.on('error', (error) => {
      resolve({ ok: false, code: -1, error: error?.message || String(error), stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code: Number(code) || 0, stdout, stderr });
    });
  });
}

async function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const res = await runCommandCapture(checker, [command], { shell: process.platform === 'win32' });
  return Boolean(res.ok && String(res.stdout || '').trim());
}

function getOllamaCandidatePaths() {
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin/ollama',
      '/usr/local/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
    ];
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || '';
    return [
      path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(programFiles, 'Ollama', 'ollama.exe'),
      'ollama.exe',
    ];
  }
  return ['/usr/local/bin/ollama', '/usr/bin/ollama', path.join(process.env.HOME || '', '.local', 'bin', 'ollama')];
}

async function resolveOllamaExecutable() {
  for (const candidate of getOllamaCandidatePaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const has = await commandExists(process.platform === 'win32' ? 'ollama.exe' : 'ollama');
  if (has) return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  return null;
}

function parseOllamaTagsPayload(payload) {
  const list = payload?.models ?? payload?.data ?? (Array.isArray(payload) ? payload : []);
  const models = list
    .map((m) => {
      const id = m?.name || m?.model || m?.id;
      if (!id) return null;
      const details = m?.details || {};
      const ctx = details?.context_length || details?.contextLength || null;
      return {
        id,
        name: id,
        maxContextLength: Number.isFinite(Number(ctx)) ? Number(ctx) : null,
        effectiveContextLength: Number.isFinite(Number(ctx)) ? Number(ctx) : null,
      };
    })
    .filter(Boolean);
  const embeddingModels = models.filter((m) => /embed|embedding|nomic-embed|mxbai-embed/i.test(String(m.id || '')));
  const llmModels = models.filter((m) => !/embed|embedding|nomic-embed|mxbai-embed/i.test(String(m.id || '')));
  return {
    llmModels,
    embeddingModels,
    hasLlm: llmModels.length > 0,
    hasEmbedding: embeddingModels.length > 0,
    recommendedChatModels: ['qwen2.5:7b', 'llama3.1:8b', 'mistral:7b'],
    recommendedEmbeddingModels: ['nomic-embed-text', 'mxbai-embed-large'],
  };
}

async function checkOllamaAvailability(baseUrl) {
  try {
    const url = normalizeLocalBaseUrl(baseUrl, 'http://127.0.0.1:11434');
    const { ok, data, raw } = await httpGet(`${url}/api/tags`);
    if (!ok || !data) return { ok: false, error: raw || data?.raw || 'Request failed' };
    return { ok: true, ...parseOllamaTagsPayload(data) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function sendOllamaSetupProgress(sender, payload = {}) {
  sender?.send('ollama-setup-progress', {
    message: payload.message || '',
    meta: payload.meta || '',
    current: Number(payload.current) || 0,
    total: Number(payload.total) || null,
    stage: payload.stage || '',
  });
}

async function waitForOllama(baseUrl, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const check = await checkOllamaAvailability(baseUrl);
    if (check?.ok) return check;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, error: 'Ollama did not become ready in time.' };
}

async function ensureOllamaServerRunning(ollamaCmd, baseUrl) {
  const probe = await checkOllamaAvailability(baseUrl);
  if (probe?.ok) return probe;
  if (!ollamaCmd) return { ok: false, error: 'Ollama executable not found.' };
  const child = spawn(ollamaCmd, ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return waitForOllama(baseUrl, 25000);
}

async function installOllamaIfMissing() {
  const existing = await resolveOllamaExecutable();
  if (existing) return { ok: true, installed: false, ollamaCmd: existing };
  if (process.platform === 'darwin') {
    if (await commandExists('brew')) {
      const installResult = await runCommandProgress('brew', ['install', 'ollama'], { shell: false });
      if (!installResult.ok) return { ok: false, error: installResult.stderr || installResult.stdout || 'brew install failed' };
    } else {
      const installResult = await runCommandProgress('/bin/bash', ['-lc', 'curl -fsSL https://ollama.com/install.sh | sh']);
      if (!installResult.ok) return { ok: false, error: installResult.stderr || installResult.stdout || 'Ollama install script failed' };
    }
  } else if (process.platform === 'linux') {
    const scriptCmd = 'curl -fsSL https://ollama.com/install.sh | sh';
    let installResult = await runCommandProgress('/bin/bash', ['-lc', scriptCmd]);
    if (!installResult.ok) {
      installResult = await runCommandProgress('/bin/bash', ['-lc', 'curl -fsSL https://ollama.com/install.sh | sudo -n sh']);
    }
    if (!installResult.ok && await commandExists('pkexec')) {
      installResult = await runCommandProgress('/bin/bash', ['-lc', "pkexec sh -c \"curl -fsSL https://ollama.com/install.sh | sh\""]);
    }
    if (!installResult.ok) {
      return {
        ok: false,
        error:
          (installResult.stderr || installResult.stdout || 'Ollama install script failed') +
          '\nTry manually: curl -fsSL https://ollama.com/install.sh | sh',
      };
    }
  } else if (process.platform === 'win32') {
    const psScript =
      "$temp=Join-Path $env:TEMP 'OllamaSetup.exe';" +
      "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $temp;" +
      "Start-Process -FilePath $temp -ArgumentList '/VERYSILENT','/NORESTART' -Verb RunAs -Wait;";
    const installResult = await runCommandProgress('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
      shell: true,
    });
    if (!installResult.ok) {
      return {
        ok: false,
        error:
          (installResult.stderr || installResult.stdout || 'Windows installer failed') +
          '\nTry manual install: https://ollama.com/download',
      };
    }
  } else {
    return { ok: false, error: `Unsupported OS: ${process.platform}` };
  }
  const resolved = await resolveOllamaExecutable();
  if (!resolved) return { ok: false, error: 'Ollama installation finished but executable was not found in PATH.' };
  return { ok: true, installed: true, ollamaCmd: resolved };
}

async function removePathIfExists(targetPath) {
  if (!targetPath) return { ok: true };
  try {
    if (!fs.existsSync(targetPath)) return { ok: true };
    await fs.promises.rm(targetPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function tryPrivilegedRm(targets = []) {
  const quoted = targets
    .filter(Boolean)
    .map((p) => `"${String(p).replace(/"/g, '\\"')}"`)
    .join(' ');
  if (!quoted) return { ok: true };
  const sudoTry = await runCommandProgress('/bin/bash', ['-lc', `sudo -n rm -rf ${quoted}`]);
  if (sudoTry.ok) return { ok: true };
  if (await commandExists('pkexec')) {
    const pkexecTry = await runCommandProgress('/bin/bash', ['-lc', `pkexec rm -rf ${quoted}`]);
    if (pkexecTry.ok) return { ok: true };
    return { ok: false, error: pkexecTry.stderr || pkexecTry.stdout || 'Privileged cleanup failed' };
  }
  return { ok: false, error: sudoTry.stderr || sudoTry.stdout || 'Privileged cleanup failed' };
}

async function uninstallOllama(args = {}, sender) {
  const baseUrl = normalizeLocalBaseUrl(args.baseUrl, 'http://127.0.0.1:11434');
  const progress = (current, total, message, meta = '') =>
    sendOllamaSetupProgress(sender, { stage: 'uninstall', current, total, message, meta });

  progress(1, 5, 'Stopping Ollama service', 'Cleaning running processes...');
  if (process.platform === 'win32') {
    await runCommandCapture('taskkill', ['/F', '/IM', 'ollama.exe'], { shell: true });
  } else {
    await runCommandCapture('/bin/bash', ['-lc', 'pkill -f "[/]ollama" || true']);
  }

  progress(2, 5, 'Removing Ollama models data', 'Deleting local model cache...');
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const userTargets = process.platform === 'win32'
    ? [path.join(home, '.ollama'), path.join(localAppData, 'Ollama')]
    : [path.join(home, '.ollama')];
  for (const t of userTargets) await removePathIfExists(t);

  progress(3, 5, 'Removing executable files', 'Deleting app binaries...');
  if (process.platform === 'darwin') {
    if (await commandExists('brew')) await runCommandCapture('brew', ['uninstall', 'ollama']);
    await removePathIfExists('/Applications/Ollama.app');
    await removePathIfExists('/opt/homebrew/bin/ollama');
    await removePathIfExists('/usr/local/bin/ollama');
  } else if (process.platform === 'linux') {
    const direct = [
      '/usr/local/bin/ollama',
      '/usr/bin/ollama',
      '/usr/share/ollama',
      '/var/lib/ollama',
      '/etc/systemd/system/ollama.service',
      '/lib/systemd/system/ollama.service',
    ];
    const failed = [];
    for (const t of direct) {
      const res = await removePathIfExists(t);
      if (!res.ok && fs.existsSync(t)) failed.push(t);
    }
    if (failed.length) await tryPrivilegedRm(failed);
  } else if (process.platform === 'win32') {
    const installDir = path.join(localAppData, 'Programs', 'Ollama');
    const uninstallExe = path.join(installDir, 'Uninstall Ollama.exe');
    if (fs.existsSync(uninstallExe)) {
      await runCommandCapture('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Start-Process -FilePath '${uninstallExe.replace(/'/g, "''")}' -ArgumentList '/SILENT' -Verb RunAs -Wait`,
      ], { shell: true });
    }
    await removePathIfExists(installDir);
  }

  progress(4, 5, 'Finalizing cleanup', 'Verifying Ollama endpoint is offline...');
  const check = await checkOllamaAvailability(baseUrl);
  if (check?.ok) {
    return {
      ok: false,
      error: 'Ollama endpoint is still reachable after uninstall. Stop any external Ollama instance and retry.',
    };
  }

  progress(5, 5, 'Uninstall complete', 'Ollama and local data were removed.');
  return { ok: true };
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

ipcMain.handle('import-pdf', async (event, sourcePdfPath) => {
  if (!sourcePdfPath || !/\.pdf$/i.test(sourcePdfPath)) {
    return { ok: false, error: 'Please provide a valid PDF file path.' };
  }
  const win = BrowserWindow.fromWebContents(event.sender) || getWindow() || mainWindow;
  return importPdfAndOpen(sourcePdfPath, win);
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

async function resolveKnowledgebaseEmbeddingProviderConfig() {
  const providers = store.get('aiProviders', []);
  const apiKeys = store.get('aiApiKeys', {});
  const kb = store.get('knowledgebase', {});
  const topK = Number(kb.topK) > 0 ? Number(kb.topK) : 12;
  const maxPerDocument = Number(kb.maxPerDocument) > 0 ? Number(kb.maxPerDocument) : 3;
  const lmProvider = providers.find((p) => p.type === 'lmstudio' && p.enabled !== false);
  const ollamaProvider = providers.find((p) => p.type === 'ollama' && p.enabled !== false);
  const openAiProvider = providers.find((p) => p.type === 'openai' && p.enabled !== false);
  const lmConfigured = Boolean(lmProvider);
  const ollamaConfigured = Boolean(ollamaProvider);
  const openAiConfigured = Boolean(openAiProvider);
  const openAiApiKey = openAiConfigured ? (openAiProvider?.apiKey || apiKeys.openai?.apiKey || '') : '';

  if (lmConfigured) {
    const baseUrl = lmProvider?.baseUrl || apiKeys.lmstudio?.baseUrl || 'http://127.0.0.1:1234';
    const selectedEmbeddingModel = String(lmProvider?.embeddingModel || '').trim();
    if (!selectedEmbeddingModel) {
      return {
        provider: { type: 'minilm' },
        topK,
        maxPerDocument,
        status: {
          backend: 'minilm',
          label: 'MiniLM (fallback)',
          detail: 'LM Studio is configured but no embedding model is selected. Using MiniLM.',
        },
      };
    }
    const availableModel = await resolveLmStudioEmbeddingModel(baseUrl, selectedEmbeddingModel);
    if (availableModel) {
      return {
        provider: {
          type: 'lmstudio',
          baseUrl,
          model: availableModel,
          allowMiniLmFallback: true,
        },
        topK,
        maxPerDocument,
        status: {
          backend: 'lmstudio',
          label: `LM Studio (${availableModel})`,
          detail: `Using LM Studio embeddings at ${baseUrl}`,
        },
      };
    }
    return {
      provider: { type: 'minilm' },
      topK,
      maxPerDocument,
      status: {
        backend: 'minilm',
        label: 'MiniLM (fallback)',
        detail: 'LM Studio is configured but no embedding model is loaded.',
      },
    };
  }

  if (ollamaConfigured) {
    const baseUrl = ollamaProvider?.baseUrl || apiKeys.ollama?.baseUrl || 'http://127.0.0.1:11434';
    const selectedEmbeddingModel = String(ollamaProvider?.embeddingModel || '').trim() || 'nomic-embed-text';
    const availableModel = await resolveOllamaEmbeddingModel(baseUrl, selectedEmbeddingModel);
    if (availableModel) {
      return {
        provider: {
          type: 'ollama',
          baseUrl,
          model: availableModel,
          allowMiniLmFallback: true,
        },
        topK,
        maxPerDocument,
        status: {
          backend: 'ollama',
          label: `Ollama (${availableModel})`,
          detail: `Using Ollama embeddings at ${baseUrl}`,
        },
      };
    }
    return {
      provider: { type: 'minilm' },
      topK,
      maxPerDocument,
      status: {
        backend: 'minilm',
        label: 'MiniLM (fallback)',
        detail: 'Ollama is configured but embedding model is unavailable.',
      },
    };
  }

  if (openAiConfigured && openAiApiKey) {
    return {
      provider: {
        type: 'openai',
        apiKey: openAiApiKey,
        model: 'text-embedding-3-small',
        allowMiniLmFallback: true,
      },
      topK,
      maxPerDocument,
      status: {
        backend: 'openai',
        label: 'OpenAI (text-embedding-3-small)',
        detail: 'Using OpenAI embeddings (LM Studio not configured).',
      },
    };
  }

  return {
    provider: { type: 'minilm' },
    topK,
    maxPerDocument,
    status: {
      backend: 'minilm',
      label: 'MiniLM (local fallback)',
      detail: 'No LM Studio/OpenAI embedding provider configured.',
    },
  };
}

async function resolveLmStudioEmbeddingModel(baseUrl, preferredModel) {
  try {
    let url = String(baseUrl || 'http://127.0.0.1:1234').replace(/\/$/, '').replace(/localhost/gi, '127.0.0.1');
    url = url.endsWith('/api/v1') ? url : `${url}/api/v1`;
    const apiUrl = `${url}/models`;
    const { ok, data } = await httpGet(apiUrl);
    if (!ok || !data) return null;
    const list = data?.models ?? data?.data ?? (Array.isArray(data) ? data : []);
    const embeddingModels = list.filter((m) => m.type === 'embedding');
    if (!embeddingModels.length) return null;
    const preferred = String(preferredModel || '').trim();
    if (preferred) {
      const found = embeddingModels.find((m) => {
        const id = m.key ?? m.id ?? m.name ?? m.model;
        return id === preferred;
      });
      if (!found) return null;
      return found.key ?? found.id ?? found.name ?? found.model ?? null;
    }
    const first = embeddingModels[0];
    return first.key ?? first.id ?? first.name ?? first.model ?? null;
  } catch (_) {
    return null;
  }
}

async function resolveOllamaEmbeddingModel(baseUrl, preferredModel) {
  try {
    const check = await checkOllamaAvailability(baseUrl);
    if (!check?.ok) return null;
    const embeddingModels = check.embeddingModels || [];
    if (!embeddingModels.length) return null;
    const preferred = String(preferredModel || '').trim();
    if (preferred) {
      const found = embeddingModels.find((m) => m.id === preferred);
      if (!found) return null;
      return found.id;
    }
    return embeddingModels[0]?.id || null;
  } catch (_) {
    return null;
  }
}

async function importFilesToKnowledgebase(filePaths = [], onProgress) {
  if (!knowledgebase) return { ok: false, error: 'Knowledgebase unavailable' };
  const cfg = await resolveKnowledgebaseEmbeddingProviderConfig();
  const files = [...new Set((filePaths || []).filter((p) => /\.(md|markdown)$/i.test(String(p || ''))))];
  let imported = 0;
  let skipped = 0;
  const errors = [];
  if (typeof onProgress === 'function') {
    onProgress({ stage: 'start', files });
  }
  for (const filePath of files) {
    try {
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'item', path: filePath, status: 'processing' });
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const res = await knowledgebase.addDocument({
        path: filePath,
        content,
        embeddingProvider: cfg.provider,
        replacePathVersions: true,
      });
      if (res?.alreadyExists) {
        skipped += 1;
        if (typeof onProgress === 'function') {
          onProgress({ stage: 'item', path: filePath, status: 'skipped' });
        }
      } else {
        imported += 1;
        if (typeof onProgress === 'function') {
          onProgress({ stage: 'item', path: filePath, status: 'imported' });
        }
      }
    } catch (err) {
      errors.push({ path: filePath, error: err.message || String(err) });
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'item', path: filePath, status: 'failed', error: err.message || String(err) });
      }
    }
  }
  const result = { ok: true, imported, skipped, failed: errors.length, errors };
  if (typeof onProgress === 'function') {
    onProgress({ stage: 'done', ...result });
  }
  return result;
}

ipcMain.handle('kb-get-document-status', async (_, { path: docPath, content }) => {
  if (!knowledgebase) return { inKnowledgebase: false, docFingerprint: null, document: null };
  return knowledgebase.getDocumentStatus({ path: docPath, content });
});

ipcMain.handle('kb-add-document', async (_, { path: docPath, content, replacePathVersions }) => {
  if (!knowledgebase) return { ok: false, error: 'Knowledgebase unavailable' };
  try {
    const cfg = await resolveKnowledgebaseEmbeddingProviderConfig();
    const result = await knowledgebase.addDocument({
      path: docPath,
      content,
      embeddingProvider: cfg.provider,
      replacePathVersions: Boolean(replacePathVersions),
    });
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('kb-delete-document', async (_, { docFingerprint }) => {
  if (!knowledgebase) return { ok: false, error: 'Knowledgebase unavailable' };
  try {
    return await knowledgebase.deleteDocumentByFingerprint(docFingerprint);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('kb-list-documents', async () => {
  if (!knowledgebase) return { documents: [] };
  try {
    const documents = await knowledgebase.listDocuments();
    return { documents };
  } catch (err) {
    return { documents: [], error: err.message || String(err) };
  }
});

ipcMain.handle('kb-import-file-dialog', async (event) => {
  try {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { ok: true, imported: 0, skipped: 0, failed: 0, cancelled: true };
    }
    return importFilesToKnowledgebase(result.filePaths, (payload) => {
      event.sender.send('kb-import-progress', payload);
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('kb-import-folder-dialog', async (event) => {
  try {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths?.length) {
      return { ok: true, imported: 0, skipped: 0, failed: 0, cancelled: true };
    }
    const folder = result.filePaths[0];
    const files = await collectMdFiles(folder);
    return importFilesToKnowledgebase(files, (payload) => {
      event.sender.send('kb-import-progress', payload);
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('kb-clear-all', async () => {
  if (!knowledgebase) return { ok: false, error: 'Knowledgebase unavailable' };
  try {
    return await knowledgebase.clearAll();
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('kb-build-context', async (_, { query }) => {
  if (!knowledgebase) return { contextDocuments: [] };
  try {
    const cfg = await resolveKnowledgebaseEmbeddingProviderConfig();
    const { contextDocuments, references } = await knowledgebase.buildContextDocuments({
      query,
      provider: cfg.provider,
      topK: cfg.topK,
      maxPerDocument: cfg.maxPerDocument,
    });
    return { contextDocuments, references };
  } catch (err) {
    return { contextDocuments: [], references: [], error: err.message || String(err) };
  }
});

ipcMain.handle('kb-get-embedding-backend-status', async () => {
  try {
    const cfg = await resolveKnowledgebaseEmbeddingProviderConfig();
    return cfg?.status || { backend: 'unknown', label: 'Unknown backend', detail: '' };
  } catch (err) {
    return {
      backend: 'unknown',
      label: 'Unknown backend',
      detail: err?.message || String(err),
    };
  }
});

ipcMain.handle('chat-completion', async (_, { providerId, messages, contextDocuments, contextWindow }) => {
  const providers = store.get('aiProviders', []);
  const apiKeys = store.get('aiApiKeys', {});
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return { error: 'Provider not found' };
  const merged = { ...provider };
  const keyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  if (provider.type === 'lmstudio') merged.baseUrl = provider.baseUrl || apiKeys.lmstudio?.baseUrl || 'http://127.0.0.1:1234';
  else if (provider.type === 'ollama') merged.baseUrl = provider.baseUrl || apiKeys.ollama?.baseUrl || 'http://127.0.0.1:11434';
  else merged.apiKey = provider.apiKey || apiKeys[keyMap[provider.type]]?.apiKey || '';
  if (contextWindow) {
    merged.maxContextLength = contextWindow.maxContextLength ?? merged.maxContextLength;
    merged.loadedContextLength = contextWindow.loadedContextLength ?? merged.loadedContextLength;
    merged.effectiveContextLength = contextWindow.effectiveContextLength ?? merged.effectiveContextLength;
    merged.maxOutputTokens = contextWindow.maxOutputTokens ?? merged.maxOutputTokens;
  }
  try {
    const content = await llmChatCompletion(merged, messages, contextDocuments || []);
    return { content };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('chat-completion-stream', async (event, { providerId, messages, contextDocuments, contextWindow }) => {
  const providers = store.get('aiProviders', []);
  const apiKeys = store.get('aiApiKeys', {});
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return { error: 'Provider not found' };
  const merged = { ...provider };
  const keyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  if (provider.type === 'lmstudio') merged.baseUrl = provider.baseUrl || apiKeys.lmstudio?.baseUrl || 'http://127.0.0.1:1234';
  else if (provider.type === 'ollama') merged.baseUrl = provider.baseUrl || apiKeys.ollama?.baseUrl || 'http://127.0.0.1:11434';
  else merged.apiKey = provider.apiKey || apiKeys[keyMap[provider.type]]?.apiKey || '';
  if (contextWindow) {
    merged.maxContextLength = contextWindow.maxContextLength ?? merged.maxContextLength;
    merged.loadedContextLength = contextWindow.loadedContextLength ?? merged.loadedContextLength;
    merged.effectiveContextLength = contextWindow.effectiveContextLength ?? merged.effectiveContextLength;
    merged.maxOutputTokens = contextWindow.maxOutputTokens ?? merged.maxOutputTokens;
  }
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
        maxContextLength: m.max_context_length ?? m.context_length ?? m.maxContextLength ?? null,
        loadedContextLength:
          m.loaded_instances?.[0]?.config?.context_length ??
          m.loadedInstances?.[0]?.config?.contextLength ??
          null,
        effectiveContextLength:
          m.loaded_instances?.[0]?.config?.context_length ??
          m.loadedInstances?.[0]?.config?.contextLength ??
          m.max_context_length ??
          m.context_length ??
          m.maxContextLength ??
          null,
      }))
      .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id));
    return { models };
  } catch (e) {
    return { models: [], error: e.message };
  }
});

ipcMain.handle('check-lmstudio-availability', async (_, baseUrl) => {
  try {
    let url = (baseUrl || 'http://127.0.0.1:1234').replace(/\/$/, '').replace(/localhost/gi, '127.0.0.1');
    url = url.endsWith('/api/v1') ? url : `${url}/api/v1`;
    const apiUrl = `${url}/models`;
    const { ok, data } = await httpGet(apiUrl);
    if (!ok || !data) {
      return { ok: false, error: data?.raw || 'Request failed' };
    }
    const list = data?.models ?? data?.data ?? (Array.isArray(data) ? data : []);
    const llmModels = list.filter((m) => m.type === 'llm').map((m) => ({
      id: m.key ?? m.id ?? m.name ?? m.model,
      name: m.display_name ?? m.key ?? m.id ?? m.name ?? m.model,
      maxContextLength: m.max_context_length ?? m.context_length ?? m.maxContextLength ?? null,
      loadedContextLength:
        m.loaded_instances?.[0]?.config?.context_length ??
        m.loadedInstances?.[0]?.config?.contextLength ??
        null,
      effectiveContextLength:
        m.loaded_instances?.[0]?.config?.context_length ??
        m.loadedInstances?.[0]?.config?.contextLength ??
        m.max_context_length ??
        m.context_length ??
        m.maxContextLength ??
        null,
    }));
    const embeddingModels = list.filter((m) => m.type === 'embedding').map((m) => ({
      id: m.key ?? m.id ?? m.name ?? m.model,
      name: m.display_name ?? m.key ?? m.id ?? m.name ?? m.model,
    }));
    return {
      ok: true,
      llmModels,
      embeddingModels,
      hasLlm: llmModels.length > 0,
      hasEmbedding: embeddingModels.length > 0,
      recommendedChatModels: ['qwen2.5-7b-instruct', 'llama-3.1-8b-instruct', 'mistral-7b-instruct'],
      recommendedEmbeddingModels: ['nomic-embed-text-v1.5', 'mxbai-embed-large-v1'],
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('fetch-ollama-models', async (_, baseUrl) => {
  const status = await checkOllamaAvailability(baseUrl);
  if (!status?.ok) return { models: [], embeddingModels: [], error: status?.error || 'Request failed' };
  return { models: status.llmModels || [], embeddingModels: status.embeddingModels || [] };
});

ipcMain.handle('check-ollama-availability', async (_, baseUrl) => {
  return checkOllamaAvailability(baseUrl);
});

ipcMain.handle('uninstall-ollama', async (event, args = {}) => {
  const sender = event.sender;
  const finish = (payload) => {
    sender?.send('ollama-setup-done', payload);
    return payload;
  };
  try {
    const result = await uninstallOllama(args, sender);
    if (!result?.ok) return finish({ ok: false, message: 'Ollama uninstall failed', error: result?.error || 'Uninstall failed' });
    return finish({ ok: true, message: 'Ollama uninstalled' });
  } catch (err) {
    return finish({ ok: false, message: 'Ollama uninstall failed', error: err?.message || String(err) });
  }
});

ipcMain.handle('start-ollama-autosetup', async (event, args = {}) => {
  const sender = event.sender;
  const baseUrl = normalizeLocalBaseUrl(args.baseUrl, 'http://127.0.0.1:11434');
  const chatModel = String(args.chatModel || 'qwen2.5:7b').trim() || 'qwen2.5:7b';
  const embeddingModel = String(args.embeddingModel || 'nomic-embed-text').trim() || 'nomic-embed-text';
  const totalStages = 5;
  const finish = (payload) => {
    sender?.send('ollama-setup-done', payload);
    return payload;
  };
  try {
    sendOllamaSetupProgress(sender, {
      stage: 'install',
      current: 1,
      total: totalStages,
      message: 'Installing Ollama',
      meta: 'Detecting local installation...',
    });
    const installed = await installOllamaIfMissing();
    if (!installed?.ok) return finish({ ok: false, error: installed?.error || 'Ollama install failed', message: 'Install failed' });
    const ollamaCmd = installed.ollamaCmd;
    sendOllamaSetupProgress(sender, {
      stage: 'server',
      current: 2,
      total: totalStages,
      message: 'Starting Ollama service',
      meta: installed.installed ? 'Installation complete. Starting service...' : 'Ollama already installed. Starting service...',
    });
    const started = await ensureOllamaServerRunning(ollamaCmd, baseUrl);
    if (!started?.ok) {
      return finish({
        ok: false,
        error: started?.error || 'Failed to start Ollama service',
        message: 'Service startup failed',
      });
    }
    sendOllamaSetupProgress(sender, {
      stage: 'pull-chat',
      current: 3,
      total: totalStages,
      message: `Downloading ${chatModel}`,
      meta: 'This can take a while depending on your network.',
    });
    const chatPull = await runCommandProgress(ollamaCmd, ['pull', chatModel], {
      shell: process.platform === 'win32',
      onLine: (line) => {
        const parsed = parseOllamaPullLine(line) || {};
        sendOllamaSetupProgress(sender, {
          stage: 'pull-chat',
          current: parsed.current,
          total: parsed.total,
          message: `Downloading ${chatModel}`,
          meta: parsed.meta || line,
        });
      },
    });
    if (!chatPull?.ok) {
      return finish({
        ok: false,
        error: chatPull?.stderr || chatPull?.stdout || `Failed to pull ${chatModel}`,
        message: 'Chat model download failed',
      });
    }
    sendOllamaSetupProgress(sender, {
      stage: 'pull-embedding',
      current: 4,
      total: totalStages,
      message: `Downloading ${embeddingModel}`,
      meta: 'Preparing embedding model...',
    });
    const embPull = await runCommandProgress(ollamaCmd, ['pull', embeddingModel], {
      shell: process.platform === 'win32',
      onLine: (line) => {
        const parsed = parseOllamaPullLine(line) || {};
        sendOllamaSetupProgress(sender, {
          stage: 'pull-embedding',
          current: parsed.current,
          total: parsed.total,
          message: `Downloading ${embeddingModel}`,
          meta: parsed.meta || line,
        });
      },
    });
    if (!embPull?.ok) {
      return finish({
        ok: false,
        error: embPull?.stderr || embPull?.stdout || `Failed to pull ${embeddingModel}`,
        message: 'Embedding model download failed',
      });
    }
    sendOllamaSetupProgress(sender, {
      stage: 'verify',
      current: 5,
      total: totalStages,
      message: 'Verifying Ollama and models',
      meta: 'Running health check...',
    });
    const finalCheck = await checkOllamaAvailability(baseUrl);
    if (!finalCheck?.ok) {
      return finish({
        ok: false,
        error: finalCheck?.error || 'Ollama verification failed',
        message: 'Verification failed',
      });
    }
    return finish({
      ok: true,
      message: 'Ollama setup complete',
      baseUrl,
      llmModels: finalCheck.llmModels || [],
      embeddingModels: finalCheck.embeddingModels || [],
    });
  } catch (err) {
    return finish({ ok: false, error: err?.message || String(err), message: 'Auto-setup failed' });
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
