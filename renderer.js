const hljsLib = window.hljs;
const { Marked } = window.marked;
const { markedHighlight } = window.markedHighlight;

const markedLib = {
  parse: (md) =>
    new Marked(
      markedHighlight({
        langPrefix: 'hljs language-',
        emptyLangClass: 'hljs',
        highlight(code, lang) {
          if (lang && hljsLib.getLanguage(lang)) {
            return hljsLib.highlight(code, { language: lang }).value;
          }
          return hljsLib.highlightAuto(code).value;
        },
      })
    ).parse(md),
};
const mermaidLib = window.mermaid;

const dropzone = document.getElementById('dropzone');
const viewer = document.getElementById('viewer');
const markdownEl = document.getElementById('markdown');
const viewerMarkdown = document.getElementById('viewer-markdown');
const viewerFrame = document.getElementById('viewer-frame');
const externalFrame = document.getElementById('external-frame');
const backBtn = document.getElementById('back-btn');
const tabsEl = document.getElementById('tabs');
const searchInput = document.getElementById('search-input');
const themeSelect = document.getElementById('theme');
const viewerSettings = document.getElementById('viewer-settings');
const viewerChat = document.getElementById('viewer-chat');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');
const chatModelSelect = document.getElementById('chat-model-select');
const chatModelTrigger = document.getElementById('chat-model-trigger');
const chatModelMenu = document.getElementById('chat-model-menu');
const content = document.querySelector('.content');

const SETTINGS_TAB = { type: 'settings', name: 'Settings' };
const CHAT_TAB = { type: 'chat', name: 'Talk to your docs' };

let chatMessagesData = [];
let chatSessions = [];
let activeSessionId = null;
let aiProviders = [];

const DEFAULT_MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 700;
const INPUT_SAFETY_MARGIN_TOKENS = 200;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_DOCS_FOR_CONTEXT = 5;
const MAX_DOC_CHARS = 4000;
const MAX_RECENT_MESSAGES = 24;

let tabs = [];
let activeIndex = 0;
let searchCurrentIndex = 0;
let restoreDone = false;
let pendingOpenPaths = [];

// Theme
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getTheme() {
  return localStorage.getItem('mdviewer-theme') || 'system';
}

function applyTheme(theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.classList.toggle('theme-dark', resolved === 'dark');
  const hljsId = 'hljs-' + resolved;
  document.querySelectorAll('[id^="hljs-"]').forEach((l) => {
    l.disabled = l.id !== hljsId;
  });
}

function initTheme() {
  const stored = getTheme();
  themeSelect.value = stored;
  applyTheme(stored);

  themeSelect.addEventListener('change', () => {
    localStorage.setItem('mdviewer-theme', themeSelect.value);
    applyTheme(themeSelect.value);
    renderActive();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}

// Settings
function openSettings() {
  const idx = tabs.findIndex((t) => t.type === 'settings');
  if (idx >= 0) {
    activeIndex = idx;
  } else {
    tabs.push(SETTINGS_TAB);
    activeIndex = tabs.length - 1;
    dropzone.classList.add('hidden');
    viewer.style.display = 'block';
  }
  themeSelect.value = getTheme();
  setDefaultResult && (setDefaultResult.textContent = '');
  setDefaultResult && (setDefaultResult.className = 'settings-result');
  renderTabs();
  renderActive();
  saveOpenTabs();
}

const setDefaultMdBtn = document.getElementById('set-default-md');
const setDefaultResult = document.getElementById('set-default-result');
setDefaultMdBtn?.addEventListener('click', async () => {
  setDefaultResult.textContent = '';
  setDefaultResult.className = 'settings-result';
  try {
    const res = await window.mdviewer?.setDefaultMdApp?.();
    if (res?.ok) {
      setDefaultResult.textContent = 'Done. .md files will now open with MD Viewer.';
      setDefaultResult.className = 'settings-result success';
    } else {
      setDefaultResult.textContent = res?.error || 'Failed';
      setDefaultResult.className = 'settings-result error';
      if (res?.help) setDefaultResult.textContent += ' ' + res.help;
    }
  } catch (err) {
    setDefaultResult.textContent = err?.message || 'Error';
    setDefaultResult.className = 'settings-result error';
  }
});

window.mdviewer?.onOpenSettings?.(openSettings);

window.mdviewer?.onTabContextAction?.(({ action, index }) => {
  if (action === 'close') {
    closeTab(index);
  } else if (action === 'closeOthers') {
    tabs = [tabs[index]];
    activeIndex = 0;
    renderTabs();
    renderActive();
    saveOpenTabs();
  }
});

function closeTab(idx) {
  tabs.splice(idx, 1);
  if (activeIndex >= tabs.length) activeIndex = Math.max(0, tabs.length - 1);
  if (activeIndex > idx) activeIndex--;
  if (tabs.length === 0) {
    dropzone.classList.remove('hidden');
    viewer.style.display = 'none';
  } else {
    renderActive();
  }
  renderTabs();
  saveOpenTabs();
}

mermaidLib.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

function resolvePath(basePath, relativePath) {
  const baseDir = basePath.replace(/[/\\][^/\\]*$/, '') || '/';
  const normalized = (baseDir + '/' + relativePath).replace(/\\/g, '/');
  const parts = normalized.split('/');
  const resolved = [];
  for (const p of parts) {
    if (p === '..') resolved.pop();
    else if (p && p !== '.') resolved.push(p);
  }
  return '/' + resolved.join('/');
}

function resolveRelativePath(basePath, relativePath) {
  return 'file://' + encodeURI(resolvePath(basePath, relativePath));
}

let currentFilePath = null;

function setupLinkHandler() {
  viewer.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = (a.getAttribute('href') || '').trim();
    if (!href) return;

    if (href.startsWith('#')) return;

    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      showExternalUrl(href);
      return;
    }

    if (/\.(md|markdown)(?:[#?]|$)/i.test(href)) {
      e.preventDefault();
      const pathOnly = href.replace(/[#?].*/, '');
      const basePath = currentFilePath || tabs[activeIndex]?.path;
      const resolved = pathOnly.startsWith('/') ? pathOnly : (basePath ? resolvePath(basePath, pathOnly) : null);
      if (resolved) openOrSwitchToFile(resolved);
      return;
    }

    e.preventDefault();
    const basePath = currentFilePath || tabs[activeIndex]?.path;
    if (basePath) {
      const resolved = href.startsWith('/') ? href : resolvePath(basePath, href);
      window.mdviewer?.openExternal?.(`file://${encodeURI(resolved)}`);
    } else {
      window.mdviewer?.openExternal?.(href);
    }
  });
}

function resolveLocalImages(filePath) {
  if (!filePath) return;
  markdownEl.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || /^(https?:|data:|blob:|#)/i.test(src)) return;
    img.src = src.startsWith('/')
      ? 'file://' + encodeURI(src)
      : resolveRelativePath(filePath, src);
  });
}

async function parseAndRender(md, filePath) {
  const mermaidBlocks = [];
  const placeholder = '___MERMAID_PLACEHOLDER_';
  let processed = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `<div class="mermaid" data-mermaid-id="${idx}">${placeholder}</div>`;
  });

  const html = markedLib.parse(processed);
  markdownEl.innerHTML = html;
  resolveLocalImages(filePath);

  const theme = getTheme() === 'system' ? getSystemTheme() : getTheme();
  mermaidLib.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });

  for (let i = 0; i < mermaidBlocks.length; i++) {
    const el = markdownEl.querySelector(`[data-mermaid-id="${i}"]`);
    if (!el) continue;
    try {
      const { svg } = await mermaidLib.render(`mermaid-${Date.now()}-${i}`, mermaidBlocks[i]);
      el.innerHTML = svg;
    } catch (err) {
      el.innerHTML = `<pre class="mermaid-error">${err.message}</pre>`;
    }
  }
}

