const hljsLib = window.hljs;
const { Marked } = window.marked;
const { markedHighlight } = window.markedHighlight;
const markedKatexExt = window.markedKatex;

const markedLib = {
  parse: (md) => {
    const parser = new Marked(
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
    );
    if (typeof markedKatexExt === 'function') {
      parser.use(markedKatexExt({ throwOnError: false, strict: 'ignore', nonStandard: true }));
    }
    return parser.parse(md);
  },
};
const mermaidLib = window.mermaid;
const katexRenderMath = window.renderMathInElement;

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
const importProgressModal = document.getElementById('import-progress-modal');
const importProgressTitle = document.getElementById('import-progress-title');
const importProgressSubtitle = document.getElementById('import-progress-subtitle');
const importProgressBar = document.getElementById('import-progress-bar');
const importProgressMeta = document.getElementById('import-progress-meta');
const kbDocControl = document.getElementById('kb-doc-control');
const kbAddBtn = document.getElementById('kb-add-btn');
const kbInsideBadge = document.getElementById('kb-inside-badge');
const kbRemoveBtn = document.getElementById('kb-remove-btn');
const kbSettingsList = document.getElementById('kb-settings-list');
const kbHelpBtn = document.getElementById('kb-help-btn');
const kbImportFileBtn = document.getElementById('kb-import-file-btn');
const kbImportFolderBtn = document.getElementById('kb-import-folder-btn');
const kbClearAllBtn = document.getElementById('kb-clear-all-btn');

const SETTINGS_TAB = { type: 'settings', name: 'Settings' };
const CHAT_TAB = { type: 'chat', name: 'Talk to your docs' };
const KB_HELP_TAB = { type: 'kbHelp', name: 'Help - knowledgebase' };
const KB_HELP_CONTENT = `# Help - knowledgebase

This guide explains how to configure models so Knowledgebase retrieval works reliably.

## 1) Minimum setup

- Add at least one chat model in Settings -> Models.
- Run LM Studio local server (default base URL: \`http://127.0.0.1:1234\`).
- Ensure an embedding model is available in LM Studio for indexing/search.

## 2) Recommended local setup (LM Studio)

1. Open LM Studio and start the local server.
2. Load an LLM model for chat responses.
3. Load an embedding model (recommended: \`nomic-embed-text-v1.5\`).
4. In MD Viewer, add LM Studio model in Settings -> Models.
5. Import docs into Knowledgebase using Import file/folder.

## 3) Commercial LLMs

- OpenAI / Claude / Google models can be used for chat generation.
- Knowledgebase indexing/retrieval still uses local embeddings path.
- Add model, enter API key, click Check, then pick available model.

## 4) Troubleshooting

- If import fails: verify LM Studio is running and embedding model is loaded.
- If answers miss context: check docs are indexed in Knowledgebase list.
- If runtime errors in LM Studio: install correct runtime for your model format.
`;

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
let activePdfImportPath = '';
const DEBUG_LLM_RAW_MARKDOWN = true;
let activeDocKbState = null;
let pendingKbReferenceFocus = null;
let kbImportProgressState = null;

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
  collapseAllSettingsGroups();
  themeSelect.value = getTheme();
  setDefaultResult && (setDefaultResult.textContent = '');
  setDefaultResult && (setDefaultResult.className = 'settings-result');
  renderTabs();
  renderActive();
  saveOpenTabs();
}

function collapseAllSettingsGroups() {
  document.querySelectorAll('.settings-main-group').forEach((group) => {
    group.classList.add('collapsed');
  });
}

function initSettingsGroups() {
  document.querySelectorAll('.settings-main-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const group = btn.closest('.settings-main-group');
      if (!group) return;
      group.classList.toggle('collapsed');
    });
  });
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
  if (action === 'addToKnowledgebase') {
    if (index === activeIndex) addActiveDocumentToKnowledgebase();
    else {
      activeIndex = index;
      renderTabs();
      renderActive();
      addActiveDocumentToKnowledgebase();
    }
  } else if (action === 'close') {
    closeTab(index);
  } else if (action === 'closeOthers') {
    tabs = [tabs[index]];
    activeIndex = 0;
    renderTabs();
    renderActive();
    saveOpenTabs();
  } else if (action === 'closeAll') {
    tabs = [];
    activeIndex = 0;
    hideKbDocControl();
    dropzone.classList.remove('hidden');
    viewer.style.display = 'none';
    renderTabs();
    saveOpenTabs();
  }
});

kbAddBtn?.addEventListener('click', addActiveDocumentToKnowledgebase);
kbRemoveBtn?.addEventListener('click', removeActiveDocumentFromKnowledgebase);

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

