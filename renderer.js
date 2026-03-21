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
const content = document.querySelector('.content');

const SETTINGS_TAB = { type: 'settings', name: 'Settings' };

let tabs = [];
let activeIndex = 0;
let searchCurrentIndex = 0;

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
  if (tab.type === 'settings') {
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.remove('hidden');
    return;
  }
  viewerMarkdown?.classList.remove('hidden');
  viewerSettings?.classList.add('hidden');
  currentFilePath = tab.path;
  parseAndRender(tab.content, tab.path);
  applySearchHighlights(searchInput?.value?.trim() || '');
  viewerMarkdown?.scrollTo?.(0, 0);
}

function applySearchHighlights(term) {
  searchCurrentIndex = 0;
  markdownEl.querySelectorAll('.search-highlight').forEach((el) => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
  if (!term) return;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escapeRe(term), 'gi');
  const walker = document.createTreeWalker(markdownEl, NodeFilter.SHOW_TEXT, null, false);
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
  const highlights = markdownEl.querySelectorAll('.search-highlight');
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

// Menu handlers
window.mdviewer?.onOpenFile?.((path) => openFiles([path]));
window.mdviewer?.onOpenFiles?.((paths) => openFiles(paths));
window.mdviewer?.onOpenFolder?.(openFolder);

function showExternalUrl(url) {
  viewerMarkdown?.classList.add('hidden');
  viewerFrame?.classList.remove('hidden');
  backBtn?.classList.remove('hidden');
  externalFrame?.setAttribute('src', url);
}

function hideExternalUrl() {
  viewerMarkdown?.classList.remove('hidden');
  viewerFrame?.classList.add('hidden');
  backBtn?.classList.add('hidden');
  externalFrame?.removeAttribute('src');
}

backBtn?.addEventListener('click', hideExternalUrl);

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

// Init
initTheme();