function renderActive() {
  if (tabs.length === 0) return;
  const tab = tabs[activeIndex];
  hideExternalUrl();
  viewerChat?.classList.add('hidden');
  if (tab.type === 'settings') {
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.remove('hidden');
    renderAiSettings();
    return;
  }
  if (tab.type === 'chat') {
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.add('hidden');
    viewerChat?.classList.remove('hidden');
    renderChatTab();
    return;
  }
  viewerMarkdown?.classList.remove('hidden');
  viewerSettings?.classList.add('hidden');
  currentFilePath = tab.path;
  parseAndRender(tab.content, tab.path);
  applySearchHighlights(searchInput?.value?.trim() || '');
  viewerMarkdown?.scrollTo?.(0, 0);
}

function getSearchContainer() {
  const tab = tabs[activeIndex];
  if (tab?.type === 'chat') return chatMessages;
  return markdownEl;
}

function applySearchHighlights(term) {
  const container = getSearchContainer();
  searchCurrentIndex = 0;
  container.querySelectorAll('.search-highlight').forEach((el) => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
  if (!term) return;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escapeRe(term), 'gi');
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);

  textNodes.forEach((node) => {
    const text = node.textContent;
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) return;

    const frag = document.createDocumentFragment();
    let lastEnd = 0;
    for (const m of matches) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = m[0];
      frag.appendChild(mark);
      lastEnd = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    node.parentNode.replaceChild(frag, node);
  });
}

function scrollToSearchMatch(direction) {
  const container = getSearchContainer();
  const highlights = container.querySelectorAll('.search-highlight');
  if (!highlights.length) return;
  const len = highlights.length;
  searchCurrentIndex = (searchCurrentIndex + direction + len) % len;
  highlights[searchCurrentIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Tabs
function renderTabs() {
  tabsEl.innerHTML = tabs
    .map(
      (t, i) =>
        `<div class="tab ${i === activeIndex ? 'active' : ''}" data-index="${i}" title="${t.path ? escapeHtml(t.path) : ''}">
          <span class="tab-label">${escapeHtml(t.name)}</span>
          <button type="button" class="tab-close" data-index="${i}" title="Close">×</button>
        </div>`
    )
    .join('');

  tabsEl.querySelectorAll('.tab').forEach((tab) => {
    const idx = parseInt(tab.dataset.index, 10);
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      activeIndex = idx;
      renderTabs();
      renderActive();
      saveOpenTabs();
    });
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.mdviewer?.showTabContextMenu?.(idx);
    });
  });

  tabsEl.querySelectorAll('.tab-close').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeTab(parseInt(btn.dataset.index, 10));
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// File handling
async function loadFile(path) {
  try {
    const content = await window.mdviewer.readFile(path);
    return { path, name: path.split(/[/\\]/).pop(), content };
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function openOrSwitchToFile(path) {
  const idx = tabs.findIndex((t) => t.type === 'file' && t.path === path);
  if (idx >= 0) {
    activeIndex = idx;
    renderTabs();
    renderActive();
    return;
  }
  await openFiles([path]);
}

async function openFiles(paths) {
  if (!paths?.length) return;
  const newTabs = [];
  for (const p of paths) {
    const f = await loadFile(p);
    if (f && !tabs.some((t) => t.type === 'file' && t.path === f.path)) {
      newTabs.push({ type: 'file', ...f });
    }
  }
  if (newTabs.length === 0) return;
  tabs.push(...newTabs);
  activeIndex = tabs.length - newTabs.length;
  dropzone.classList.add('hidden');
  viewer.style.display = 'block';
  renderTabs();
  renderActive();
  saveOpenTabs();
}

async function openFolder(folderPath) {
  try {
    const resolved = await window.mdviewer.readDir(folderPath);
    if (resolved?.length) await openFiles(resolved);
  } catch (err) {
    console.error(err);
  }
}

// Drag & drop - use getPathForFile for Electron 32+ compatibility
function getPathsFromDrop(e) {
  const paths = [];
  const addFile = (file) => {
    if (!file) return;
    const path = window.mdviewer?.getPathForFile?.(file);
    if (path) paths.push(path);
  };
  if (e.dataTransfer.files) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      addFile(e.dataTransfer.files[i]);
    }
  }
  if (e.dataTransfer.items && paths.length === 0) {
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const item = e.dataTransfer.items[i];
      if (item.kind === 'file') addFile(item.getAsFile());
    }
  }
  return paths;
}

async function collectMdPaths(paths) {
  const result = [];
  for (const p of paths) {
    try {
      const resolved = await window.mdviewer.readDir(p);
      if (resolved?.length) result.push(...resolved);
    } catch (_) {}
  }
  return [...new Set(result)];
}

function setupDragDrop(el) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    content.classList.add('drag-over');
  });

  el.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!content.contains(e.relatedTarget)) content.classList.remove('drag-over');
  });

  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    content.classList.remove('drag-over');
    const raw = getPathsFromDrop(e);
    const paths = await collectMdPaths(raw);
    if (paths.length) await openFiles(paths);
  });
}

// Dropzone icon click - open folder dialog
dropzone?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (tabs.length === 0) window.mdviewer?.showFolderDialog?.();
});

// Attach drop to document so it works everywhere (including when viewer is shown)
setupDragDrop(document);
setupDragDrop(dropzone);

function handleOpenPaths(paths) {
  if (!paths?.length) return;
  if (!restoreDone) {
    pendingOpenPaths.push(...paths);
    return;
  }
  openFiles(paths);
}
window.mdviewer?.onOpenFile?.((path) => handleOpenPaths([path]));
window.mdviewer?.onOpenFiles?.((paths) => handleOpenPaths(paths));
window.mdviewer?.onOpenFolder?.(openFolder);

function showExternalUrl(url) {
  viewerMarkdown?.classList.add('hidden');
  viewerSettings?.classList.add('hidden');
  viewerChat?.classList.add('hidden');
  viewerFrame?.classList.remove('hidden');
  backBtn?.classList.remove('hidden');
  externalFrame?.setAttribute('src', url);
}