function normalizeMathMarkdown(md) {
  let out = String(md || '');
  const looksLikeMath = (s) =>
    /\\[a-zA-Z]+|_[{(]|\^[{(]|\\frac|\\text|\\times|\\approx|\\mathbf|\\Bigl|\\Bigr/.test(String(s || ''));

  // Preserve LaTeX delimiters through marked by converting \( \) and \[ \] into $ and $$.
  out = out.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, expr) => `$$\n${String(expr || '').trim()}\n$$`);
  out = out.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, expr) => `$${String(expr || '').trim()}$`);

  // Common OCR/LLM artifact: ;\cmd; -> \cmd
  out = out.replace(/;\s*\\([a-zA-Z]+)\s*;/g, '\\$1');
  // Common OCR/LLM artifact around operators: ;=; ;+; ;-; ;\times;
  out = out.replace(/[;；]\s*([=+\-*/])\s*[;；]/g, ' $1 ');
  out = out.replace(/[;；]\s*\\times\s*[;；]/g, ' \\times ');
  // Common OCR artifact in currency values inside formulas: €,12.00 -> €12.00
  out = out.replace(/€,(\d)/g, '€$1');

  // Robust conversion for raw [ ... ] math blocks (single-line and multi-line).
  // IMPORTANT: do NOT touch escaped LaTeX blocks \[ ... \] (already valid).
  const convertBracketMathBlocks = (input) => {
    let result = '';
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (ch !== '[') {
        result += ch;
        i += 1;
        continue;
      }
      if (i > 0 && input[i - 1] === '\\') {
        result += ch;
        i += 1;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      while (j < input.length && depth > 0) {
        if (input[j] === '[' && input[j - 1] !== '\\') depth += 1;
        else if (input[j] === ']' && input[j - 1] !== '\\') depth -= 1;
        j += 1;
      }
      if (depth !== 0) {
        result += ch;
        i += 1;
        continue;
      }
      const inner = input.slice(i + 1, j - 1);
      if (!looksLikeMath(inner)) {
        result += `[${inner}]`;
        i = j;
        continue;
      }
      const compact = inner
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      const display = /[\n\r]/.test(inner) || compact.length > 80;
      result += display ? `$$\n${compact}\n$$` : `$${compact}$`;
      i = j;
    }
    return result;
  };

  out = convertBracketMathBlocks(out);
  return out;
}

function renderMathInContainer(container) {
  if (!container || typeof katexRenderMath !== 'function') return;
  try {
    katexRenderMath(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
      strict: 'ignore',
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    });
  } catch (_) {}
}

function clearChunkHighlights() {
  markdownEl?.querySelectorAll('.chunk-highlight').forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
  markdownEl?.querySelectorAll('.chunk-focus-block').forEach((el) => {
    el.classList.remove('chunk-focus-block');
  });
}