function hideExternalUrl() {
  viewerFrame?.classList.add('hidden');
  backBtn?.classList.add('hidden');
  externalFrame?.removeAttribute('src');
}

backBtn?.addEventListener('click', () => {
  hideExternalUrl();
  renderActive();
});

setupLinkHandler();

// Search
searchInput?.addEventListener('input', () => {
  applySearchHighlights(searchInput.value.trim() || '');
});

searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    searchInput.blur();
    applySearchHighlights('');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    scrollToSearchMatch(e.shiftKey ? -1 : 1);
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    searchInput?.focus();
  }
});

// Talk to your docs
function getEnabledProviders() {
  return aiProviders.filter((p) => p.enabled !== false);
}

async function updateTalkToDocButton() {
  const btn = document.getElementById('talk-to-doc-btn');
  if (!btn) return;
  const config = await window.mdviewer?.getAiConfig?.();
  aiProviders = (config?.aiProviders || []).map((p) => ({ ...p, enabled: p.enabled !== false }));
  btn.classList.toggle('disabled', getEnabledProviders().length === 0);
}

function openChatTab() {
  if (getEnabledProviders().length === 0) {
    openSettings();
    return;
  }
  const idx = tabs.findIndex((t) => t.type === 'chat');
  if (idx >= 0) {
    activeIndex = idx;
  } else {
    tabs.push(CHAT_TAB);
    activeIndex = tabs.length - 1;
    dropzone.classList.add('hidden');
    viewer.style.display = 'block';
  }
  renderTabs();
  renderActive();
  saveOpenTabs();
}

function saveOpenTabs() {
  const fileTabs = tabs.filter((t) => t.type === 'file');
  const openTabs = fileTabs.map((t) => ({ path: t.path }));
  const activeTab = tabs[activeIndex];
  const activeTabPath = activeTab?.type === 'file' ? activeTab.path : null;
  window.mdviewer?.saveOpenTabs?.({ openTabs, activeTabPath });
}

async function restoreOpenTabs() {
  const { openTabs, activeTabPath } = await window.mdviewer?.getOpenTabs?.() || {};
  if (openTabs?.length) {
    const paths = openTabs.map((t) => t.path).filter(Boolean);
    if (paths.length) {
      const newTabs = [];
      for (const p of paths) {
        const f = await loadFile(p);
        if (f) newTabs.push({ type: 'file', ...f });
      }
      if (newTabs.length > 0) {
        tabs.push(...newTabs);
        const idx = activeTabPath ? newTabs.findIndex((t) => t.path === activeTabPath) : 0;
        activeIndex = idx >= 0 ? idx : 0;
        dropzone.classList.add('hidden');
        viewer.style.display = 'block';
        renderTabs();
        renderActive();
      }
    }
  }
  restoreDone = true;
  if (pendingOpenPaths.length) {
    const p = pendingOpenPaths.splice(0);
    await openFiles(p);
  }
}

// AI Settings - Cursor-style
let aiApiKeys = {};
const aiModelSearch = document.getElementById('ai-model-search');
const aiModelsList = document.getElementById('ai-models-list');
const aiKeysCollapse = document.getElementById('ai-keys-collapse');
const aiKeysSection = document.querySelector('.ai-keys-section');
const aiAddForm = document.getElementById('ai-add-model-form');
const aiAddType = document.getElementById('ai-add-type');
const aiAddModelId = document.getElementById('ai-add-model-id');
const aiAddSave = document.getElementById('ai-add-save');
const aiAddCancel = document.getElementById('ai-add-cancel');
const typeLabels = { lmstudio: 'LM Studio', openai: 'OpenAI', claude: 'Claude', google: 'Google AI' };
let lmStudioModelMetaById = {};
let cloudModelMetaById = {};

function getModelSearch() {
  return (aiModelSearch?.value || '').trim().toLowerCase();
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / APPROX_CHARS_PER_TOKEN));
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getProviderEffectiveContextLength(provider) {
  return (
    toInt(provider?.effectiveContextLength) ||
    toInt(provider?.loadedContextLength) ||
    toInt(provider?.maxContextLength) ||
    DEFAULT_MAX_CONTEXT_TOKENS
  );
}

function getProviderReservedOutputTokens(provider) {
  const configured =
    provider?.maxOutputTokensUserSet
      ? toInt(provider?.maxOutputTokens)
      : toInt(provider?.reservedOutputTokens);
  if (configured) return configured;
  const effective = getProviderEffectiveContextLength(provider);
  if (effective <= 2300) return 700;
  if (effective <= 5000) return 1200;
  if (effective <= 12000) return 1600;
  return 2000;
}

function renderAiModelsList() {
  if (!aiModelsList) return;
  const q = getModelSearch();
  const rows = aiProviders
    .filter((p) => {
      const label = `${typeLabels[p.type] || p.type} / ${p.modelId || ''}`.toLowerCase();
      return !q || label.includes(q);
    })
    .map(
      (p) =>
        `<div class="ai-model-row" data-id="${escapeHtml(p.id)}">
          <span class="ai-model-name">${escapeHtml(typeLabels[p.type] || p.type)} / ${escapeHtml(p.modelId || '-')}</span>
          <div class="ai-model-actions">
            <button type="button" class="ai-model-remove" data-id="${escapeHtml(p.id)}" title="Remove">×</button>
            <div class="ai-toggle ${p.enabled !== false ? 'enabled' : ''}" data-id="${escapeHtml(p.id)}" role="button" tabindex="0"></div>
          </div>
        </div>`
    )
    .join('');
  aiModelsList.innerHTML = rows || '<div class="ai-model-row ai-model-empty"><span class="ai-model-name">No models. Click + to add one.</span></div>';
  aiModelsList.querySelectorAll('.ai-toggle[data-id]').forEach((el) => {
    el.addEventListener('click', () => toggleModel(el.dataset.id));
  });
  aiModelsList.querySelectorAll('.ai-model-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      aiProviders = aiProviders.filter((p) => p.id !== id);
      await window.mdviewer?.saveAiConfig?.({ aiProviders });
      renderAiModelsList();
      updateTalkToDocButton();
    });
  });
}

async function toggleModel(id) {
  const p = aiProviders.find((x) => x.id === id);
  if (!p) return;
  p.enabled = p.enabled === false;
  await window.mdviewer?.saveAiConfig?.({ aiProviders });
  renderAiModelsList();
  updateTalkToDocButton();
}

function populateApiKeyInputs() {
  const oa = document.getElementById('ai-key-openai');
  const an = document.getElementById('ai-key-anthropic');
  const go = document.getElementById('ai-key-google');
  if (oa) oa.value = aiApiKeys.openai?.apiKey || aiProviders.find((p) => p.type === 'openai')?.apiKey || '';
  if (an) an.value = aiApiKeys.anthropic?.apiKey || aiProviders.find((p) => p.type === 'claude')?.apiKey || '';
  if (go) go.value = aiApiKeys.google?.apiKey || aiProviders.find((p) => p.type === 'google')?.apiKey || '';
}

async function saveApiKeys() {
  const oa = document.getElementById('ai-key-openai')?.value?.trim();
  const an = document.getElementById('ai-key-anthropic')?.value?.trim();
  const go = document.getElementById('ai-key-google')?.value?.trim();
  aiApiKeys = {
    openai: { apiKey: oa || '' },
    anthropic: { apiKey: an || '' },
    google: { apiKey: go || '' },
  };
  aiProviders.forEach((p) => {
    if (p.type === 'openai') p.apiKey = oa || p.apiKey;
    else if (p.type === 'claude') p.apiKey = an || p.apiKey;
    else if (p.type === 'google') p.apiKey = go || p.apiKey;
  });
  await window.mdviewer?.saveAiConfig?.({ aiProviders, aiApiKeys });
}

async function renderAiSettings() {
  const config = await window.mdviewer?.getAiConfig?.();
  aiProviders = (config?.aiProviders || []).map((p) => ({ ...p, enabled: p.enabled !== false }));
  aiApiKeys = config?.aiApiKeys || {};
  renderAiModelsList();
  populateApiKeyInputs();
  updateTalkToDocButton();
}

function initAiSettings() {
  aiModelSearch?.addEventListener('input', renderAiModelsList);
  document.getElementById('ai-add-model-btn')?.addEventListener('click', openAddForm);
  document.getElementById('ai-refresh-models')?.addEventListener('click', () => {
    renderAiSettings();
  });
  aiKeysCollapse?.addEventListener('click', () => {
    aiKeysSection?.classList.toggle('collapsed');
  });
  ['ai-key-openai', 'ai-key-anthropic', 'ai-key-google'].forEach((id) => {
    document.getElementById(id)?.addEventListener('blur', saveApiKeys);
    document.getElementById(id)?.addEventListener('change', saveApiKeys);
  });
  const addPlaceholders = { openai: 'e.g. gpt-4o', claude: 'e.g. claude-3-5-sonnet', google: 'e.g. gemini-1.5-flash' };
  const lmstudioWrap = document.getElementById('ai-add-lmstudio-wrap');
  const cloudWrap = document.getElementById('ai-add-cloud-wrap');
  const manualWrap = document.getElementById('ai-add-manual-wrap');
  const lmstudioSelect = document.getElementById('ai-add-lmstudio-model');
  const lmstudioHint = document.getElementById('ai-add-lmstudio-hint');
  const cloudSelect = document.getElementById('ai-add-cloud-model');
  const cloudHint = document.getElementById('ai-add-cloud-hint');

  async function fetchLmStudioModels() {
    const baseUrl = aiApiKeys.lmstudio?.baseUrl || aiProviders.find((p) => p.type === 'lmstudio')?.baseUrl || 'http://127.0.0.1:1234';
    if (lmstudioSelect) {
      lmstudioSelect.disabled = true;
      lmstudioSelect.innerHTML = '<option value="">Loading models...</option>';
      if (lmstudioHint) lmstudioHint.textContent = '';
    }
    const { models, error } = await window.mdviewer?.fetchLmStudioModels?.(baseUrl) || {};
    if (lmstudioSelect) {
      lmstudioSelect.disabled = false;
      if (error) {
        lmStudioModelMetaById = {};
        lmstudioSelect.innerHTML = '<option value="">Failed to load – enter manually below</option>';
        if (lmstudioHint) lmstudioHint.textContent = error;
        manualWrap?.classList.remove('hidden');
        return;
      }
      if (!models?.length) {
        lmStudioModelMetaById = {};
        lmstudioSelect.innerHTML = '<option value="">No models found – check LM Studio server</option>';
        if (lmstudioHint) lmstudioHint.textContent = 'Ensure LM Studio server is running and a model is loaded.';
        return;
      }
      lmStudioModelMetaById = Object.fromEntries(
        models.map((m) => [m.id, m])
      );
      lmstudioSelect.innerHTML = models
        .map((m) => {
          const effective = toInt(m.effectiveContextLength) || toInt(m.maxContextLength);
          const loaded = toInt(m.loadedContextLength);
          const ctx = effective ? ` (${(effective / 1024).toFixed(0)}k ctx)` : '';
          const runtime = loaded && effective && loaded < effective ? ' [loaded lower]' : '';
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}${escapeHtml(ctx)}${escapeHtml(runtime)}</option>`;
        })
        .join('');
      if (lmstudioHint) {
        const downgraded = models.filter((m) => {
          const loaded = toInt(m.loadedContextLength);
          const max = toInt(m.maxContextLength);
          return loaded && max && loaded < max;
        }).length;
        lmstudioHint.textContent = downgraded
          ? `${models.length} model(s) from LM Studio. ${downgraded} loaded with smaller runtime context.`
          : `${models.length} model(s) from LM Studio`;
      }
    }
  }

  async function fetchCloudModels(type) {
    const keyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
    const keyId = keyMap[type];
    const apiKey = aiApiKeys[keyId]?.apiKey || document.getElementById(`ai-key-${keyId}`)?.value?.trim() || '';
    if (cloudSelect) {
      cloudSelect.disabled = true;
      cloudSelect.innerHTML = '<option value="">Loading models...</option>';
      if (cloudHint) cloudHint.textContent = '';
    }
    const fetchFn = {
      openai: window.mdviewer?.fetchOpenAIModels,
      claude: window.mdviewer?.fetchAnthropicModels,
      google: window.mdviewer?.fetchGoogleModels,
    }[type];
    const { models, error } = (await fetchFn?.(apiKey)) || {};
    if (cloudSelect) {
      cloudSelect.disabled = false;
      if (!apiKey) {
        cloudModelMetaById = {};
        cloudSelect.innerHTML = '<option value="">Enter API key in API Keys section first</option>';
        if (cloudHint) cloudHint.textContent = 'Expand API Keys and add your key.';
        return;
      }
      if (error) {
        cloudModelMetaById = {};
        cloudSelect.innerHTML = '<option value="">Failed to load – enter manually below</option>';
        if (cloudHint) cloudHint.textContent = error;
        manualWrap?.classList.remove('hidden');
        return;
      }
      if (!models?.length) {
        cloudModelMetaById = {};
        cloudSelect.innerHTML = '<option value="">No models found</option>';
        if (cloudHint) cloudHint.textContent = error || 'Check your API key.';
        return;
      }
      cloudModelMetaById = Object.fromEntries(models.map((m) => [m.id, m]));
      cloudSelect.innerHTML = models
        .map((m) => {
          const ctx = m.maxContextLength ? ` (${(m.maxContextLength / 1024).toFixed(0)}k ctx)` : '';
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}${escapeHtml(ctx)}</option>`;
        })
        .join('');
      if (cloudHint) cloudHint.textContent = `${models.length} model(s) available`;
    }
  }

  function switchAddModelUI(type) {
    const isLm = type === 'lmstudio';
    const isCloud = ['openai', 'claude', 'google'].includes(type);
    lmstudioWrap?.classList.toggle('hidden', !isLm);
    cloudWrap?.classList.toggle('hidden', !isCloud);
    manualWrap?.classList.toggle('hidden', isLm || isCloud);
    if (aiAddModelId) aiAddModelId.placeholder = addPlaceholders[type] || 'Model ID';
    if (isLm) fetchLmStudioModels();
    else if (isCloud) fetchCloudModels(type);
  }

  function openAddForm() {
    aiAddForm?.classList.remove('hidden');
    aiAddType.value = 'lmstudio';
    aiAddModelId.value = '';
    switchAddModelUI('lmstudio');
  }
  aiAddType?.addEventListener('change', () => switchAddModelUI(aiAddType.value));

  function closeAddForm() {
    aiAddForm?.classList.add('hidden');
    aiModelSearch.value = '';
    renderAiModelsList();
  }
  aiAddSave?.addEventListener('click', async () => {
    const type = aiAddType.value;
    let modelId = '';
    if (type === 'lmstudio') modelId = (lmstudioSelect?.value || '').trim();
    else if (['openai', 'claude', 'google'].includes(type)) modelId = (cloudSelect?.value || '').trim();
    if (!modelId) modelId = aiAddModelId?.value?.trim() || '';
    if (!modelId) return;
    const keys = aiApiKeys;
    const selectedMeta =
      type === 'lmstudio'
        ? lmStudioModelMetaById[modelId]
        : ['openai', 'claude', 'google'].includes(type)
          ? cloudModelMetaById[modelId]
          : null;
    const maxContextLength = toInt(selectedMeta?.maxContextLength);
    const loadedContextLength = toInt(selectedMeta?.loadedContextLength);
    const effectiveContextLength =
      toInt(selectedMeta?.effectiveContextLength) ||
      loadedContextLength ||
      maxContextLength ||
      null;
    const provider = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      type,
      modelId,
      enabled: true,
      maxContextLength,
      loadedContextLength,
      effectiveContextLength,
      maxOutputTokens: null,
      maxOutputTokensUserSet: false,
      baseUrl: type === 'lmstudio' ? (keys.lmstudio?.baseUrl || aiProviders.find((p) => p.type === 'lmstudio')?.baseUrl || 'http://127.0.0.1:1234') : undefined,
      apiKey: type === 'openai' ? (keys.openai?.apiKey || '') : type === 'claude' ? (keys.anthropic?.apiKey || '') : type === 'google' ? (keys.google?.apiKey || '') : '',
    };
    aiProviders.push(provider);
    await window.mdviewer?.saveAiConfig?.({ aiProviders });
    closeAddForm();
    renderAiModelsList();
    updateTalkToDocButton();
  });
  aiAddCancel?.addEventListener('click', closeAddForm);
  aiAddForm?.addEventListener('click', (e) => {
    if (e.target === aiAddForm) closeAddForm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiAddForm && !aiAddForm.classList.contains('hidden')) closeAddForm();
  });
}