function applyChunkHighlights(term) {
  clearChunkHighlights();
  const raw = String(term || '').trim();
  if (!raw || !markdownEl) return false;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escapeRe(raw), 'gi');
  const walker = document.createTreeWalker(markdownEl, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  let hitCount = 0;

  textNodes.forEach((node) => {
    const text = node.textContent;
    const matches = [...text.matchAll(re)];
    if (!matches.length) return;
    const frag = document.createDocumentFragment();
    let lastEnd = 0;
    for (const m of matches) {
      frag.appendChild(document.createTextNode(text.slice(lastEnd, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'chunk-highlight';
      mark.textContent = m[0];
      frag.appendChild(mark);
      hitCount += 1;
      lastEnd = m.index + m[0].length;
    }
    frag.appendChild(document.createTextNode(text.slice(lastEnd)));
    node.parentNode.replaceChild(frag, node);
  });
  return hitCount > 0;
}

function findChunkFocusBlock(anchor) {
  const normalizedAnchor = String(anchor || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalizedAnchor || !markdownEl) return null;
  const blocks = markdownEl.querySelectorAll('p, li, pre, blockquote, table, h1, h2, h3, h4, h5, h6');
  let best = null;
  let bestScore = -1;
  blocks.forEach((node) => {
    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return;
    if (text.includes(normalizedAnchor)) {
      const score = normalizedAnchor.length;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
      return;
    }
    if (normalizedAnchor.includes(text) && text.length > 30) {
      const score = text.length - 10;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
  });
  return best;
}

function focusChunkAnchor(anchor) {
  const clean = String(anchor || '').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  clearChunkHighlights();
  const block = findChunkFocusBlock(clean);
  if (block) {
    block.classList.add('chunk-focus-block');
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }
  const candidates = [];
  candidates.push(clean.slice(0, Math.min(160, clean.length)));
  const words = clean.split(' ').filter(Boolean);
  if (words.length >= 10) candidates.push(words.slice(0, 10).join(' '));
  if (words.length >= 6) candidates.push(words.slice(0, 6).join(' '));
  let found = false;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (applyChunkHighlights(candidate)) {
      found = true;
      break;
    }
  }
  if (!found) {
    clearChunkHighlights();
    return false;
  }
  const first = markdownEl.querySelector('.chunk-highlight');
  first?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return true;
}

async function openKbReferenceTarget(path, anchor) {
  const targetPath = String(path || '').trim();
  if (!targetPath) return;
  pendingKbReferenceFocus = { path: targetPath, anchor: String(anchor || '') };
  const f = await loadFile(targetPath);
  if (!f) return;
  tabs.push({ type: 'file', ...f });
  activeIndex = tabs.length - 1;
  dropzone.classList.add('hidden');
  viewer.style.display = 'block';
  renderTabs();
  renderActive();
  saveOpenTabs();
}

function openKnowledgebaseHelpTab() {
  const idx = tabs.findIndex((t) => t.type === 'kbHelp');
  if (idx >= 0) {
    activeIndex = idx;
    renderTabs();
    renderActive();
    return;
  }
  tabs.push({
    ...KB_HELP_TAB,
    content: KB_HELP_CONTENT,
    path: null,
  });
  activeIndex = tabs.length - 1;
  dropzone.classList.add('hidden');
  viewer.style.display = 'block';
  renderTabs();
  renderActive();
}

function hideKbDocControl() {
  kbDocControl?.classList.add('hidden');
  kbInsideBadge?.classList.add('hidden');
  if (kbAddBtn) kbAddBtn.style.display = 'none';
  activeDocKbState = null;
}

function renderKbDocControlState(status) {
  if (!kbDocControl || !kbAddBtn || !kbInsideBadge) return;
  const isInKb = Boolean(status?.inKnowledgebase);
  const staleByPath = Boolean(status?.staleByPath);
  kbDocControl.classList.remove('hidden');
  kbAddBtn.style.display = isInKb ? 'none' : 'inline-flex';
  kbAddBtn.textContent = staleByPath ? 'Re-index in knowledgebase' : 'Add to knowledgebase';
  kbInsideBadge.classList.toggle('hidden', !isInKb);
}

async function refreshActiveDocumentKbState() {
  const tab = tabs[activeIndex];
  if (!tab || tab.type !== 'file') {
    hideKbDocControl();
    return;
  }
  try {
    const status = await window.mdviewer?.kbGetDocumentStatus?.({
      path: tab.path,
      content: tab.content || '',
    });
    activeDocKbState = {
      docFingerprint: status?.docFingerprint || null,
      inKnowledgebase: Boolean(status?.inKnowledgebase),
      staleByPath: Boolean(status?.staleByPath),
      staleFingerprints: status?.staleFingerprints || [],
      path: tab.path,
      content: tab.content || '',
    };
    renderKbDocControlState(activeDocKbState);
  } catch (_) {
    hideKbDocControl();
  }
}

async function addActiveDocumentToKnowledgebase() {
  const tab = tabs[activeIndex];
  if (!tab || tab.type !== 'file') return;
  kbAddBtn.disabled = true;
  try {
    const res = await window.mdviewer?.kbAddDocument?.({
      path: tab.path,
      content: tab.content || '',
      replacePathVersions: Boolean(activeDocKbState?.staleByPath),
    });
    if (!res?.ok) throw new Error(res?.error || 'Failed to add document to knowledgebase');
    await refreshActiveDocumentKbState();
    await renderKnowledgebaseSettingsList();
  } catch (err) {
    alert(err?.message || 'Failed to add document to knowledgebase');
  } finally {
    kbAddBtn.disabled = false;
  }
}

async function removeActiveDocumentFromKnowledgebase() {
  if (!activeDocKbState?.docFingerprint) return;
  const confirmed = window.confirm('Delete this document and all its chunks from the knowledgebase?');
  if (!confirmed) return;
  kbRemoveBtn.disabled = true;
  try {
    const res = await window.mdviewer?.kbDeleteDocument?.({
      docFingerprint: activeDocKbState.docFingerprint,
    });
    if (!res?.ok) throw new Error(res?.error || 'Failed to delete from knowledgebase');
    await refreshActiveDocumentKbState();
    await renderKnowledgebaseSettingsList();
  } catch (err) {
    alert(err?.message || 'Failed to delete from knowledgebase');
  } finally {
    kbRemoveBtn.disabled = false;
  }
}

function setupLinkHandler() {
  viewer.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = (a.getAttribute('href') || '').trim();
    if (!href) return;

    if (/^kbref:\/\//i.test(href)) {
      e.preventDefault();
      try {
        const parsed = new URL(href);
        const refPath = parsed.searchParams.get('path') || '';
        const anchor = parsed.searchParams.get('anchor') || '';
        openKbReferenceTarget(refPath, anchor);
      } catch (_) {}
      return;
    }

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
  const mathNormalized = normalizeMathMarkdown(md);
  let processed = mathNormalized.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
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
  renderMathInContainer(markdownEl);
}

function renderActive() {
  if (tabs.length === 0) return;
  const tab = tabs[activeIndex];
  hideExternalUrl();
  viewerChat?.classList.add('hidden');
  if (tab.type === 'settings') {
    hideKbDocControl();
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.remove('hidden');
    renderAiSettings();
    renderKnowledgebaseSettingsList();
    return;
  }
  if (tab.type === 'chat') {
    hideKbDocControl();
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.add('hidden');
    viewerChat?.classList.remove('hidden');
    renderChatTab();
    return;
  }
  if (tab.type === 'kbHelp') {
    hideKbDocControl();
    viewerMarkdown?.classList.remove('hidden');
    viewerSettings?.classList.add('hidden');
    currentFilePath = null;
    parseAndRender(tab.content || '', null);
    viewerMarkdown?.scrollTo?.(0, 0);
    return;
  }
  viewerMarkdown?.classList.remove('hidden');
  viewerSettings?.classList.add('hidden');
  currentFilePath = tab.path;
  parseAndRender(tab.content, tab.path)
    .then(() => {
      if (pendingKbReferenceFocus && pendingKbReferenceFocus.path === tab.path) {
        focusChunkAnchor(pendingKbReferenceFocus.anchor);
        pendingKbReferenceFocus = null;
      }
    })
    .catch(() => {});
  refreshActiveDocumentKbState();
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

function collectPdfPaths(paths) {
  const result = [];
  for (const p of paths || []) {
    if (/\.pdf$/i.test(String(p || '').trim())) result.push(p);
  }
  return [...new Set(result)];
}

async function importDroppedPdfs(paths) {
  for (const pdfPath of paths || []) {
    try {
      await window.mdviewer?.importPdf?.(pdfPath);
    } catch (err) {
      console.error(err);
    }
  }
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
    const mdPaths = await collectMdPaths(raw);
    const pdfPaths = collectPdfPaths(raw);
    if (mdPaths.length) await openFiles(mdPaths);
    if (pdfPaths.length) await importDroppedPdfs(pdfPaths);
  });
}

function getFileNameFromPath(filePath) {
  const safe = String(filePath || '').trim();
  if (!safe) return 'PDF';
  const parts = safe.split(/[/\\]/);
  return parts[parts.length - 1] || 'PDF';
}

function showImportProgress(payload = {}) {
  if (!importProgressModal || !importProgressBar) return;
  const sourceFilePath = payload.filePath || activePdfImportPath || '';
  if (sourceFilePath) activePdfImportPath = sourceFilePath;
  const sourceName = getFileNameFromPath(sourceFilePath);
  const current = Number(payload.current);
  const total = Number(payload.total);
  const hasDeterminate = Number.isFinite(total) && total > 0 && Number.isFinite(current) && current >= 0;
  const percent = hasDeterminate ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;

  importProgressModal.classList.remove('hidden');
  if (importProgressTitle) importProgressTitle.textContent = 'Importing PDF...';
  if (importProgressSubtitle) importProgressSubtitle.textContent = sourceName;
  if (importProgressMeta) {
    if (hasDeterminate) importProgressMeta.textContent = `Processing page ${Math.min(total, Math.max(0, current))} of ${total}`;
    else importProgressMeta.textContent = 'Analyzing pages...';
  }
  if (hasDeterminate) {
    importProgressBar.classList.remove('indeterminate');
    importProgressBar.style.width = `${percent}%`;
  } else {
    importProgressBar.style.width = '35%';
    importProgressBar.classList.add('indeterminate');
  }
}

function hideImportProgress() {
  if (!importProgressModal || !importProgressBar) return;
  importProgressModal.classList.add('hidden');
  importProgressBar.classList.add('indeterminate');
  importProgressBar.style.width = '35%';
  if (importProgressMeta) importProgressMeta.textContent = '';
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
window.mdviewer?.onPdfImportProgress?.((payload) => {
  showImportProgress(payload);
});
window.mdviewer?.onPdfImportDone?.(() => {
  hideImportProgress();
});

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

async function openChatTab() {
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
  hideExternalUrl();
  hideKbDocControl();
  viewerMarkdown?.classList.add('hidden');
  viewerSettings?.classList.add('hidden');
  viewerChat?.classList.remove('hidden');
  await renderChatTab();
  await createNewSession();
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
const aiAddForm = document.getElementById('ai-add-model-form');
const aiAddType = document.getElementById('ai-add-type');
const aiAddModelId = document.getElementById('ai-add-model-id');
const aiAddSave = document.getElementById('ai-add-save');
const aiAddCancel = document.getElementById('ai-add-cancel');
const aiAddApiKey = document.getElementById('ai-add-api-key');
const aiAddCheck = document.getElementById('ai-add-check');
const aiAddCheckHint = document.getElementById('ai-add-check-hint');
const aiAddApiKeyWrap = document.getElementById('ai-add-api-key-wrap');
const aiAddLmstudioUrl = document.getElementById('ai-add-lmstudio-url');
const aiAddLmstudioLamp = document.getElementById('ai-add-lmstudio-lamp');
const aiAddLmstudioCheckCustom = document.getElementById('ai-add-lmstudio-check-custom');
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
          <span class="ai-model-name">${escapeHtml(typeLabels[p.type] || p.type)} / ${escapeHtml(p.modelId || '-')}${p.type === 'lmstudio' ? ` <span class="kb-item-embed-label">(embeddings: ${escapeHtml(p.embeddingModel || 'MiniLM fallback')})</span>` : ''}</span>
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

async function renderAiSettings() {
  const config = await window.mdviewer?.getAiConfig?.();
  aiProviders = (config?.aiProviders || []).map((p) => ({ ...p, enabled: p.enabled !== false }));
  aiApiKeys = config?.aiApiKeys || {};
  renderAiModelsList();
  updateTalkToDocButton();
}

async function renderKnowledgebaseSettingsList() {
  if (!kbSettingsList) return;
  const res = await window.mdviewer?.kbListDocuments?.();
  const docs = res?.documents || [];
  const transient = kbImportProgressState || { files: [], items: {} };
  const transientFiles = Array.isArray(transient.files) ? transient.files : [];
  const transientItems = transient.items || {};
  const docPaths = new Set(docs.map((d) => String(d.path || '').trim()).filter(Boolean));
  const placeholderPaths = transientFiles.filter((p) => {
    const key = String(p || '').trim();
    return key && !docPaths.has(key);
  });

  if (!docs.length && !placeholderPaths.length) {
    kbSettingsList.innerHTML = '<div class="kb-settings-empty">No indexed documents yet.</div>';
    return;
  }

  const backendLabel = (doc) => {
    const key = String(doc?.embeddingBackend || '').toLowerCase();
    if (key === 'lmstudio') return 'LM Studio';
    if (key === 'openai') return 'OpenAI';
    if (key === 'minilm') return 'MiniLM';
    return doc?.embeddingBackendLabel || 'Unknown';
  };
  const embedLabel = (doc) => {
    if (!doc?.embeddingModel) return '';
    return `<span class="kb-item-embed-label">(embedded via ${escapeHtml(backendLabel(doc))} / ${escapeHtml(doc.embeddingModel)})</span>`;
  };
  const statusForPath = (p) => transientItems[String(p || '').trim()] || '';
  const statusBadge = (status) =>
    status ? `<span class="kb-import-file-status ${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>` : '';
  const docRows = docs.map((doc) => {
    const rowStatus = statusForPath(doc.path);
    return `<div class="kb-settings-item" data-fp="${escapeHtml(doc.docFingerprint)}">
      <div class="kb-settings-meta">
        <div class="kb-settings-summary">${escapeHtml(doc.summary || 'Untitled document')}${doc.stale ? ' <span class="kb-stale-badge">stale</span>' : ''} ${embedLabel(doc)}</div>
        <div class="kb-settings-path">${escapeHtml(doc.path || doc.docFingerprint)}</div>
      </div>
      <div class="kb-settings-item-actions">
        ${statusBadge(rowStatus)}
        <button type="button" class="kb-settings-delete" data-fp="${escapeHtml(doc.docFingerprint)}">Delete</button>
      </div>
    </div>`;
  });
  const placeholderRows = placeholderPaths.map((p) => {
    const status = statusForPath(p) || 'pending';
    return `<div class="kb-settings-item kb-settings-item-placeholder">
      <div class="kb-settings-meta">
        <div class="kb-settings-summary">${escapeHtml(fileNameFromPath(p))}</div>
        <div class="kb-settings-path">${escapeHtml(p)}</div>
      </div>
      <div class="kb-settings-item-actions">
        ${statusBadge(status)}
      </div>
    </div>`;
  });
  kbSettingsList.innerHTML = [...placeholderRows, ...docRows].join('');
  kbSettingsList.querySelectorAll('.kb-settings-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const fp = btn.dataset.fp;
      if (!fp) return;
      const confirmed = window.confirm('Delete this document and all its chunks from the knowledgebase?');
      if (!confirmed) return;
      btn.disabled = true;
      const deleted = await window.mdviewer?.kbDeleteDocument?.({ docFingerprint: fp });
      if (!deleted?.ok) {
        alert(deleted?.error || 'Failed to delete from knowledgebase');
      }
      await renderKnowledgebaseSettingsList();
      await refreshActiveDocumentKbState();
    });
  });
}

function summarizeKbImportResult(res) {
  const imported = Number(res?.imported) || 0;
  const skipped = Number(res?.skipped) || 0;
  const failed = Number(res?.failed) || 0;
  return `Imported: ${imported}, skipped: ${skipped}, failed: ${failed}`;
}

function fileNameFromPath(p) {
  const safe = String(p || '');
  const parts = safe.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || safe || 'unknown';
}

function statusLabel(status) {
  if (status === 'processing') return 'Loading...';
  if (status === 'imported') return 'Imported';
  if (status === 'skipped') return 'Skipped';
  if (status === 'failed') return 'Failed';
  return 'Pending';
}

function handleKbImportProgress(payload = {}) {
  const stage = payload.stage;
  if (stage === 'start') {
    kbImportProgressState = {
      files: payload.files || [],
      items: Object.fromEntries((payload.files || []).map((p) => [p, 'pending'])),
      done: false,
    };
    renderKnowledgebaseSettingsList();
    return;
  }
  if (!kbImportProgressState) return;
  if (stage === 'item' && payload.path) {
    kbImportProgressState.items[payload.path] = payload.status || 'processing';
    renderKnowledgebaseSettingsList();
    return;
  }
  if (stage === 'done') {
    kbImportProgressState.done = true;
    renderKnowledgebaseSettingsList();
  }
}

async function importKnowledgebaseFile() {
  if (!kbImportFileBtn) return;
  kbImportFileBtn.disabled = true;
  try {
    kbImportProgressState = null;
    const res = await window.mdviewer?.kbImportFileDialog?.();
    if (!res?.ok) throw new Error(res?.error || 'Import failed');
    await renderKnowledgebaseSettingsList();
    await refreshActiveDocumentKbState();
    kbImportProgressState = null;
    await renderKnowledgebaseSettingsList();
    if (!res?.cancelled) alert(summarizeKbImportResult(res));
  } catch (err) {
    alert(err?.message || 'Import failed');
  } finally {
    kbImportFileBtn.disabled = false;
  }
}

async function importKnowledgebaseFolder() {
  if (!kbImportFolderBtn) return;
  kbImportFolderBtn.disabled = true;
  try {
    kbImportProgressState = null;
    const res = await window.mdviewer?.kbImportFolderDialog?.();
    if (!res?.ok) throw new Error(res?.error || 'Import failed');
    await renderKnowledgebaseSettingsList();
    await refreshActiveDocumentKbState();
    kbImportProgressState = null;
    await renderKnowledgebaseSettingsList();
    if (!res?.cancelled) alert(summarizeKbImportResult(res));
  } catch (err) {
    alert(err?.message || 'Import failed');
  } finally {
    kbImportFolderBtn.disabled = false;
  }
}

async function clearKnowledgebaseAll() {
  if (!kbClearAllBtn) return;
  const confirmed = window.confirm('Clear entire knowledgebase? This removes all indexed documents and chunks.');
  if (!confirmed) return;
  kbClearAllBtn.disabled = true;
  try {
    const res = await window.mdviewer?.kbClearAll?.();
    if (!res?.ok) throw new Error(res?.error || 'Failed to clear knowledgebase');
    await renderKnowledgebaseSettingsList();
    await refreshActiveDocumentKbState();
  } catch (err) {
    alert(err?.message || 'Failed to clear knowledgebase');
  } finally {
    kbClearAllBtn.disabled = false;
  }
}

function initAiSettings() {
  aiModelSearch?.addEventListener('input', renderAiModelsList);
  document.getElementById('ai-add-model-btn')?.addEventListener('click', openAddForm);
  document.getElementById('ai-refresh-models')?.addEventListener('click', () => {
    renderAiSettings();
  });

  const addPlaceholders = { openai: 'e.g. gpt-4o', claude: 'e.g. claude-3-5-sonnet', google: 'e.g. gemini-1.5-flash' };
  const lmstudioWrap = document.getElementById('ai-add-lmstudio-wrap');
  const cloudWrap = document.getElementById('ai-add-cloud-wrap');
  const manualWrap = document.getElementById('ai-add-manual-wrap');
  const lmstudioSelect = document.getElementById('ai-add-lmstudio-model');
  const lmstudioEmbeddingSelect = document.getElementById('ai-add-lmstudio-embedding-model');
  const lmstudioHint = document.getElementById('ai-add-lmstudio-hint');
  const cloudSelect = document.getElementById('ai-add-cloud-model');
  const cloudHint = document.getElementById('ai-add-cloud-hint');
  const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';
  let lmStudioAutocheckTimer = null;
  const cloudKeyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  const wizardState = {
    checkedProvider: '',
    checkedModelType: '',
    verifiedApiKey: '',
    lmstudioChecked: false,
  };

  function resetWizardChecks() {
    wizardState.checkedProvider = '';
    wizardState.checkedModelType = '';
    wizardState.verifiedApiKey = '';
    wizardState.lmstudioChecked = false;
    if (aiAddCheckHint) aiAddCheckHint.textContent = '';
    if (cloudHint) cloudHint.textContent = '';
    if (lmstudioHint) lmstudioHint.textContent = '';
  }

  function normalizeLmStudioUrl(url) {
    const raw = String(url || '').trim();
    return raw || DEFAULT_LMSTUDIO_URL;
  }

  function setLmStudioLamp(state, title = '') {
    if (!aiAddLmstudioLamp) return;
    aiAddLmstudioLamp.classList.remove('ok', 'fail', 'checking');
    if (state) aiAddLmstudioLamp.classList.add(state);
    aiAddLmstudioLamp.title = title || 'LM Studio status';
  }

  function syncLmStudioCustomCheckButtonVisibility() {
    if (!aiAddLmstudioCheckCustom) return;
    const current = normalizeLmStudioUrl(aiAddLmstudioUrl?.value);
    aiAddLmstudioCheckCustom.classList.toggle('hidden', current === DEFAULT_LMSTUDIO_URL);
  }

  function updateSaveButtonState() {
    const type = aiAddType?.value;
    let enabled = false;
    if (type === 'lmstudio') {
      enabled = Boolean(wizardState.lmstudioChecked && lmstudioSelect?.value);
    } else if (['openai', 'claude', 'google'].includes(type)) {
      const checked = wizardState.checkedProvider === type && wizardState.checkedModelType === 'cloud';
      enabled = Boolean(checked && cloudSelect?.value);
    } else {
      enabled = Boolean(aiAddModelId?.value?.trim());
    }
    if (aiAddSave) aiAddSave.disabled = !enabled;
  }

  async function checkLmStudioAvailability(baseUrlOverride) {
    const baseUrl = normalizeLmStudioUrl(
      baseUrlOverride ||
      aiAddLmstudioUrl?.value ||
      aiApiKeys.lmstudio?.baseUrl ||
      aiProviders.find((p) => p.type === 'lmstudio')?.baseUrl ||
      DEFAULT_LMSTUDIO_URL
    );
    if (aiAddLmstudioUrl) aiAddLmstudioUrl.value = baseUrl;
    syncLmStudioCustomCheckButtonVisibility();
    setLmStudioLamp('checking', `Checking ${baseUrl}`);
    if (lmstudioSelect) {
      lmstudioSelect.disabled = true;
      lmstudioSelect.innerHTML = '<option value="">Loading models...</option>';
      if (lmstudioHint) lmstudioHint.textContent = '';
    }
    if (lmstudioEmbeddingSelect) {
      lmstudioEmbeddingSelect.disabled = true;
      lmstudioEmbeddingSelect.innerHTML = '<option value="">Use MiniLM fallback (default)</option>';
    }
    wizardState.lmstudioChecked = false;
    updateSaveButtonState();
    const availability = await window.mdviewer?.checkLmStudioAvailability?.(baseUrl);
    const models = availability?.llmModels || [];
    const embeddingModels = availability?.embeddingModels || [];
    const error = availability?.error;
    if (lmstudioSelect) {
      lmstudioSelect.disabled = false;
      if (error) {
        lmStudioModelMetaById = {};
        lmstudioSelect.innerHTML = '<option value="">Failed to load models</option>';
        if (lmstudioEmbeddingSelect) {
          lmstudioEmbeddingSelect.disabled = false;
          lmstudioEmbeddingSelect.innerHTML = '<option value="">Use MiniLM fallback (default)</option>';
        }
        if (lmstudioHint) lmstudioHint.textContent = error;
        setLmStudioLamp('fail', `LM Studio unreachable at ${baseUrl}`);
        updateSaveButtonState();
        return;
      }
      if (!models?.length) {
        lmStudioModelMetaById = {};
        lmstudioSelect.innerHTML = '<option value="">No chat models found</option>';
        if (lmstudioHint) {
          const rec = (availability?.recommendedChatModels || []).join(', ');
          lmstudioHint.textContent = `LM Studio connected, but no chat model loaded. Recommended: ${rec}.`;
        }
        setLmStudioLamp('ok', `LM Studio reachable at ${baseUrl}`);
        updateSaveButtonState();
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
      if (lmstudioEmbeddingSelect) {
        lmstudioEmbeddingSelect.disabled = false;
        const embedOptions = embeddingModels
          .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`)
          .join('');
        lmstudioEmbeddingSelect.innerHTML = `<option value="">Use MiniLM fallback (default)</option>${embedOptions}`;
        if (embeddingModels.length > 0) {
          lmstudioEmbeddingSelect.value = String(embeddingModels[0]?.id || '');
        } else {
          lmstudioEmbeddingSelect.value = '';
        }
      }
      if (lmstudioHint) {
        const embedText = embeddingModels.length
          ? `Embedding models: ${embeddingModels.length}.`
          : `Missing embedding model. Load one (recommended: ${(availability?.recommendedEmbeddingModels || []).join(', ')}).`;
        lmstudioHint.textContent = `Chat models: ${models.length}. ${embedText}`;
      }
      setLmStudioLamp('ok', `LM Studio reachable at ${baseUrl}`);
      wizardState.lmstudioChecked = true;
      updateSaveButtonState();
    }
  }

  async function checkCloudModels(type) {
    const apiKey = aiAddApiKey?.value?.trim() || '';
    wizardState.checkedProvider = '';
    wizardState.checkedModelType = '';
    wizardState.verifiedApiKey = '';
    if (cloudSelect) {
      cloudSelect.disabled = true;
      cloudSelect.innerHTML = '<option value="">Loading models...</option>';
      if (cloudHint) cloudHint.textContent = '';
    }
    updateSaveButtonState();
    if (aiAddCheckHint) aiAddCheckHint.textContent = '';
    if (!apiKey) {
      if (cloudSelect) {
        cloudSelect.disabled = true;
        cloudSelect.innerHTML = '<option value="">Run check first</option>';
      }
      if (aiAddCheckHint) aiAddCheckHint.textContent = 'API key is required.';
      updateSaveButtonState();
      return;
    }
    const fetchFn = {
      openai: window.mdviewer?.fetchOpenAIModels,
      claude: window.mdviewer?.fetchAnthropicModels,
      google: window.mdviewer?.fetchGoogleModels,
    }[type];
    const { models, error } = (await fetchFn?.(apiKey)) || {};
    if (cloudSelect) {
      cloudSelect.disabled = false;
      if (error) {
        cloudModelMetaById = {};
        cloudSelect.innerHTML = '<option value="">Check failed</option>';
        if (cloudHint) cloudHint.textContent = error;
        if (aiAddCheckHint) aiAddCheckHint.textContent = 'Check failed. Fix key and retry.';
        updateSaveButtonState();
        return;
      }
      if (!models?.length) {
        cloudModelMetaById = {};
        cloudSelect.innerHTML = '<option value="">No models found</option>';
        if (cloudHint) cloudHint.textContent = error || 'Check your API key.';
        if (aiAddCheckHint) aiAddCheckHint.textContent = 'API key accepted, but no usable models were returned.';
        updateSaveButtonState();
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
      wizardState.checkedProvider = type;
      wizardState.checkedModelType = 'cloud';
      wizardState.verifiedApiKey = apiKey;
      if (aiAddCheckHint) aiAddCheckHint.textContent = 'Check passed. Select a model.';
      updateSaveButtonState();
    }
  }

  function switchAddModelUI(type) {
    const isLm = type === 'lmstudio';
    const isCloud = ['openai', 'claude', 'google'].includes(type);
    lmstudioWrap?.classList.toggle('hidden', !isLm);
    cloudWrap?.classList.toggle('hidden', !isCloud);
    aiAddApiKeyWrap?.classList.toggle('hidden', !isCloud);
    manualWrap?.classList.toggle('hidden', isLm || isCloud);
    if (aiAddModelId) aiAddModelId.placeholder = addPlaceholders[type] || 'Model ID';
    resetWizardChecks();
    if (cloudSelect && isCloud) {
      cloudSelect.disabled = true;
      cloudSelect.innerHTML = '<option value="">Run check first</option>';
    }
    if (lmstudioSelect && isLm) {
      lmstudioSelect.disabled = true;
      lmstudioSelect.innerHTML = '<option value="">Run check first</option>';
    }
    if (lmstudioEmbeddingSelect && isLm) {
      lmstudioEmbeddingSelect.disabled = true;
      lmstudioEmbeddingSelect.innerHTML = '<option value="">Use MiniLM fallback (default)</option>';
    }
    if (isLm && aiAddLmstudioUrl) {
      aiAddLmstudioUrl.value = normalizeLmStudioUrl(
        aiApiKeys.lmstudio?.baseUrl ||
        aiProviders.find((p) => p.type === 'lmstudio')?.baseUrl ||
        DEFAULT_LMSTUDIO_URL
      );
      syncLmStudioCustomCheckButtonVisibility();
      setLmStudioLamp('', 'LM Studio status');
      if (normalizeLmStudioUrl(aiAddLmstudioUrl.value) === DEFAULT_LMSTUDIO_URL) {
        checkLmStudioAvailability(aiAddLmstudioUrl.value);
      }
    }
    if (aiAddApiKey) {
      const keySlot = cloudKeyMap[type];
      aiAddApiKey.value = keySlot ? (aiApiKeys[keySlot]?.apiKey || '') : '';
    }
    updateSaveButtonState();
  }

  function openAddForm() {
    aiAddForm?.classList.remove('hidden');
    aiAddType.value = 'lmstudio';
    aiAddModelId.value = '';
    switchAddModelUI('lmstudio');
    updateSaveButtonState();
  }
  aiAddType?.addEventListener('change', () => switchAddModelUI(aiAddType.value));
  aiAddModelId?.addEventListener('input', updateSaveButtonState);
  cloudSelect?.addEventListener('change', updateSaveButtonState);
  lmstudioSelect?.addEventListener('change', updateSaveButtonState);
  lmstudioEmbeddingSelect?.addEventListener('change', updateSaveButtonState);
  aiAddLmstudioUrl?.addEventListener('input', () => {
    syncLmStudioCustomCheckButtonVisibility();
    setLmStudioLamp('', 'LM Studio status');
    if (lmStudioAutocheckTimer) clearTimeout(lmStudioAutocheckTimer);
    const current = normalizeLmStudioUrl(aiAddLmstudioUrl.value);
    if (current === DEFAULT_LMSTUDIO_URL) {
      lmStudioAutocheckTimer = setTimeout(() => checkLmStudioAvailability(current), 350);
    }
  });
  aiAddLmstudioCheckCustom?.addEventListener('click', () => {
    checkLmStudioAvailability(aiAddLmstudioUrl?.value);
  });
  aiAddApiKey?.addEventListener('input', () => {
    wizardState.checkedProvider = '';
    wizardState.checkedModelType = '';
    wizardState.verifiedApiKey = '';
    if (aiAddCheckHint) aiAddCheckHint.textContent = '';
    if (cloudSelect) {
      cloudSelect.disabled = true;
      cloudSelect.innerHTML = '<option value="">Run check first</option>';
    }
    updateSaveButtonState();
  });
  aiAddCheck?.addEventListener('click', () => {
    const type = aiAddType?.value;
    if (['openai', 'claude', 'google'].includes(type)) checkCloudModels(type);
  });

  function closeAddForm() {
    aiAddForm?.classList.add('hidden');
    aiModelSearch.value = '';
    resetWizardChecks();
    renderAiModelsList();
  }
  aiAddSave?.addEventListener('click', async () => {
    const type = aiAddType.value;
    let modelId = '';
    if (type === 'lmstudio') modelId = (lmstudioSelect?.value || '').trim();
    else if (['openai', 'claude', 'google'].includes(type)) modelId = (cloudSelect?.value || '').trim();
    if (!modelId) modelId = aiAddModelId?.value?.trim() || '';
    if (!modelId) return;
    if (type === 'lmstudio' && !wizardState.lmstudioChecked) return;
    if (['openai', 'claude', 'google'].includes(type)) {
      const checked = wizardState.checkedProvider === type && wizardState.checkedModelType === 'cloud';
      if (!checked || !wizardState.verifiedApiKey) return;
    }
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
      baseUrl: type === 'lmstudio' ? normalizeLmStudioUrl(aiAddLmstudioUrl?.value || keys.lmstudio?.baseUrl || DEFAULT_LMSTUDIO_URL) : undefined,
      embeddingModel: type === 'lmstudio' ? ((lmstudioEmbeddingSelect?.value || '').trim()) : undefined,
      apiKey:
        type === 'openai' || type === 'claude' || type === 'google'
          ? wizardState.verifiedApiKey
          : '',
    };
    if (type === 'openai') aiApiKeys.openai = { apiKey: wizardState.verifiedApiKey };
    if (type === 'claude') aiApiKeys.anthropic = { apiKey: wizardState.verifiedApiKey };
    if (type === 'google') aiApiKeys.google = { apiKey: wizardState.verifiedApiKey };
    if (type === 'lmstudio') {
      aiApiKeys.lmstudio = {
        ...(aiApiKeys.lmstudio || {}),
        baseUrl: provider.baseUrl || DEFAULT_LMSTUDIO_URL,
      };
    }
    aiProviders.push(provider);
    await window.mdviewer?.saveAiConfig?.({ aiProviders, aiApiKeys });
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
  renderMathInContainer(container);
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
      const normalizedMd = normalizeMathMarkdown(msg.content || '');
      if (DEBUG_LLM_RAW_MARKDOWN) {
        console.info('[LLM RAW MD]', msg.content || '');
        console.info('[LLM NORMALIZED MD]', normalizedMd);
      }
      const html = markedLib.parse(normalizedMd);
      mdWrap.innerHTML = html;
      bubble.appendChild(mdWrap);
      await renderMarkdownWithMermaid(html, mdWrap);
      renderMathInContainer(mdWrap);
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

async function buildKnowledgebaseContextForPrompt(prompt) {
  try {
    const res = await window.mdviewer?.kbBuildContext?.({ query: prompt });
    return {
      contextDocuments: res?.contextDocuments || [],
      references: res?.references || [],
    };
  } catch (_) {
    return { contextDocuments: [], references: [] };
  }
}

function formatReferencesSection(references) {
  const list = Array.isArray(references) ? references : [];
  const lines = ['---', '**References used**'];
  if (!list.length) {
    lines.push('- None (no knowledgebase chunks matched this response).');
    return lines.join('\n');
  }
  const fileName = (p) => {
    const safe = String(p || '');
    const parts = safe.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || safe || 'unknown';
  };
  const cap = list.slice(0, 8);
  for (const ref of cap) {
    const path = String(ref?.path || 'unknown');
    const section = String(ref?.headingPath || '').trim();
    const chunk = Number.isFinite(Number(ref?.chunkIndex)) ? `chunk ${Number(ref.chunkIndex) + 1}` : 'chunk ?';
    const score = Number.isFinite(Number(ref?.score)) ? `sim ${(Number(ref.score) * 100).toFixed(1)}%` : null;
    const anchor = String(ref?.anchor || '').replace(/\s+/g, ' ').trim();
    const href = `kbref://open?path=${encodeURIComponent(path)}&anchor=${encodeURIComponent(anchor)}`;
    const title = fileName(path);
    const parts = [`[${title}](${href})`, section ? `section: ${section}` : null, chunk, score].filter(Boolean);
    lines.push(`- ${parts.join(' | ')}`);
  }
  if (list.length > cap.length) {
    lines.push(`- ... and ${list.length - cap.length} more`);
  }
  return lines.join('\n');
}

function appendReferencesToAnswer(content, references) {
  const body = String(content || '').trimEnd();
  const refs = formatReferencesSection(references);
  if (!body) return refs;
  if (/\*\*References used\*\*/.test(body)) return body;
  return `${body}\n\n${refs}`;
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
  const safeMd = normalizeMathMarkdown(closeOpenCodeFences(text));
  const html = markedLib.parse(safeMd);
  mdWrap.innerHTML = html;
  renderMathInContainer(mdWrap);
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
  const contextPack = await buildKnowledgebaseContextForPrompt(text);
  const contextDocuments = contextPack.contextDocuments;
  const responseReferences = contextPack.references;
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
        chatMessagesData.push({
          role: 'assistant',
          content: appendReferencesToAnswer(res.content || '', responseReferences),
        });
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
      lastMsg.content = appendReferencesToAnswer(accumulated || '', responseReferences);
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
initSettingsGroups();
initAiSettings();
initChatTab();
window.mdviewer?.onKbImportProgress?.(handleKbImportProgress);
kbHelpBtn?.addEventListener('click', openKnowledgebaseHelpTab);
kbImportFileBtn?.addEventListener('click', importKnowledgebaseFile);
kbImportFolderBtn?.addEventListener('click', importKnowledgebaseFolder);
kbClearAllBtn?.addEventListener('click', clearKnowledgebaseAll);
document.getElementById('talk-to-doc-btn')?.addEventListener('click', () => {
  openChatTab();
});
updateTalkToDocButton();
restoreOpenTabs();