// Chat tab
function updateChatPlaceholder() {
  if (!chatInput) return;
  const hasMessages = chatMessagesData.length > 0;
  chatInput.placeholder = hasMessages ? 'Add followup' : 'Ask anything';
}

async function loadChatSessions() {
  const data = await window.mdviewer?.getChatSessions?.() || {};
  chatSessions = data.sessions || [];
  activeSessionId = data.activeSessionId ?? null;
}

async function loadChatMessages() {
  await loadChatSessions();
  if (activeSessionId) {
    const session = chatSessions.find((s) => s.id === activeSessionId);
    if (!session) {
      activeSessionId = null;
      chatMessagesData = await window.mdviewer?.getChatMessages?.() || [];
    } else {
      chatMessagesData = [...(session.messages || [])];
    }
  } else {
    chatMessagesData = await window.mdviewer?.getChatMessages?.() || [];
  }
}

async function saveChatMessages() {
  if (activeSessionId) {
    const idx = chatSessions.findIndex((s) => s.id === activeSessionId);
    if (idx >= 0) {
      chatSessions[idx] = {
        ...chatSessions[idx],
        messages: [...chatMessagesData],
        memory: computeCurrentSessionMemory(),
      };
      await window.mdviewer?.saveChatSessions?.({ sessions: chatSessions });
    }
  } else {
    await window.mdviewer?.saveChatMessages?.(chatMessagesData);
  }
}

function sessionSummary(messages) {
  const first = messages?.find((m) => m.role === 'user');
  if (!first?.content) return 'New chat';
  const s = String(first.content).trim();
  return s.length > 50 ? s.slice(0, 47) + '...' : s;
}

function computeCurrentSessionMemory() {
  const source = sanitizeMessagesForApi(chatMessagesData);
  if (source.length <= 8) return buildStructuredSessionMemory(source);
  const older = source.slice(0, -8);
  const recent = source.slice(-8);
  return mergeSessionMemory(buildStructuredSessionMemory(older), buildStructuredSessionMemory(recent));
}

function formatSessionTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

function hasMeaningfulSessionContent() {
  const hasUserMessage = chatMessagesData.some(
    (m) => m.role === 'user' && String(m.content || '').trim()
  );
  const hasFiles = tabs.some((t) => t.type === 'file');
  return hasUserMessage || (hasFiles && chatMessagesData.length > 0);
}

async function saveCurrentAsSession() {
  if (!hasMeaningfulSessionContent()) return;
  const openFiles = tabs.filter((t) => t.type === 'file').map((t) => ({ path: t.path }));

  if (activeSessionId) {
    const idx = chatSessions.findIndex((s) => s.id === activeSessionId);
    if (idx >= 0) {
      chatSessions[idx] = {
        ...chatSessions[idx],
        summary: sessionSummary(chatMessagesData),
        openFiles,
        messages: [...chatMessagesData],
        memory: computeCurrentSessionMemory(),
      };
    }
  } else {
    const session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      summary: sessionSummary(chatMessagesData),
      openFiles,
      messages: [...chatMessagesData],
      memory: computeCurrentSessionMemory(),
      createdAt: Date.now(),
    };
    chatSessions.push(session);
  }
  const toPersist = chatSessions.filter(sessionHasContent);
  await window.mdviewer?.saveChatSessions?.({ sessions: toPersist });
  chatSessions = toPersist;
  if (activeSessionId && !chatSessions.find((s) => s.id === activeSessionId)) {
    activeSessionId = null;
  }
}

async function createNewSession() {
  await saveCurrentAsSession();
  activeSessionId = null;
  chatMessagesData = [];
  await window.mdviewer?.saveChatSessions?.({ activeSessionId: null });
  await window.mdviewer?.saveChatMessages?.([]);
  renderChatMessages();
  renderChatSessionsMenu();
  updateChatPlaceholder();
  chatInput?.focus();
}

async function loadSession(sessionId) {
  await saveCurrentAsSession();
  const session = chatSessions.find((s) => s.id === sessionId);
  if (!session) return;
  activeSessionId = sessionId;
  chatMessagesData = [...(session.messages || [])];
  await window.mdviewer?.saveChatSessions?.({ sessions: chatSessions, activeSessionId });
  await restoreFilesFromSession(session.openFiles || []);
  renderChatMessages();
  renderChatSessionsMenu();
  updateChatPlaceholder();
}

async function restoreFilesFromSession(paths) {
  if (!paths?.length) {
    const chatIdx = tabs.findIndex((t) => t.type === 'chat');
    if (chatIdx >= 0) activeIndex = chatIdx;
    renderTabs();
    renderActive();
    saveOpenTabs();
    return;
  }
  const nonFileTabs = tabs.filter((t) => t.type !== 'file');
  const newFileTabs = [];
  for (const { path: p } of paths) {
    if (!p) continue;
    const f = await loadFile(p);
    if (f && !newFileTabs.some((t) => t.path === f.path)) {
      newFileTabs.push({ type: 'file', ...f });
    }
  }
  tabs = [...newFileTabs, ...nonFileTabs];
  const chatIdx = tabs.findIndex((t) => t.type === 'chat');
  activeIndex = chatIdx >= 0 ? chatIdx : 0;
  dropzone.classList.add('hidden');
  viewer.style.display = 'block';
  renderTabs();
  renderActive();
  saveOpenTabs();
  updateChatPlaceholder();
}

async function deleteSession(sessionId, e) {
  e?.stopPropagation?.();
  chatSessions = chatSessions.filter((s) => s.id !== sessionId);
  if (activeSessionId === sessionId) {
    activeSessionId = null;
    chatMessagesData = [];
    await window.mdviewer?.saveChatMessages?.([]);
    renderChatMessages();
  }
  await window.mdviewer?.saveChatSessions?.({ sessions: chatSessions, activeSessionId });
  renderChatSessionsMenu();
}

function sessionHasContent(s) {
  const hasUser = (s.messages || []).some(
    (m) => m.role === 'user' && String(m.content || '').trim()
  );
  const hasFiles = (s.openFiles || []).length > 0;
  return hasUser || (hasFiles && (s.messages || []).length > 0);
}

function renderChatSessionsMenu() {
  const menu = document.getElementById('chat-sessions-menu');
  if (!menu) return;
  const displayed = chatSessions.filter(sessionHasContent);
  const items = displayed
    .slice()
    .reverse()
    .map(
      (s) =>
        `<div class="chat-session-item" data-id="${escapeHtml(s.id)}">
          <span class="chat-session-time">${escapeHtml(formatSessionTime(s.createdAt))}</span>
          <span class="chat-session-summary">${escapeHtml(s.summary || 'New chat')}</span>
          <button type="button" class="chat-session-delete" data-id="${escapeHtml(s.id)}" title="Delete">×</button>
        </div>`
    )
    .join('');
  menu.innerHTML = items || '<div class="chat-session-item" style="cursor:default;color:var(--text-muted)">No saved sessions</div>';
  menu.querySelectorAll('.chat-session-item[data-id]').forEach((el) => {
    const id = el.dataset.id;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.chat-session-delete')) return;
      menu.classList.add('hidden');
      loadSession(id);
    });
  });
  menu.querySelectorAll('.chat-session-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(btn.dataset.id, e);
    });
  });
}

async function renderMarkdownWithMermaid(html, container) {
  container.innerHTML = html;
  const mermaidBlocks = [...container.querySelectorAll('pre code.language-mermaid, pre code[class*="mermaid"]')];
  const theme = getTheme() === 'system' ? getSystemTheme() : getTheme();
  mermaidLib.initialize({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' });
  for (let i = 0; i < mermaidBlocks.length; i++) {
    const block = mermaidBlocks[i];
    const code = block.textContent;
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid';
    try {
      const { svg } = await mermaidLib.render(`mermaid-chat-${Date.now()}-${i}`, code);
      wrapper.innerHTML = svg;
    } catch (err) {
      wrapper.innerHTML = `<pre class="mermaid-error">${escapeHtml(err.message)}</pre>`;
    }
    block.closest('pre')?.replaceWith(wrapper);
  }
}

function scrollChatToShowPromptAtTop() {
  if (!chatMessages) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const userBubbles = chatMessages.querySelectorAll('.chat-bubble.user');
      const lastUser = userBubbles[userBubbles.length - 1];
      if (lastUser) {
        const rect = lastUser.getBoundingClientRect();
        const containerRect = chatMessages.getBoundingClientRect();
        const top = chatMessages.scrollTop + (rect.top - containerRect.top);
        chatMessages.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    });
  });
}

async function renderChatMessages() {
  if (!chatMessages) return;
  if (chatMessagesData.length === 0) {
    chatMessages.innerHTML = '';
    updateChatPlaceholder();
    return;
  }
  const inner = document.createElement('div');
  inner.className = 'chat-messages-inner';
  for (const msg of chatMessagesData) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role}${msg.error ? ' error' : ''}${msg.loading ? ' loading' : ''}`;
    if (msg.role === 'user') {
      bubble.textContent = msg.content;
    } else if (msg.loading) {
      bubble.innerHTML = `<span class="chat-generating"><svg class="chat-generating-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 5.5V16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-1.5C6.5 13.5 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/><path d="M10 17v1a2 2 0 1 0 4 0v-1"/><path d="M12 6v2"/><path d="M9.5 7.5L10.5 9"/><path d="M14.5 7.5L13.5 9"/></svg><span class="chat-generating-text">Thinking</span></span>`;
    } else if (msg.error) {
      bubble.textContent = msg.error;
    } else {
      const mdWrap = document.createElement('div');
      mdWrap.className = 'markdown-body';
      const html = markedLib.parse(msg.content || '');
      mdWrap.innerHTML = html;
      bubble.appendChild(mdWrap);
      await renderMarkdownWithMermaid(mdWrap.innerHTML, mdWrap);
    }
    inner.appendChild(bubble);
  }
  chatMessages.innerHTML = '';
  chatMessages.appendChild(inner);
  updateChatPlaceholder();
}

function populateChatModelSelect() {
  if (!chatModelSelect) return;
  const enabled = getEnabledProviders();
  const optionsHtml = enabled
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(typeLabels[p.type] || p.type)} / ${escapeHtml(p.modelId || '-')}</option>`)
    .join('');
  chatModelSelect.innerHTML = optionsHtml;
  if (enabled.length && !chatModelSelect.value) {
    chatModelSelect.selectedIndex = 0;
  }
  if (chatModelMenu) {
    chatModelMenu.innerHTML = enabled
      .map((p) => `<div class="chat-model-item" data-id="${escapeHtml(p.id)}">${escapeHtml(typeLabels[p.type] || p.type)} / ${escapeHtml(p.modelId || '-')}</div>`)
      .join('');
  }
  updateModelTriggerLabel();
}

function updateModelTriggerLabel() {
  if (!chatModelTrigger || !chatModelSelect) return;
  const sel = chatModelSelect.options[chatModelSelect.selectedIndex];
  chatModelTrigger.textContent = sel ? sel.textContent : 'Select model';
}

function autoResizeTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

async function renderChatTab() {
  await loadChatMessages();
  await renderChatMessages();
  if (chatMessagesData.length > 0) {
    requestAnimationFrame(() => {
      chatMessages?.scrollTo?.({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    });
  }
  populateChatModelSelect();
  renderChatSessionsMenu();
  updateChatPlaceholder();
  chatInput.value = '';
  autoResizeTextarea(chatInput);
  chatInput.focus();
}

const ERROR_LIKE_CONTENT = /^(fetch failed|request failed|unknown error|network error|connection refused|econnrefused)$/i;
function getSelectedProvider() {
  const providerId = chatModelSelect?.value;
  return aiProviders.find((p) => p.id === providerId) || null;
}

function sanitizeMessagesForApi(messages) {
  let out = (messages || [])
    .filter((m) => !m.loading && !m.error)
    .map((m) => ({ role: m.role, content: (m.content || '').trim() }))
    .filter((m) => m.content && !ERROR_LIKE_CONTENT.test(m.content));
  out = out.filter((m, i) => {
    if (m.role !== 'user') return true;
    const next = out[i + 1];
    return !next || next.role !== 'user' || next.content !== m.content;
  });
  return out;
}

function buildStructuredSessionMemory(messages) {
  const source = sanitizeMessagesForApi(messages);
  if (!source.length) return null;
  const users = source.filter((m) => m.role === 'user').map((m) => m.content);
  const assistants = source.filter((m) => m.role === 'assistant').map((m) => m.content);
  const pick = (arr, max = 3) => arr.filter(Boolean).slice(-max).map((s) => (s.length > 180 ? `${s.slice(0, 177)}...` : s));
  const facts = pick(users, 2);
  const openThreads = pick(users.slice(-5), 3);
  const decisions = pick(assistants, 2);
  if (!facts.length && !openThreads.length && !decisions.length) return null;
  return { facts, decisions, openThreads };
}

function mergeSessionMemory(a, b) {
  const merge = (x, y) => [...new Set([...(x || []), ...(y || [])])].slice(-6);
  if (!a && !b) return null;
  return {
    facts: merge(a?.facts, b?.facts),
    decisions: merge(a?.decisions, b?.decisions),
    openThreads: merge(a?.openThreads, b?.openThreads),
  };
}

function formatSessionMemory(memory) {
  if (!memory) return '';
  const lines = ['Conversation memory:'];
  if (memory.facts?.length) lines.push(`Facts: ${memory.facts.join(' | ')}`);
  if (memory.decisions?.length) lines.push(`Decisions: ${memory.decisions.join(' | ')}`);
  if (memory.openThreads?.length) lines.push(`Open threads: ${memory.openThreads.join(' | ')}`);
  return lines.join('\n');
}

function buildMessagesForApi(provider) {
  const source = sanitizeMessagesForApi(chatMessagesData);
  if (!source.length) return source;

  const effectiveContext = getProviderEffectiveContextLength(provider);
  const reservedOutput = getProviderReservedOutputTokens(provider);
  const inputBudget = Math.max(512, effectiveContext - reservedOutput - INPUT_SAFETY_MARGIN_TOKENS);
  const messageBudget = Math.max(384, Math.floor(inputBudget * 0.55));

  const latestUserIndex = (() => {
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].role === 'user') return i;
    }
    return -1;
  })();
  if (latestUserIndex < 0) return source.slice(-MAX_RECENT_MESSAGES);

  const selected = [];
  const selectedIndexes = new Set();
  let usedTokens = 0;
  const addWithBudget = (idx, force = false) => {
    if (idx < 0 || idx >= source.length || selectedIndexes.has(idx)) return false;
    const item = source[idx];
    const content = item.content;
    const tokenCost = estimateTokens(content) + 8;
    if (!force && usedTokens + tokenCost > messageBudget) return false;
    selected.unshift({ role: item.role, content });
    selectedIndexes.add(idx);
    usedTokens += tokenCost;
    return true;
  };

  addWithBudget(latestUserIndex, true);

  for (let i = source.length - 1; i >= 0; i--) {
    if (i === latestUserIndex) continue;
    if (selected.length >= MAX_RECENT_MESSAGES) break;
    addWithBudget(i, false);
  }

  const dropped = source.filter((_, idx) => !selectedIndexes.has(idx));
  const session = activeSessionId ? chatSessions.find((s) => s.id === activeSessionId) : null;
  const memory = mergeSessionMemory(session?.memory || null, buildStructuredSessionMemory(dropped));
  const memoryText = formatSessionMemory(memory);
  if (memoryText) {
    const memoryCost = estimateTokens(memoryText) + 8;
    if (usedTokens + memoryCost <= messageBudget) {
      selected.unshift({ role: 'assistant', content: memoryText });
    }
  }
  return selected;
}

function truncateDocumentContent(text, maxChars) {
  const raw = String(text || '');
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n\n... [truncated]`;
}

function buildContextDocumentsForApi(provider) {
  const fileTabs = tabs.filter((t) => t.type === 'file' && t.path && t.content);
  if (!fileTabs.length) return [];
  const activeTab = tabs[activeIndex];
  const activePath = activeTab?.type === 'file' ? activeTab.path : null;
  const prioritized = activePath
    ? [
        ...fileTabs.filter((t) => t.path === activePath),
        ...fileTabs.filter((t) => t.path !== activePath),
      ]
    : fileTabs;

  const effectiveContext = getProviderEffectiveContextLength(provider);
  const reservedOutput = getProviderReservedOutputTokens(provider);
  const inputBudget = Math.max(512, effectiveContext - reservedOutput - INPUT_SAFETY_MARGIN_TOKENS);
  const docBudget = Math.max(256, Math.floor(inputBudget * 0.4));
  let used = 0;
  const docs = [];
  for (const tab of prioritized) {
    if (docs.length >= MAX_DOCS_FOR_CONTEXT) break;
    const content = truncateDocumentContent(tab.content, MAX_DOC_CHARS);
    const cost = estimateTokens(content) + 12;
    if (docs.length > 0 && used + cost > docBudget) break;
    docs.push({ path: tab.path, content });
    used += cost;
  }
  return docs;
}

let chatSending = false;
let streamChunkHandler = null;
let streamDoneHandler = null;

window.mdviewer?.onChatStreamChunk?.(chunk => {
  if (streamChunkHandler) streamChunkHandler(chunk);
});
window.mdviewer?.onChatStreamDone?.(result => {
  if (streamDoneHandler) {
    streamDoneHandler(result);
    streamChunkHandler = null;
    streamDoneHandler = null;
  }
});

const STREAM_FLUSH_THRESHOLD = 32;
let streamFlushRAF = null;
let streamPendingChars = 0;

function closeOpenCodeFences(md) {
  const matches = md.match(/^(`{3,})/gm);
  if (matches && matches.length % 2 !== 0) {
    return md + '\n' + matches[matches.length - 1];
  }
  return md;
}

function flushStreamToDOM() {
  if (!chatMessages) return;
  const inner = chatMessages.querySelector('.chat-messages-inner');
  const lastBubble = inner?.querySelector('.chat-bubble:last-child');
  if (!lastBubble) return;
  const lastMsg = chatMessagesData[chatMessagesData.length - 1];
  if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.error) return;
  const text = lastMsg.content || '';
  if (lastBubble.classList.contains('loading')) {
    lastBubble.classList.remove('loading');
    lastBubble.classList.add('assistant');
  }
  let mdWrap = lastBubble.querySelector('.markdown-body');
  if (!mdWrap) {
    lastBubble.innerHTML = '';
    mdWrap = document.createElement('div');
    mdWrap.className = 'markdown-body';
    lastBubble.appendChild(mdWrap);
  }
  const safeMd = closeOpenCodeFences(text);
  mdWrap.innerHTML = markedLib.parse(safeMd);
  let indicator = lastBubble.querySelector('.chat-generating');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'chat-generating chat-generating-block';
    indicator.innerHTML = `<svg class="chat-generating-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 5.5V16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-1.5C6.5 13.5 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 21h6"/><path d="M10 17v1a2 2 0 1 0 4 0v-1"/><path d="M12 6v2"/><path d="M9.5 7.5L10.5 9"/><path d="M14.5 7.5L13.5 9"/></svg><span class="chat-generating-text">Generating ...</span>`;
    lastBubble.appendChild(indicator);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function scheduleStreamFlush(force) {
  if (!force && streamPendingChars < STREAM_FLUSH_THRESHOLD) return;
  streamPendingChars = 0;
  if (streamFlushRAF) cancelAnimationFrame(streamFlushRAF);
  streamFlushRAF = requestAnimationFrame(() => {
    streamFlushRAF = null;
    flushStreamToDOM();
  });
}

async function sendChatMessage() {
  const text = chatInput?.value?.trim();
  if (!text || chatSending) return;
  const providerId = chatModelSelect?.value;
  if (!providerId) return;
  const provider = getSelectedProvider();
  if (!provider) return;
  chatSending = true;
  chatSendBtn.disabled = true;
  chatMessagesData.push({ role: 'user', content: text });
  chatInput.value = '';
  autoResizeTextarea(chatInput);
  await renderChatMessages();
  scrollChatToShowPromptAtTop();
  const loadingMsg = { role: 'assistant', content: '', loading: true };
  chatMessagesData.push(loadingMsg);
  await renderChatMessages();
  scrollChatToShowPromptAtTop();
  const contextDocuments = buildContextDocumentsForApi(provider);
  const messages = buildMessagesForApi(provider);
  const contextWindow = {
    maxContextLength: toInt(provider.maxContextLength),
    loadedContextLength: toInt(provider.loadedContextLength),
    effectiveContextLength: getProviderEffectiveContextLength(provider),
    maxOutputTokens: getProviderReservedOutputTokens(provider),
  };

  async function runNonStreaming() {
    try {
      const res = await window.mdviewer?.chatCompletion?.({
        providerId,
        messages,
        contextDocuments,
        contextWindow,
      });
      chatMessagesData.pop();
      if (res?.error) {
        chatMessagesData.push({ role: 'assistant', content: '', error: res.error });
      } else {
        chatMessagesData.push({ role: 'assistant', content: res.content || '' });
      }
      await saveChatMessages();
    } catch (err) {
      chatMessagesData.pop();
      chatMessagesData.push({ role: 'assistant', content: '', error: err?.message || 'Unknown error' });
    }
    chatSending = false;
    chatSendBtn.disabled = false;
    await renderChatMessages();
    scrollChatToShowPromptAtTop();
  }

  let accumulated = '';
  let streamHandled = false;
  streamPendingChars = 0;
  streamChunkHandler = (chunk) => {
    accumulated += chunk;
    streamPendingChars += chunk.length;
    const lastMsg = chatMessagesData[chatMessagesData.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = accumulated;
      lastMsg.loading = false;
      scheduleStreamFlush(false);
    }
  };
  streamDoneHandler = async (result) => {
    streamHandled = true;
    if (streamFlushRAF) { cancelAnimationFrame(streamFlushRAF); streamFlushRAF = null; }
    streamPendingChars = 0;
    const lastMsg = chatMessagesData[chatMessagesData.length - 1];
    if (result?.error) {
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content = '';
        lastMsg.error = result.error;
        lastMsg.loading = false;
      } else {
        chatMessagesData.push({ role: 'assistant', content: '', error: result.error });
      }
    } else if (lastMsg && lastMsg.role === 'assistant') {
      lastMsg.content = accumulated || '';
      lastMsg.loading = false;
      delete lastMsg.error;
    }
    await saveChatMessages();
    chatSending = false;
    chatSendBtn.disabled = false;
    await renderChatMessages();
    scrollChatToShowPromptAtTop();
  };

  try {
    const res = await window.mdviewer?.chatCompletionStream?.({
      providerId,
      messages,
      contextDocuments,
      contextWindow,
    });
    if (res?.error && !streamHandled) {
      streamChunkHandler = null;
      streamDoneHandler = null;
      await runNonStreaming();
    }
  } catch (_) {
    if (!streamHandled) {
      streamChunkHandler = null;
      streamDoneHandler = null;
      await runNonStreaming();
    }
  }
}

function initChatTab() {
  document.getElementById('chat-new-btn')?.addEventListener('click', createNewSession);
  const sessionsTrigger = document.getElementById('chat-sessions-trigger');
  const sessionsMenu = document.getElementById('chat-sessions-menu');
  if (sessionsTrigger && sessionsMenu) {
    sessionsTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      chatModelMenu?.classList.add('hidden');
      sessionsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => sessionsMenu.classList.add('hidden'));
    sessionsMenu.addEventListener('click', (e) => e.stopPropagation());
  }
  if (chatModelTrigger && chatModelMenu) {
    chatModelTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionsMenu?.classList.add('hidden');
      chatModelMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => chatModelMenu.classList.add('hidden'));
    chatModelMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = e.target.closest('.chat-model-item[data-id]');
      if (item) {
        const id = item.dataset.id;
        if (chatModelSelect) {
          const opt = [...chatModelSelect.options].find((o) => o.value === id);
          if (opt) {
            chatModelSelect.value = id;
            updateModelTriggerLabel();
          }
        }
        chatModelMenu.classList.add('hidden');
      }
    });
  }
  chatInput?.addEventListener('input', () => autoResizeTextarea(chatInput));
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  chatSendBtn?.addEventListener('click', () => sendChatMessage());
}

// Init
initTheme();
initAiSettings();
initChatTab();
document.getElementById('talk-to-doc-btn')?.addEventListener('click', openChatTab);
updateTalkToDocButton();
restoreOpenTabs();
