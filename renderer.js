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
const tabsNewBtn = document.getElementById('tabs-new-btn');
const tabsOverflowWrap = document.getElementById('tabs-overflow-wrap');
const tabsOverflowBtn = document.getElementById('tabs-overflow-btn');
const tabsOverflowMenu = document.getElementById('tabs-overflow-menu');
const searchInput = document.getElementById('search-input');
const themeSelect = document.getElementById('theme');
const viewerEmpty = document.getElementById('viewer-empty');
const viewerEmptyDropzone = document.getElementById('viewer-empty-dropzone');
const emptyOpenFileBtn = document.getElementById('empty-open-file-btn');
const emptyOpenFolderBtn = document.getElementById('empty-open-folder-btn');
const emptyFileInput = document.getElementById('empty-file-input');
const viewerSettings = document.getElementById('viewer-settings');
const viewerChat = document.getElementById('viewer-chat');
const chatMessages = document.getElementById('chat-messages');
const chatInputArea = document.getElementById('chat-input-area');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send');
const chatModelSelect = document.getElementById('chat-model-select');
const chatModelTrigger = document.getElementById('chat-model-trigger');
const chatModelMenu = document.getElementById('chat-model-menu');
const speakPanel = document.getElementById('voice-overlay');
const content = document.querySelector('.content');
const importProgressModal = document.getElementById('import-progress-modal');
const importProgressTitle = document.getElementById('import-progress-title');
const importProgressSubtitle = document.getElementById('import-progress-subtitle');
const importProgressBar = document.getElementById('import-progress-bar');
const importProgressMeta = document.getElementById('import-progress-meta');
const ollamaRemoveModal = document.getElementById('ollama-remove-modal');
const ollamaRemoveSubtitle = document.getElementById('ollama-remove-subtitle');
const ollamaRemoveUninstallBtn = document.getElementById('ollama-remove-uninstall');
const ollamaRemoveShutdownBtn = document.getElementById('ollama-remove-shutdown');
const ollamaRemoveKeepBtn = document.getElementById('ollama-remove-keep');
const ollamaRemoveCancelBtn = document.getElementById('ollama-remove-cancel');
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
const CHAT_TAB = { type: 'chat', name: 'Chat with docs' };
const SPEAK_TAB = { type: 'speak', name: 'Speak with docs' };
const EMPTY_TAB = { type: 'empty', name: 'New tab' };
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
const DEBUG_LLM_RAW_MARKDOWN = false;
let activeDocKbState = null;
let pendingKbReferenceFocus = null;
let kbImportProgressState = null;
let voiceMode = null;

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
    dropzone.classList.add('hidden');
    viewer.style.display = 'block';
    openEmptyTab();
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
    dropzone.classList.add('hidden');
    viewer.style.display = 'block';
    openEmptyTab();
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
  if (tab.type !== 'speak' && voiceMode && !voiceMode.closed) {
    voiceMode.close();
  }
  hideExternalUrl();
  viewerEmpty?.classList.add('hidden');
  viewerMarkdown?.classList.remove('hidden');
  viewerChat?.classList.add('hidden');
  viewerChat?.classList.remove('speak-active');
  chatMessages?.classList.remove('hidden');
  chatInputArea?.classList.remove('hidden');
  speakPanel?.classList.add('hidden');
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
    viewerChat?.classList.remove('speak-active');
    chatMessages?.classList.remove('hidden');
    chatInputArea?.classList.remove('hidden');
    speakPanel?.classList.add('hidden');
    renderChatTab();
    return;
  }
  if (tab.type === 'empty') {
    hideKbDocControl();
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.add('hidden');
    viewerChat?.classList.add('hidden');
    viewerEmpty?.classList.remove('hidden');
    return;
  }
  if (tab.type === 'speak') {
    hideKbDocControl();
    viewerMarkdown?.classList.add('hidden');
    viewerSettings?.classList.add('hidden');
    viewerChat?.classList.remove('hidden');
    viewerChat?.classList.add('speak-active');
    chatMessages?.classList.add('hidden');
    chatInputArea?.classList.add('hidden');
    speakPanel?.classList.remove('hidden');
    renderChatTab();
    if (!voiceMode) voiceMode = new VoiceMode();
    voiceMode.open();
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

  renderTabsOverflowMenu();
  updateTabsOverflowControls();
}

function renderTabsOverflowMenu() {
  if (!tabsOverflowMenu) return;
  tabsOverflowMenu.innerHTML = tabs
    .map((t, i) => {
      const baseName = t.path ? String(t.path).split(/[/\\]/).pop() : '';
      const label = (t.path && baseName && baseName !== t.name)
        ? `${t.name} — ${baseName}`
        : t.name;
      return `<button type="button" class="tabs-overflow-item ${i === activeIndex ? 'active' : ''}" data-index="${i}" title="${escapeHtml(t.path || t.name)}">${escapeHtml(label)}</button>`;
    })
    .join('');
  tabsOverflowMenu.querySelectorAll('.tabs-overflow-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = Number(item.dataset.index);
      if (!Number.isFinite(idx)) return;
      activeIndex = idx;
      tabsOverflowMenu.classList.add('hidden');
      renderTabs();
      renderActive();
      saveOpenTabs();
    });
  });
}

function updateTabsOverflowControls() {
  if (!tabsOverflowWrap || !tabsEl) return;
  requestAnimationFrame(() => {
    const overflow = tabsEl.scrollWidth > tabsEl.clientWidth + 1;
    tabsOverflowWrap.classList.toggle('hidden', !overflow);
    if (!overflow) tabsOverflowMenu?.classList.add('hidden');
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

async function openPathsFromSelection(paths) {
  const normalized = [...new Set((paths || []).filter(Boolean))];
  if (!normalized.length) return;
  const mdPaths = await collectMdPaths(normalized);
  if (mdPaths.length) await openFiles(mdPaths);
  const pdfPaths = collectPdfPaths(normalized);
  if (pdfPaths.length) await importDroppedPdfs(pdfPaths);
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
    await openPathsFromSelection(raw);
  });
}

function getFileNameFromPath(filePath) {
  const safe = String(filePath || '').trim();
  if (!safe) return 'PDF';
  const parts = safe.split(/[/\\]/);
  return parts[parts.length - 1] || 'PDF';
}

function logOllamaDebug(event, payload) {
  if (event === 'progress') {
    const now = Date.now();
    const key = `${payload?.stage || ''}|${payload?.current || 0}|${payload?.total || 0}|${payload?.meta || ''}`;
    if (!logOllamaDebug._last) {
      logOllamaDebug._last = { ts: 0, key: '' };
    }
    const hasDeterminate = Number.isFinite(Number(payload?.total)) && Number(payload?.total) > 0;
    if (!hasDeterminate && (now - logOllamaDebug._last.ts) < 8000) {
      return;
    }
    if (logOllamaDebug._last.key === key && (now - logOllamaDebug._last.ts) < 2000) {
      return;
    }
    logOllamaDebug._last = { ts: now, key };
  }
  // Keep this hook for optional troubleshooting without noisy console output.
}
window.mdviewer?.onOllamaDebug?.((msg) => {
  // Debug messages are intentionally not echoed to renderer console by default.
  void msg;
});

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
  if (importProgressTitle) importProgressTitle.textContent = payload.title || 'Importing PDF...';
  if (importProgressSubtitle) importProgressSubtitle.textContent = payload.subtitle || sourceName;
  if (importProgressMeta) {
    if (payload.meta) importProgressMeta.textContent = payload.meta;
    else if (hasDeterminate) importProgressMeta.textContent = `Processing page ${Math.min(total, Math.max(0, current))} of ${total}`;
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
if (viewerEmptyDropzone) setupDragDrop(viewerEmptyDropzone);

viewerEmptyDropzone?.addEventListener('click', (e) => {
  const target = e.target;
  if (target instanceof Element && target.closest('.viewer-empty-actions')) return;
  emptyFileInput?.click();
});

emptyOpenFileBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  emptyFileInput?.click();
});

emptyOpenFolderBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  await window.mdviewer?.showFolderDialog?.();
});

emptyFileInput?.addEventListener('change', async () => {
  const files = Array.from(emptyFileInput.files || []);
  const paths = files
    .map((f) => window.mdviewer?.getPathForFile?.(f))
    .filter(Boolean);
  await openPathsFromSelection(paths);
  emptyFileInput.value = '';
});

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
window.mdviewer?.onOllamaSetupProgress?.((payload) => {
  logOllamaDebug('progress', payload);
  const stage = String(payload?.stage || '');
  const isUninstall = stage === 'uninstall';
  showImportProgress({
    title: isUninstall ? 'Uninstalling Ollama...' : 'Setting up Ollama...',
    subtitle: payload?.message || (isUninstall ? 'Removing local model engine' : 'Preparing local model engine'),
    meta: payload?.meta || '',
    current: payload?.current,
    total: payload?.total,
  });
});
window.mdviewer?.onOllamaSetupDone?.((payload) => {
  logOllamaDebug('done', payload);
  if (!payload?.ok) {
    showImportProgress({
      title: 'Ollama setup failed',
      subtitle: payload?.message || 'Setup failed',
      meta: payload?.error || 'Try Auto-setup again or connect to an existing Ollama URL.',
    });
    setTimeout(() => hideImportProgress(), 1400);
    return;
  }
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

// Chat / Speak with docs
function getEnabledProviders() {
  return aiProviders.filter((p) => p.enabled !== false);
}

async function updateTalkToDocButton() {
  const chatBtn = document.getElementById('talk-to-doc-btn');
  const speakBtn = document.getElementById('speak-with-doc-btn');
  if (!chatBtn && !speakBtn) return;
  const config = await window.mdviewer?.getAiConfig?.();
  aiProviders = (config?.aiProviders || []).map((p) => ({ ...p, enabled: p.enabled !== false }));
  const disabled = getEnabledProviders().length === 0;
  if (chatBtn) chatBtn.classList.toggle('disabled', disabled);
  if (speakBtn) speakBtn.classList.toggle('disabled', disabled);
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

function openEmptyTab() {
  tabs.push({ ...EMPTY_TAB, id: Date.now().toString(36) + Math.random().toString(36).slice(2) });
  activeIndex = tabs.length - 1;
  dropzone.classList.add('hidden');
  viewer.style.display = 'block';
  renderTabs();
  renderActive();
  saveOpenTabs();
}

async function openSpeakTab() {
  if (getEnabledProviders().length === 0) {
    openSettings();
    return;
  }
  const idx = tabs.findIndex((t) => t.type === 'speak');
  if (idx >= 0) {
    activeIndex = idx;
  } else {
    tabs.push(SPEAK_TAB);
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
  let restored = false;
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
        restored = true;
      }
    }
  }
  if (!restored) {
    dropzone.classList.add('hidden');
    viewer.style.display = 'block';
    if (tabs.length === 0) openEmptyTab();
  }
  restoreDone = true;
  if (pendingOpenPaths.length) {
    const p = pendingOpenPaths.splice(0);
    await openFiles(p);
  }
}

// AI Settings - Cursor-style
let aiApiKeys = {};
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
const aiAddOllamaUrl = document.getElementById('ai-add-ollama-url');
const aiAddOllamaLamp = document.getElementById('ai-add-ollama-lamp');
const aiAddOllamaCheckCustom = document.getElementById('ai-add-ollama-check-custom');
const aiAddOllamaAutosetup = document.getElementById('ai-add-ollama-autosetup');
const typeLabels = { lmstudio: 'LM Studio', ollama: 'Ollama', openai: 'OpenAI', claude: 'Claude', google: 'Google AI' };
let lmStudioModelMetaById = {};
let cloudModelMetaById = {};

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / APPROX_CHARS_PER_TOKEN));
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function bytesToHuman(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const digits = value >= 100 || idx === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[idx]}`;
}

async function askOllamaRemovalChoice(provider) {
  const info = await window.mdviewer?.getOllamaRemovalInfo?.({ baseUrl: provider?.baseUrl });
  const total = bytesToHuman(info?.totalBytes || 0);
  const modelData = bytesToHuman(info?.dataBytes || 0);
  const status = info?.reachable ? 'running/reachable' : 'not reachable';
  if (!ollamaRemoveModal || !ollamaRemoveSubtitle || !ollamaRemoveUninstallBtn || !ollamaRemoveShutdownBtn || !ollamaRemoveKeepBtn || !ollamaRemoveCancelBtn) {
    const fallbackConfirmed = window.confirm('Remove Ollama provider?');
    return fallbackConfirmed ? { cancelled: false, choice: 'keep' } : { cancelled: true };
  }
  ollamaRemoveSubtitle.textContent =
    `Detected disk usage: ${total} total (${modelData} models/data)\n` +
    `Current status: ${status}\n\n` +
    `Pick what to do before provider removal.`;
  ollamaRemoveModal.classList.remove('hidden');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      ollamaRemoveModal.classList.add('hidden');
      resolve(payload);
    };
    const onUninstall = () => finish({ cancelled: false, choice: 'uninstall' });
    const onShutdown = () => finish({ cancelled: false, choice: 'shutdown' });
    const onKeep = () => finish({ cancelled: false, choice: 'keep' });
    const onCancel = () => finish({ cancelled: true });
    const onBackdrop = (e) => {
      if (e.target === ollamaRemoveModal) finish({ cancelled: true });
    };
    const onKeydown = (e) => {
      if (e.key === 'Escape') finish({ cancelled: true });
    };
    const cleanup = () => {
      ollamaRemoveUninstallBtn.removeEventListener('click', onUninstall);
      ollamaRemoveShutdownBtn.removeEventListener('click', onShutdown);
      ollamaRemoveKeepBtn.removeEventListener('click', onKeep);
      ollamaRemoveCancelBtn.removeEventListener('click', onCancel);
      ollamaRemoveModal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
    };
    ollamaRemoveUninstallBtn.addEventListener('click', onUninstall);
    ollamaRemoveShutdownBtn.addEventListener('click', onShutdown);
    ollamaRemoveKeepBtn.addEventListener('click', onKeep);
    ollamaRemoveCancelBtn.addEventListener('click', onCancel);
    ollamaRemoveModal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
  });
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
  const rows = aiProviders
    .map(
      (p) =>
        `<div class="ai-model-row" data-id="${escapeHtml(p.id)}">
          <span class="ai-model-name">${escapeHtml(typeLabels[p.type] || p.type)} / ${escapeHtml(p.modelId || '-')}${(p.type === 'lmstudio' || p.type === 'ollama') ? ` <span class="kb-item-embed-label">(embeddings: ${escapeHtml(p.embeddingModel || 'MiniLM fallback')})</span>` : ''}</span>
          <div class="ai-model-actions">
            <button type="button" class="ai-model-remove" data-id="${escapeHtml(p.id)}" title="Remove">×</button>
            <div class="ai-toggle ${p.enabled !== false ? 'enabled' : ''}" data-id="${escapeHtml(p.id)}" role="button" tabindex="0"></div>
          </div>
        </div>`
    )
    .join('');
  aiModelsList.innerHTML = rows || '';
  aiModelsList.querySelectorAll('.ai-toggle[data-id]').forEach((el) => {
    el.addEventListener('click', () => toggleModel(el.dataset.id));
  });
  aiModelsList.querySelectorAll('.ai-model-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const provider = aiProviders.find((p) => p.id === id);
      if (!provider) return;
      if (provider.type === 'ollama') {
        const decision = await askOllamaRemovalChoice(provider);
        if (decision?.cancelled) return;
        if (decision.choice === 'uninstall') {
          const result = await window.mdviewer?.uninstallOllama?.({ baseUrl: provider.baseUrl });
          if (!result?.ok) {
            alert(result?.error || 'Ollama uninstall failed.');
            return;
          }
        } else if (decision.choice === 'shutdown') {
          const result = await window.mdviewer?.shutdownOllama?.({ baseUrl: provider.baseUrl });
          if (!result?.ok) {
            alert(result?.error || 'Could not fully stop Ollama.');
            return;
          }
        }
      } else {
        const confirmed = window.confirm('Remove this model provider?');
        if (!confirmed) return;
      }
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
    if (key === 'ollama') return 'Ollama';
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
  document.getElementById('ai-add-model-btn')?.addEventListener('click', openAddForm);
  document.getElementById('ai-refresh-models')?.addEventListener('click', () => {
    renderAiSettings();
  });

  const addPlaceholders = { openai: 'e.g. gpt-4o', claude: 'e.g. claude-3-5-sonnet', google: 'e.g. gemini-1.5-flash' };
  const lmstudioWrap = document.getElementById('ai-add-lmstudio-wrap');
  const ollamaWrap = document.getElementById('ai-add-ollama-wrap');
  const cloudWrap = document.getElementById('ai-add-cloud-wrap');
  const manualWrap = document.getElementById('ai-add-manual-wrap');
  const lmstudioSelect = document.getElementById('ai-add-lmstudio-model');
  const lmstudioEmbeddingSelect = document.getElementById('ai-add-lmstudio-embedding-model');
  const lmstudioHint = document.getElementById('ai-add-lmstudio-hint');
  const ollamaDetails = document.getElementById('ai-add-ollama-details');
  const ollamaSelect = document.getElementById('ai-add-ollama-model');
  const ollamaEmbeddingSelect = document.getElementById('ai-add-ollama-embedding-model');
  const ollamaHint = document.getElementById('ai-add-ollama-hint');
  const cloudSelect = document.getElementById('ai-add-cloud-model');
  const cloudHint = document.getElementById('ai-add-cloud-hint');
  const DEFAULT_LMSTUDIO_URL = 'http://localhost:1234';
  const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
  const DEFAULT_OLLAMA_CHAT_MODEL = 'llama3.2:1b';
  const FAST_OLLAMA_CHAT_MODEL_PREFIXES = [
    'llama3.2:1b',
    'qwen2.5:1.5b',
    'gemma2:2b',
    'phi3:mini',
  ];
  const DEFAULT_OLLAMA_EMBED_MODEL = 'nomic-embed-text';
  let lmStudioAutocheckTimer = null;
  let ollamaAutocheckTimer = null;
  const cloudKeyMap = { openai: 'openai', claude: 'anthropic', google: 'google' };
  const wizardState = {
    checkedProvider: '',
    checkedModelType: '',
    verifiedApiKey: '',
    lmstudioChecked: false,
    ollamaChecked: false,
    ollamaSetupRunning: false,
  };
  let lastOllamaAvailability = null;

  function resetWizardChecks() {
    wizardState.checkedProvider = '';
    wizardState.checkedModelType = '';
    wizardState.verifiedApiKey = '';
    wizardState.lmstudioChecked = false;
    wizardState.ollamaChecked = false;
    wizardState.ollamaSetupRunning = false;
    lastOllamaAvailability = null;
    if (aiAddCheckHint) aiAddCheckHint.textContent = '';
    if (cloudHint) cloudHint.textContent = '';
    if (lmstudioHint) lmstudioHint.textContent = '';
    if (ollamaHint) ollamaHint.textContent = '';
  }

  function normalizeLmStudioUrl(url) {
    const raw = String(url || '').trim();
    return raw || DEFAULT_LMSTUDIO_URL;
  }
  function normalizeOllamaUrl(url) {
    const raw = String(url || '').trim();
    return raw || DEFAULT_OLLAMA_URL;
  }

  function setLmStudioLamp(state, title = '') {
    if (!aiAddLmstudioLamp) return;
    aiAddLmstudioLamp.classList.remove('ok', 'fail', 'checking');
    if (state) aiAddLmstudioLamp.classList.add(state);
    aiAddLmstudioLamp.title = title || 'LM Studio status';
  }
  function setOllamaLamp(state, title = '') {
    if (!aiAddOllamaLamp) return;
    aiAddOllamaLamp.classList.remove('ok', 'fail', 'checking');
    if (state) aiAddOllamaLamp.classList.add(state);
    aiAddOllamaLamp.title = title || 'Ollama status';
  }

  function syncLmStudioCustomCheckButtonVisibility() {
    if (!aiAddLmstudioCheckCustom) return;
    const current = normalizeLmStudioUrl(aiAddLmstudioUrl?.value);
    aiAddLmstudioCheckCustom.classList.toggle('hidden', current === DEFAULT_LMSTUDIO_URL);
  }
  function syncOllamaCustomCheckButtonVisibility() {
    if (!aiAddOllamaCheckCustom) return;
    const current = normalizeOllamaUrl(aiAddOllamaUrl?.value);
    aiAddOllamaCheckCustom.classList.toggle('hidden', current === DEFAULT_OLLAMA_URL);
  }
  function syncOllamaSetupButtonVisibility() {
    if (!aiAddOllamaAutosetup) return;
    const hasLlmModels = Array.isArray(lastOllamaAvailability?.llmModels) && lastOllamaAvailability.llmModels.length > 0;
    const shouldShow = !lastOllamaAvailability?.ok || !hasLlmModels;
    aiAddOllamaAutosetup.classList.toggle('hidden', !shouldShow);
    aiAddOllamaAutosetup.disabled = wizardState.ollamaSetupRunning;
    aiAddOllamaAutosetup.textContent = wizardState.ollamaSetupRunning ? 'Setting up...' : 'Auto-setup';
  }
  function syncOllamaSectionVisibility() {
    const hasLlmModels = Array.isArray(lastOllamaAvailability?.llmModels) && lastOllamaAvailability.llmModels.length > 0;
    const isConfigured = Boolean(lastOllamaAvailability?.ok && hasLlmModels);
    ollamaDetails?.classList.toggle('hidden', !isConfigured);
    syncOllamaSetupButtonVisibility();
  }

  function updateSaveButtonState() {
    const type = aiAddType?.value;
    let enabled = false;
    if (type === 'lmstudio') {
      enabled = Boolean(wizardState.lmstudioChecked && lmstudioSelect?.value);
    } else if (type === 'ollama') {
      enabled = Boolean(wizardState.ollamaChecked && ollamaSelect?.value);
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

  async function checkOllamaAvailability(baseUrlOverride) {
    const baseUrl = normalizeOllamaUrl(
      baseUrlOverride ||
      aiAddOllamaUrl?.value ||
      aiApiKeys.ollama?.baseUrl ||
      aiProviders.find((p) => p.type === 'ollama')?.baseUrl ||
      DEFAULT_OLLAMA_URL
    );
    if (aiAddOllamaUrl) aiAddOllamaUrl.value = baseUrl;
    syncOllamaCustomCheckButtonVisibility();
    setOllamaLamp('checking', `Checking ${baseUrl}`);
    if (ollamaSelect) {
      ollamaSelect.disabled = true;
      ollamaSelect.innerHTML = '<option value="">Loading models...</option>';
      if (ollamaHint) ollamaHint.textContent = '';
    }
    if (ollamaEmbeddingSelect) {
      ollamaEmbeddingSelect.disabled = true;
      ollamaEmbeddingSelect.innerHTML = `<option value="${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)}">${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)} (recommended)</option><option value="">Use MiniLM fallback (default)</option>`;
    }
    wizardState.ollamaChecked = false;
    updateSaveButtonState();
    syncOllamaSectionVisibility();

    const availability = await window.mdviewer?.checkOllamaAvailability?.(baseUrl);
    logOllamaDebug('check-availability', { baseUrl, availability });
    lastOllamaAvailability = availability || null;
    const models = availability?.llmModels || [];
    const embeddingModels = availability?.embeddingModels || [];
    const error = availability?.error;
    if (ollamaSelect) {
      ollamaSelect.disabled = false;
      if (error) {
        ollamaSelect.innerHTML = '<option value="">Failed to load models</option>';
        if (ollamaEmbeddingSelect) {
          ollamaEmbeddingSelect.disabled = false;
          ollamaEmbeddingSelect.innerHTML = `<option value="${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)}">${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)} (recommended)</option><option value="">Use MiniLM fallback (default)</option>`;
          ollamaEmbeddingSelect.value = DEFAULT_OLLAMA_EMBED_MODEL;
        }
        if (ollamaHint) {
          ollamaHint.textContent = `${error}. Run Auto-setup or connect a running Ollama URL.`;
        }
        setOllamaLamp('fail', `Ollama unreachable at ${baseUrl}`);
        syncOllamaSectionVisibility();
        updateSaveButtonState();
        return;
      }
      if (!models?.length) {
        ollamaSelect.innerHTML = '<option value="">No chat models found</option>';
        if (ollamaEmbeddingSelect) {
          ollamaEmbeddingSelect.disabled = false;
          const embedOptions = embeddingModels
            .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`)
            .join('');
          ollamaEmbeddingSelect.innerHTML = `${embedOptions}<option value="">Use MiniLM fallback (default)</option>`;
          ollamaEmbeddingSelect.value = embeddingModels.find((m) => m.id === DEFAULT_OLLAMA_EMBED_MODEL)?.id || DEFAULT_OLLAMA_EMBED_MODEL;
        }
        if (ollamaHint) {
          const rec = (availability?.recommendedChatModels || []).join(', ') || DEFAULT_OLLAMA_CHAT_MODEL;
          ollamaHint.textContent = `Ollama connected, but no chat model pulled. Recommended: ${rec}.`;
        }
        setOllamaLamp('ok', `Ollama reachable at ${baseUrl}`);
        syncOllamaSectionVisibility();
        updateSaveButtonState();
        return;
      }
      ollamaSelect.innerHTML = models
        .map((m) => {
          const effective = toInt(m.effectiveContextLength) || toInt(m.maxContextLength);
          const ctx = effective ? ` (${(effective / 1024).toFixed(0)}k ctx)` : '';
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}${escapeHtml(ctx)}</option>`;
        })
        .join('');
      const preferredChatModel =
        models.find((m) => m.id === DEFAULT_OLLAMA_CHAT_MODEL)?.id ||
        models.find((m) =>
          FAST_OLLAMA_CHAT_MODEL_PREFIXES.some((prefix) => String(m.id || '').startsWith(prefix))
        )?.id ||
        String(models[0]?.id || '');
      ollamaSelect.value = preferredChatModel;
      if (ollamaEmbeddingSelect) {
        ollamaEmbeddingSelect.disabled = false;
        const embedOptions = embeddingModels
          .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`)
          .join('');
        ollamaEmbeddingSelect.innerHTML = `${embedOptions}<option value="">Use MiniLM fallback (default)</option>`;
        const preferredEmbedModel =
          embeddingModels.find((m) => m.id === DEFAULT_OLLAMA_EMBED_MODEL)?.id ||
          embeddingModels[0]?.id ||
          '';
        ollamaEmbeddingSelect.value = preferredEmbedModel || '';
      }
      if (ollamaHint) {
        const embedText = embeddingModels.length
          ? `Embedding models: ${embeddingModels.length}.`
          : `Missing embedding model. Run Auto-setup to pull ${DEFAULT_OLLAMA_EMBED_MODEL}.`;
        ollamaHint.textContent = `Chat models: ${models.length}. ${embedText}`;
      }
      setOllamaLamp('ok', `Ollama reachable at ${baseUrl}`);
      wizardState.ollamaChecked = true;
      syncOllamaSectionVisibility();
      updateSaveButtonState();
    }
  }

  async function runOllamaAutoSetup() {
    if (wizardState.ollamaSetupRunning) return;
    logOllamaDebug('autosetup-start', {
      url: normalizeOllamaUrl(aiAddOllamaUrl?.value),
      chatModel: (ollamaSelect?.value || DEFAULT_OLLAMA_CHAT_MODEL).trim() || DEFAULT_OLLAMA_CHAT_MODEL,
      embeddingModel: (ollamaEmbeddingSelect?.value || DEFAULT_OLLAMA_EMBED_MODEL).trim() || DEFAULT_OLLAMA_EMBED_MODEL,
    });
    wizardState.ollamaSetupRunning = true;
    syncOllamaSetupButtonVisibility();
    if (ollamaHint) ollamaHint.textContent = 'Running auto-setup...';
    const baseUrl = normalizeOllamaUrl(aiAddOllamaUrl?.value);
    const chatModel = (ollamaSelect?.value || DEFAULT_OLLAMA_CHAT_MODEL).trim() || DEFAULT_OLLAMA_CHAT_MODEL;
    const embeddingModel =
      (ollamaEmbeddingSelect?.value || DEFAULT_OLLAMA_EMBED_MODEL).trim() || DEFAULT_OLLAMA_EMBED_MODEL;
    try {
      const result = await window.mdviewer?.startOllamaAutosetup?.({
        baseUrl,
        chatModel,
        embeddingModel,
      });
      logOllamaDebug('autosetup-result', result);
      if (!result?.ok) {
        throw new Error(result?.error || 'Auto-setup failed');
      }
      if (ollamaHint) ollamaHint.textContent = 'Auto-setup finished. Checking Ollama...';
      await checkOllamaAvailability(baseUrl);
    } catch (err) {
      logOllamaDebug('autosetup-error', { message: err?.message || String(err) });
      setOllamaLamp('fail', `Ollama setup failed at ${baseUrl}`);
      if (ollamaHint) {
        ollamaHint.textContent = `${err?.message || 'Setup failed'}. Try Auto-setup again or use manual install URL.`;
      }
    } finally {
      wizardState.ollamaSetupRunning = false;
      syncOllamaSetupButtonVisibility();
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
    const isOllama = type === 'ollama';
    const isCloud = ['openai', 'claude', 'google'].includes(type);
    lmstudioWrap?.classList.toggle('hidden', !isLm);
    ollamaWrap?.classList.toggle('hidden', !isOllama);
    cloudWrap?.classList.toggle('hidden', !isCloud);
    aiAddApiKeyWrap?.classList.toggle('hidden', !isCloud);
    manualWrap?.classList.toggle('hidden', isLm || isOllama || isCloud);
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
    if (ollamaSelect && isOllama) {
      ollamaSelect.disabled = true;
      ollamaSelect.innerHTML = '<option value="">Run check first</option>';
    }
    if (ollamaEmbeddingSelect && isOllama) {
      ollamaEmbeddingSelect.disabled = true;
      ollamaEmbeddingSelect.innerHTML = `<option value="${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)}">${escapeHtml(DEFAULT_OLLAMA_EMBED_MODEL)} (recommended)</option><option value="">Use MiniLM fallback (default)</option>`;
      ollamaEmbeddingSelect.value = DEFAULT_OLLAMA_EMBED_MODEL;
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
    if (isOllama && aiAddOllamaUrl) {
      aiAddOllamaUrl.value = normalizeOllamaUrl(
        aiApiKeys.ollama?.baseUrl ||
        aiProviders.find((p) => p.type === 'ollama')?.baseUrl ||
        DEFAULT_OLLAMA_URL
      );
      syncOllamaCustomCheckButtonVisibility();
      setOllamaLamp('', 'Ollama status');
      syncOllamaSectionVisibility();
      checkOllamaAvailability(aiAddOllamaUrl.value);
    } else {
      setOllamaLamp('', 'Ollama status');
      syncOllamaSectionVisibility();
    }
    if (aiAddApiKey) {
      const keySlot = cloudKeyMap[type];
      aiAddApiKey.value = keySlot ? (aiApiKeys[keySlot]?.apiKey || '') : '';
    }
    updateSaveButtonState();
  }

  function openAddForm() {
    aiAddForm?.classList.remove('hidden');
    aiAddType.value = 'ollama';
    aiAddModelId.value = '';
    switchAddModelUI('ollama');
    updateSaveButtonState();
  }
  aiAddType?.addEventListener('change', () => switchAddModelUI(aiAddType.value));
  aiAddModelId?.addEventListener('input', updateSaveButtonState);
  cloudSelect?.addEventListener('change', updateSaveButtonState);
  lmstudioSelect?.addEventListener('change', updateSaveButtonState);
  lmstudioEmbeddingSelect?.addEventListener('change', updateSaveButtonState);
  ollamaSelect?.addEventListener('change', updateSaveButtonState);
  ollamaEmbeddingSelect?.addEventListener('change', updateSaveButtonState);
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
  aiAddOllamaUrl?.addEventListener('input', () => {
    syncOllamaCustomCheckButtonVisibility();
    setOllamaLamp('', 'Ollama status');
    if (ollamaAutocheckTimer) clearTimeout(ollamaAutocheckTimer);
    const current = normalizeOllamaUrl(aiAddOllamaUrl.value);
    if (current === DEFAULT_OLLAMA_URL) {
      ollamaAutocheckTimer = setTimeout(() => checkOllamaAvailability(current), 350);
    }
  });
  aiAddOllamaAutosetup?.addEventListener('click', () => {
    runOllamaAutoSetup();
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
    resetWizardChecks();
    renderAiModelsList();
  }
  aiAddSave?.addEventListener('click', async () => {
    const type = aiAddType.value;
    let modelId = '';
    if (type === 'lmstudio') modelId = (lmstudioSelect?.value || '').trim();
    else if (type === 'ollama') modelId = (ollamaSelect?.value || '').trim();
    else if (['openai', 'claude', 'google'].includes(type)) modelId = (cloudSelect?.value || '').trim();
    if (!modelId) modelId = aiAddModelId?.value?.trim() || '';
    if (!modelId) return;
    if (type === 'lmstudio' && !wizardState.lmstudioChecked) return;
    if (type === 'ollama' && !wizardState.ollamaChecked) return;
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
      embeddingModel:
        type === 'lmstudio'
          ? ((lmstudioEmbeddingSelect?.value || '').trim())
          : type === 'ollama'
            ? ((ollamaEmbeddingSelect?.value || '').trim())
            : undefined,
      apiKey:
        type === 'openai' || type === 'claude' || type === 'google'
          ? wizardState.verifiedApiKey
          : '',
    };
    if (type === 'ollama') {
      provider.baseUrl = normalizeOllamaUrl(aiAddOllamaUrl?.value || keys.ollama?.baseUrl || DEFAULT_OLLAMA_URL);
    }
    if (type === 'openai') aiApiKeys.openai = { apiKey: wizardState.verifiedApiKey };
    if (type === 'claude') aiApiKeys.anthropic = { apiKey: wizardState.verifiedApiKey };
    if (type === 'google') aiApiKeys.google = { apiKey: wizardState.verifiedApiKey };
    if (type === 'lmstudio') {
      aiApiKeys.lmstudio = {
        ...(aiApiKeys.lmstudio || {}),
        baseUrl: provider.baseUrl || DEFAULT_LMSTUDIO_URL,
      };
    }
    if (type === 'ollama') {
      aiApiKeys.ollama = {
        ...(aiApiKeys.ollama || {}),
        baseUrl: provider.baseUrl || DEFAULT_OLLAMA_URL,
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

// ─── Voice Input ─────────────────────────────────────────────────────────────

let voiceRecording = false;
let voiceStopping = false;
let voiceTranscribing = false;
let voiceMicStream = null;
let voiceMediaRecorder = null;
let voiceSessionId = 0;
let voiceEventSeq = 0;
let voiceMicReleaseTimer = null;
let voiceQuickAudioCtx = null;
let voiceQuickSourceNode = null;
let voiceQuickWorkletNode = null;
let voiceQuickChunks = [];
let voiceQuickSampleRate = 16000;
const voiceWorkletLoadedContexts = new WeakSet();
const VOICE_MIC_RELEASE_DELAY_MS = 15000;

function logVoiceDebug(event, extra = {}) {
  const payload = {
    event,
    seq: ++voiceEventSeq,
    ts: Date.now(),
    voiceRecording,
    voiceStopping,
    voiceTranscribing,
    hasMicStream: Boolean(voiceMicStream),
    recorderState: voiceMediaRecorder?.state || 'none',
    pcmCaptureActive: Boolean(voiceQuickWorkletNode),
    ...extra,
  };
  try {
    window.mdviewer?.voiceDebug?.(payload);
  } catch (_) {}
  try {
    console.log('[voice]', payload);
  } catch (_) {}
}

function clearVoiceMicReleaseTimer() {
  if (!voiceMicReleaseTimer) return;
  clearTimeout(voiceMicReleaseTimer);
  voiceMicReleaseTimer = null;
}

function hasLiveAudioTrack(stream) {
  if (!stream?.getAudioTracks) return false;
  return stream.getAudioTracks().some((t) => t.readyState === 'live');
}

function releaseVoiceMicStream(reason = 'unknown') {
  clearVoiceMicReleaseTimer();
  if (!voiceMicStream) return;
  try {
    voiceMicStream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  voiceMicStream = null;
  logVoiceDebug('quick:mic:released', { reason });
}

function scheduleVoiceMicRelease(reason = 'idle', delayMs = VOICE_MIC_RELEASE_DELAY_MS) {
  clearVoiceMicReleaseTimer();
  voiceMicReleaseTimer = setTimeout(() => {
    // Never release while active recording/transcription is in progress.
    if (voiceRecording || voiceStopping || voiceTranscribing) return;
    releaseVoiceMicStream(reason);
  }, Math.max(0, Number(delayMs) || 0));
  logVoiceDebug('quick:mic:release-scheduled', { reason, delayMs: Math.max(0, Number(delayMs) || 0) });
}

const VOICE_STT_KEY = 'voiceSttMode'; // 'webspeech' | 'whisper'
const VOICE_SPEECH_LANG_KEY = 'voiceSpeechLanguage'; // 'auto' | BCP-47 locale
const VOICE_TTS_ENABLED_KEY = 'voiceTtsEnabled';
const VOICE_TTS_TURN_TAKING_KEY = 'voiceTtsTurnTaking'; // 'resume_after_tts' | 'resume_immediately'
const VOICE_TTS_RATE_KEY = 'voiceTtsRate';
const VOICE_TTS_VOICE_URI_KEY = 'voiceTtsVoiceUri';

function getVoiceSttMode() {
  return localStorage.getItem(VOICE_STT_KEY) || 'webspeech';
}

function setVoiceSttMode(mode) {
  localStorage.setItem(VOICE_STT_KEY, mode);
}

function getVoiceSpeechLanguage() {
  const raw = String(localStorage.getItem(VOICE_SPEECH_LANG_KEY) || '').trim();
  if (!raw || raw === 'auto') return 'auto';
  return raw;
}

function setVoiceSpeechLanguage(lang) {
  const next = String(lang || '').trim();
  if (!next || next === 'auto') {
    localStorage.setItem(VOICE_SPEECH_LANG_KEY, 'auto');
    return;
  }
  localStorage.setItem(VOICE_SPEECH_LANG_KEY, next);
}

function resolveSpeechRecognitionLanguage() {
  const configured = getVoiceSpeechLanguage();
  if (configured && configured !== 'auto') return configured;
  return navigator.language || 'en-US';
}

function resolveWhisperLanguageHint() {
  const configured = getVoiceSpeechLanguage();
  if (!configured || configured === 'auto') return '';
  const base = configured.split('-')[0]?.toLowerCase() || '';
  return base;
}

function getVoiceTtsEnabled() {
  const raw = localStorage.getItem(VOICE_TTS_ENABLED_KEY);
  if (raw == null) return true;
  return raw !== '0' && raw !== 'false';
}

function setVoiceTtsEnabled(enabled) {
  localStorage.setItem(VOICE_TTS_ENABLED_KEY, enabled ? '1' : '0');
}

function getVoiceTtsTurnTakingMode() {
  const raw = String(localStorage.getItem(VOICE_TTS_TURN_TAKING_KEY) || '').trim();
  return raw === 'resume_immediately' ? 'resume_immediately' : 'resume_after_tts';
}

function setVoiceTtsTurnTakingMode(mode) {
  localStorage.setItem(
    VOICE_TTS_TURN_TAKING_KEY,
    mode === 'resume_immediately' ? 'resume_immediately' : 'resume_after_tts'
  );
}

function getVoiceTtsRate() {
  const parsed = Number(localStorage.getItem(VOICE_TTS_RATE_KEY));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0.75, Math.min(1.5, parsed));
}

function setVoiceTtsRate(rate) {
  const v = Number(rate);
  if (!Number.isFinite(v)) return;
  localStorage.setItem(VOICE_TTS_RATE_KEY, String(Math.max(0.75, Math.min(1.5, v))));
}

function getVoiceTtsVoiceUri() {
  return String(localStorage.getItem(VOICE_TTS_VOICE_URI_KEY) || '').trim();
}

function setVoiceTtsVoiceUri(uri) {
  if (!uri) {
    localStorage.removeItem(VOICE_TTS_VOICE_URI_KEY);
    return;
  }
  localStorage.setItem(VOICE_TTS_VOICE_URI_KEY, String(uri).trim());
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Decode an audio blob and resample to 16 kHz mono Float32Array (Whisper input format)
async function decodeAndResampleAudio(arrayBuffer) {
  const audioCtx = new AudioContext();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    try { audioCtx.close(); } catch (_) {}
  }
  const targetRate = 16000;
  if (decoded.sampleRate === targetRate && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0);
  }
  const targetLength = Math.round(decoded.duration * targetRate);
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

function concatFloat32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function resampleFloat32Linear(input, fromRate, toRate) {
  if (!input?.length) return new Float32Array(0);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || fromRate === toRate) return input;
  const targetLength = Math.max(1, Math.round(input.length * (toRate / fromRate)));
  const output = new Float32Array(targetLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = sourceIndex - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

function normalizePcmForWhisper(input) {
  if (!(input instanceof Float32Array) || input.length === 0) return new Float32Array(0);
  let mean = 0;
  for (let i = 0; i < input.length; i += 1) mean += input[i];
  mean /= input.length;
  let peak = 0;
  const centered = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const v = input[i] - mean;
    centered[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak < 1e-5) return centered;
  const gain = Math.min(8, 0.9 / peak);
  if (gain <= 1.01) return centered;
  for (let i = 0; i < centered.length; i += 1) centered[i] *= gain;
  return centered;
}

function markdownToSpeechText(input) {
  let text = String(input || '');
  if (!text) return '';
  // Remove fenced code blocks first so we don't read code dumps aloud.
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  text = text.replace(/[*_~]+/g, '');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

class SystemTtsQueue {
  constructor() {
    this.synth = window.speechSynthesis || null;
    this.queue = [];
    this.pendingMarkdown = '';
    this.active = false;
    this.voiceUri = '';
    this.rate = 1;
    this.enabled = true;
    this._idleResolvers = [];
    this._speakingListener = null;
    this._lastSpeakingState = false;
  }

  configure({ enabled, rate, voiceUri }) {
    this.enabled = Boolean(enabled);
    this.rate = Math.max(0.75, Math.min(1.5, Number(rate) || 1));
    this.voiceUri = String(voiceUri || '').trim();
    if (!this.enabled) this.cancel();
  }

  isEnabled() {
    return Boolean(this.enabled && this.synth);
  }

  appendMarkdownDelta(delta) {
    if (!this.isEnabled()) return;
    const next = String(delta || '');
    if (!next) return;
    this.pendingMarkdown += next;
    this._flushByBoundary(false);
  }

  flushFinal() {
    if (!this.isEnabled()) return;
    this._flushByBoundary(true);
  }

  cancel() {
    this.queue = [];
    this.pendingMarkdown = '';
    if (this.synth) {
      try { this.synth.cancel(); } catch (_) {}
    }
    this.active = false;
    this._emitSpeakingState(false);
    this._resolveIdleWaiters();
  }

  onSpeakingChange(cb) {
    this._speakingListener = typeof cb === 'function' ? cb : null;
  }

  _emitSpeakingState(isSpeaking) {
    const next = Boolean(isSpeaking);
    if (next === this._lastSpeakingState) return;
    this._lastSpeakingState = next;
    if (!this._speakingListener) return;
    try { this._speakingListener(next); } catch (_) {}
  }

  waitForIdle(timeoutMs = 20000) {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, Math.max(1000, Number(timeoutMs) || 20000));
      this._idleResolvers.push(() => {
        clearTimeout(timer);
        done();
      });
    });
  }

  _resolveIdleWaiters() {
    if (this.active || this.queue.length) return;
    const waiters = this._idleResolvers.splice(0);
    waiters.forEach((fn) => {
      try { fn(); } catch (_) {}
    });
  }

  _flushByBoundary(forceAll) {
    if (!this.pendingMarkdown) return;
    while (this.pendingMarkdown.length) {
      const boundaryIdx = this._findBoundary(this.pendingMarkdown);
      if (boundaryIdx < 0) {
        if (!forceAll) break;
        const segment = this.pendingMarkdown;
        this.pendingMarkdown = '';
        this._enqueueSegment(segment);
        break;
      }
      const segment = this.pendingMarkdown.slice(0, boundaryIdx + 1);
      this.pendingMarkdown = this.pendingMarkdown.slice(boundaryIdx + 1);
      this._enqueueSegment(segment);
      if (!forceAll && this.queue.length > 8) break;
    }
    this._pump();
  }

  _findBoundary(text) {
    let hit = -1;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\n') {
        hit = i;
        break;
      }
      if ((c === '.' || c === '!' || c === '?' || c === ';') && i + 1 < text.length && /\s/.test(text[i + 1])) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) return hit;
    if (text.length > 220) {
      const fallback = text.lastIndexOf(' ', 220);
      return fallback > 40 ? fallback : 220;
    }
    return -1;
  }

  _enqueueSegment(markdownSegment) {
    const clean = markdownToSpeechText(markdownSegment);
    if (!clean) return;
    if (clean.length < 2) return;
    this.queue.push(clean);
  }

  _resolveVoice() {
    if (!this.synth) return null;
    const voices = this.synth.getVoices?.() || [];
    if (!voices.length) return null;
    if (!this.voiceUri) return null;
    return voices.find((v) => v.voiceURI === this.voiceUri) || null;
  }

  _pump() {
    if (!this.isEnabled()) {
      this._resolveIdleWaiters();
      return;
    }
    if (this.active) return;
    const text = this.queue.shift();
    if (!text) {
      this._emitSpeakingState(false);
      this._resolveIdleWaiters();
      return;
    }
    let utterance;
    try {
      utterance = new SpeechSynthesisUtterance(text);
    } catch (_) {
      this.active = false;
      this._resolveIdleWaiters();
      return;
    }
    const voice = this._resolveVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = this.rate;
    utterance.onend = () => {
      this.active = false;
      this._emitSpeakingState(false);
      this._pump();
    };
    utterance.onerror = () => {
      this.active = false;
      this._emitSpeakingState(false);
      this._pump();
    };
    this.active = true;
    this._emitSpeakingState(true);
    try {
      this.synth.speak(utterance);
    } catch (_) {
      this.active = false;
      this._emitSpeakingState(false);
      this._pump();
    }
  }
}

function stopQuickPcmCaptureGraph() {
  try { voiceQuickSourceNode?.disconnect(); } catch (_) {}
  try { voiceQuickWorkletNode?.disconnect(); } catch (_) {}
  const ctx = voiceQuickAudioCtx;
  voiceQuickSourceNode = null;
  voiceQuickWorkletNode = null;
  voiceQuickAudioCtx = null;
  if (ctx) {
    try { ctx.close(); } catch (_) {}
  }
}

async function ensureVoiceWorkletModule(audioCtx) {
  if (!audioCtx?.audioWorklet?.addModule) {
    throw new Error('AudioWorklet is not available in this renderer.');
  }
  if (voiceWorkletLoadedContexts.has(audioCtx)) return;
  const moduleUrl = new URL('voice-capture-worklet.js', window.location.href).toString();
  await audioCtx.audioWorklet.addModule(moduleUrl);
  voiceWorkletLoadedContexts.add(audioCtx);
}

// ── Whisper model management (settings UI) ───────────────────────────────────

const whisperModelNameEl = document.getElementById('whisper-model-name');
const whisperStatusTextEl = document.getElementById('whisper-status-text');
const whisperDownloadBtn = document.getElementById('whisper-download-btn');
const whisperProgressWrap = document.getElementById('whisper-progress-wrap');
const whisperProgressFill = document.getElementById('whisper-progress-fill');
const whisperProgressLabel = document.getElementById('whisper-progress-label');
let whisperDownloading = false;

async function refreshWhisperModelStatus() {
  const status = await window.mdviewer?.whisperGetStatus?.();
  if (!status) return;
  if (whisperModelNameEl) whisperModelNameEl.textContent = status.model || 'Unknown';
  if (status.loaded) {
    if (whisperStatusTextEl) {
      whisperStatusTextEl.innerHTML = '<span class="whisper-status-ready">Ready</span> — model loaded in memory';
    }
    if (whisperDownloadBtn) whisperDownloadBtn.textContent = 'Model ready';
    whisperDownloadBtn?.setAttribute('disabled', '');
  } else if (status.loading || whisperDownloading) {
    if (whisperStatusTextEl) whisperStatusTextEl.textContent = 'Downloading / loading...';
    whisperDownloadBtn?.setAttribute('disabled', '');
    if (whisperDownloadBtn) whisperDownloadBtn.textContent = 'Downloading...';
  } else if (status.cached) {
    if (whisperStatusTextEl) {
      whisperStatusTextEl.innerHTML = '<span class="whisper-status-ready">Downloaded</span> — will load on first use';
    }
    if (whisperDownloadBtn) whisperDownloadBtn.textContent = 'Load model now';
    whisperDownloadBtn?.removeAttribute('disabled');
  } else {
    if (whisperStatusTextEl) whisperStatusTextEl.textContent = 'Not downloaded yet';
    if (whisperDownloadBtn) whisperDownloadBtn.textContent = 'Download model (~244 MB)';
    whisperDownloadBtn?.removeAttribute('disabled');
  }
}

async function startWhisperDownload() {
  if (whisperDownloading) return;
  whisperDownloading = true;
  whisperDownloadBtn?.setAttribute('disabled', '');
  if (whisperDownloadBtn) whisperDownloadBtn.textContent = 'Downloading...';
  whisperProgressWrap?.classList.remove('hidden');
  if (whisperProgressFill) whisperProgressFill.style.width = '0%';
  if (whisperProgressLabel) whisperProgressLabel.textContent = 'Starting download...';

  const progressHandler = (p) => {
    if (!p || p.status !== 'progress') return;
    const pct = Number(p.progress) || 0;
    const file = String(p.file || '').split('/').pop() || '';
    if (whisperProgressFill) whisperProgressFill.style.width = Math.min(100, pct).toFixed(1) + '%';
    if (whisperProgressLabel) {
      whisperProgressLabel.textContent = file
        ? `${file} — ${pct.toFixed(0)}%`
        : `${pct.toFixed(0)}%`;
    }
  };
  window.mdviewer?.onWhisperProgress?.(progressHandler);

  try {
    const result = await window.mdviewer?.whisperPreload?.();
    if (result?.ok) {
      if (whisperProgressFill) whisperProgressFill.style.width = '100%';
      if (whisperProgressLabel) whisperProgressLabel.textContent = 'Model loaded and ready';
    } else {
      if (whisperProgressLabel) whisperProgressLabel.textContent = 'Download failed: ' + (result?.error || 'Unknown error');
    }
  } catch (e) {
    if (whisperProgressLabel) whisperProgressLabel.textContent = 'Download failed: ' + (e?.message || String(e));
  }

  whisperDownloading = false;
  await refreshWhisperModelStatus();
}

function initWhisperSettings() {
  whisperDownloadBtn?.addEventListener('click', startWhisperDownload);
  refreshWhisperModelStatus();
}

function initVoiceTtsSettings() {
  const enabledEl = document.getElementById('tts-enabled');
  const turnTakingEl = document.getElementById('tts-turn-taking');
  const rateEl = document.getElementById('tts-rate');
  const rateValueEl = document.getElementById('tts-rate-value');
  const voiceSelectEl = document.getElementById('tts-voice');
  if (!enabledEl || !turnTakingEl || !rateEl || !voiceSelectEl) return;

  const synth = window.speechSynthesis || null;
  const applyRateLabel = () => {
    if (!rateValueEl) return;
    const value = Number(rateEl.value || 1);
    rateValueEl.textContent = `${value.toFixed(2)}x`;
  };

  const renderVoices = () => {
    const storedVoiceUri = getVoiceTtsVoiceUri();
    const voices = synth?.getVoices?.() || [];
    voiceSelectEl.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'System default';
    voiceSelectEl.appendChild(defaultOpt);
    if (!voices.length) {
      const unavailableOpt = document.createElement('option');
      unavailableOpt.value = '';
      unavailableOpt.textContent = 'Voices unavailable';
      voiceSelectEl.appendChild(unavailableOpt);
      voiceSelectEl.value = '';
      return;
    }
    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI || '';
      const localTag = v.lang ? ` (${v.lang})` : '';
      opt.textContent = `${v.name || v.voiceURI || 'Voice'}${localTag}`;
      voiceSelectEl.appendChild(opt);
    });
    if (storedVoiceUri && voices.some((v) => v.voiceURI === storedVoiceUri)) {
      voiceSelectEl.value = storedVoiceUri;
    } else {
      voiceSelectEl.value = '';
    }
  };

  enabledEl.checked = getVoiceTtsEnabled();
  turnTakingEl.value = getVoiceTtsTurnTakingMode();
  rateEl.value = String(getVoiceTtsRate());
  applyRateLabel();
  renderVoices();

  if (!synth) {
    enabledEl.checked = false;
    enabledEl.disabled = true;
    turnTakingEl.disabled = true;
    rateEl.disabled = true;
    voiceSelectEl.disabled = true;
    setVoiceTtsEnabled(false);
    return;
  }

  enabledEl.addEventListener('change', () => {
    setVoiceTtsEnabled(Boolean(enabledEl.checked));
  });
  turnTakingEl.addEventListener('change', () => {
    setVoiceTtsTurnTakingMode(turnTakingEl.value);
  });
  rateEl.addEventListener('input', () => {
    setVoiceTtsRate(rateEl.value);
    applyRateLabel();
  });
  voiceSelectEl.addEventListener('change', () => {
    setVoiceTtsVoiceUri(voiceSelectEl.value || '');
  });
  synth.addEventListener?.('voiceschanged', renderVoices);
}

function initVoiceSpeechLanguageSettings() {
  const langSelectEl = document.getElementById('stt-language');
  if (!langSelectEl) return;
  const configured = getVoiceSpeechLanguage();
  if (configured !== 'auto') {
    const hasOption = Array.from(langSelectEl.options).some((o) => o.value === configured);
    langSelectEl.value = hasOption ? configured : 'auto';
    if (!hasOption) setVoiceSpeechLanguage('auto');
  } else {
    langSelectEl.value = 'auto';
  }
  langSelectEl.addEventListener('change', () => {
    setVoiceSpeechLanguage(langSelectEl.value);
    logVoiceDebug('voice:language:updated', {
      configured: getVoiceSpeechLanguage(),
      webspeech: resolveSpeechRecognitionLanguage(),
      whisperHint: resolveWhisperLanguageHint() || 'auto',
    });
  });
}

// ── Phase 1: quick mic-to-textarea ────────────────────────────────────────────

function initVoice() {
  const voiceBtn = document.getElementById('voice-btn');
  if (!voiceBtn) return;
  logVoiceDebug('quick:init');

  const sttMode = getVoiceSttMode();
  const radioEl = document.querySelector(`input[name="stt-mode"][value="${sttMode}"]`);
  if (radioEl && !radioEl.disabled) radioEl.checked = true;

  document.querySelectorAll('input[name="stt-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.disabled) setVoiceSttMode(radio.value);
    });
  });

  initVoiceSpeechLanguageSettings();

  voiceBtn.addEventListener('click', () => {
    logVoiceDebug('quick:click', { action: voiceRecording ? 'stop' : 'start' });
    if (voiceRecording) stopVoice();
    else if (!voiceStopping && !voiceTranscribing) startVoice();
  });

  initWhisperSettings();
  initVoiceTtsSettings();
}

async function startVoice() {
  if (voiceRecording || voiceStopping || voiceTranscribing) return;
  const voiceBtn = document.getElementById('voice-btn');
  const sessionId = ++voiceSessionId;
  const isActiveSession = () => sessionId === voiceSessionId;
  logVoiceDebug('quick:start:begin', { sessionId });
  clearVoiceMicReleaseTimer();

  let micStream = voiceMicStream;
  if (!hasLiveAudioTrack(micStream)) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      voiceMicStream = micStream;
      logVoiceDebug('quick:start:mic-granted', {
        sessionId,
        tracks: micStream?.getTracks?.().map((t) => ({ kind: t.kind, readyState: t.readyState })) || [],
      });
    } catch (e) {
      console.warn('Voice: mic access denied', e);
      logVoiceDebug('quick:start:mic-denied', { sessionId, error: e?.message || String(e) });
      return;
    }
  } else {
    logVoiceDebug('quick:start:mic-reused', { sessionId });
  }

  stopQuickPcmCaptureGraph();
  voiceQuickChunks = [];
  voiceQuickSampleRate = 16000;
  let audioCtx;
  let source;
  let workletNode;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await ensureVoiceWorkletModule(audioCtx);
    source = audioCtx.createMediaStreamSource(micStream);
    workletNode = new AudioWorkletNode(audioCtx, 'voice-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    workletNode.port.onmessage = (event) => {
      if (!voiceRecording || voiceStopping) return;
      const raw = event?.data;
      if (!raw) return;
      const channel = raw instanceof Float32Array ? raw : new Float32Array(raw);
      if (!channel.length) return;
      voiceQuickChunks.push(channel);
      if (voiceQuickChunks.length % 5 === 0) {
        logVoiceDebug('quick:data', {
          sessionId,
          chunks: voiceQuickChunks.length,
          chunkSize: channel.length,
          sampleRate: audioCtx.sampleRate,
        });
      }
    };
    source.connect(workletNode);
    voiceQuickAudioCtx = audioCtx;
    voiceQuickSourceNode = source;
    voiceQuickWorkletNode = workletNode;
    voiceQuickSampleRate = Number(audioCtx.sampleRate) || 16000;
  } catch (e) {
    console.error('Voice PCM graph init failed:', e);
    logVoiceDebug('quick:start:pcm-init-failed', { sessionId, error: e?.message || String(e) });
    stopQuickPcmCaptureGraph();
    return;
  }

  voiceMediaRecorder = null;
  voiceRecording = true;
  voiceStopping = false;
  voiceBtn?.classList.remove('transcribing');
  voiceBtn?.classList.add('recording');
  logVoiceDebug('quick:start:pcm-started', {
    sessionId,
    sampleRate: voiceQuickSampleRate,
    captureNode: 'AudioWorkletNode',
  });
}

function stopVoice() {
  const sessionId = voiceSessionId;
  const isActiveSession = () => sessionId === voiceSessionId;
  if (!voiceRecording || !voiceQuickWorkletNode) {
    voiceRecording = false;
    voiceStopping = false;
    logVoiceDebug('quick:stop:no-active-capture', { sessionId });
    return;
  }
  const voiceBtn = document.getElementById('voice-btn');
  voiceStopping = true;
  voiceRecording = false;
  voiceBtn?.classList.remove('recording');
  logVoiceDebug('quick:stop:requested', { sessionId, chunks: voiceQuickChunks.length });

  const chunks = voiceQuickChunks.slice();
  const sourceRate = voiceQuickSampleRate;
  stopQuickPcmCaptureGraph();
  logVoiceDebug('quick:stop:capture-closed', { sessionId, chunks: chunks.length, sourceRate });

  if (!isActiveSession()) return;
  if (chunks.length === 0) {
    voiceStopping = false;
    scheduleVoiceMicRelease('empty-chunks');
    logVoiceDebug('quick:stop:empty', { sessionId });
    return;
  }

  voiceTranscribing = true;
  voiceBtn?.classList.add('transcribing');
  (async () => {
    try {
      const pcm = concatFloat32(chunks);
      const audio = resampleFloat32Linear(pcm, sourceRate, 16000);
      const whisperLanguageHint = resolveWhisperLanguageHint();
      logVoiceDebug('quick:transcribe:start', {
        sessionId,
        languageConfigured: getVoiceSpeechLanguage(),
        whisperLanguageHint: whisperLanguageHint || 'auto',
      });
      const result = await window.mdviewer?.whisperTranscribe?.({
        audioData: audio.buffer,
        sampleRate: 16000,
        languageHint: whisperLanguageHint || undefined,
      });
      logVoiceDebug('quick:transcribe:done', {
        sessionId,
        hasText: Boolean(result?.text),
        error: result?.error || '',
      });
      const spoken = String(result?.text || '').trim();
      if (spoken && chatInput) {
        const draft = String(chatInput.value || '');
        const hasDraft = Boolean(draft.trim());
        const providerReady = Boolean(chatModelSelect?.value && getSelectedProvider());
        const canAutoSend = !hasDraft && !chatSending && providerReady;

        if (canAutoSend) {
          chatInput.value = spoken;
          autoResizeTextarea(chatInput);
          logVoiceDebug('quick:transcribe:autosend', { sessionId, mode: 'send' });
          sendChatMessage().catch(() => {
            // If send fails for any reason, keep the text in the input so it's not lost.
            chatInput.value = spoken;
            autoResizeTextarea(chatInput);
            logVoiceDebug('quick:transcribe:autosend', { sessionId, mode: 'send-failed' });
          });
        } else {
          const base = draft.trimEnd();
          chatInput.value = base + (base ? ' ' : '') + spoken;
          autoResizeTextarea(chatInput);
          logVoiceDebug('quick:transcribe:autosend', {
            sessionId,
            mode: 'append',
            reason: hasDraft ? 'draft-present' : (!providerReady ? 'no-model' : (chatSending ? 'chat-sending' : 'unknown')),
          });
        }
      } else if (result?.error) {
        console.warn('Whisper transcription error:', result.error);
      }
    } catch (e) {
      console.error('Voice transcription failed:', e);
      logVoiceDebug('quick:transcribe:error', { sessionId, error: e?.message || String(e) });
    } finally {
      if (!isActiveSession()) return;
      voiceTranscribing = false;
      voiceStopping = false;
      voiceBtn?.classList.remove('transcribing');
      scheduleVoiceMicRelease('transcribe-finished', 0);
      logVoiceDebug('quick:transcribe:finalize', { sessionId });
    }
  })();
}

// ── Phase 3: VoiceMode overlay (full-screen conversation UI) ─────────────────

class VoiceMode {
  constructor() {
    this.overlay = document.getElementById('voice-overlay');
    this.waveformEl = document.getElementById('voice-waveform');
    this.subtitlesEl = document.getElementById('voice-subtitles');
    this.statusEl = document.getElementById('voice-status');
    this.stopSpeakingBtn = document.getElementById('voice-stop-speaking-btn');
    this.closeBtn = document.getElementById('voice-overlay-close');

    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.micStream = null;
    this.animFrame = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.closed = true;
    this.pendingClose = false;
    this._closeFinalized = false;
    this.isAiThinking = false;
    this.recognition = null;
    this.webSpeechListening = false;
    this.forceWhisperInOverlay = false;
    this.captureNode = null;
    this.pcmChunks = [];
    this.pcmSampleRate = 16000;
    this.captureStopping = false;
    this._captureSessionSeq = 0;
    this._activeCaptureSession = 0;
    this._listeningRestartTimer = null;
    this.lastNoSpeechSubtitleEl = null;
    this.noSpeechStreak = 0;
    this.bars = [];
    this.ttsQueue = new SystemTtsQueue();
    this._suppressTtsForCurrentTurn = false;

    // Silence detection state (reset each recording session)
    this._silenceFrames = 0;
    this._voiceFrames = 0;
    this._hasVoice = false;
    this._noiseFloor = 0.01;
    this._captureFrames = 0;
    this._lastVadDebugTs = 0;

    this._buildWaveform();
    logVoiceDebug('overlay:init');
    this.ttsQueue.onSpeakingChange((isSpeaking) => {
      this._setStopSpeakingVisible(Boolean(isSpeaking) && !this.closed);
    });
    this.stopSpeakingBtn?.addEventListener('click', () => {
      this._suppressTtsForCurrentTurn = true;
      this.ttsQueue.cancel();
      this._setStopSpeakingVisible(false);
      logVoiceDebug('overlay:tts:stop-click');
    });
    this.closeBtn?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.closed) this.close();
    });
  }

  _buildWaveform() {
    if (!this.waveformEl) return;
    for (let i = 0; i < 32; i++) {
      const bar = document.createElement('div');
      bar.className = 'wf-bar';
      this.waveformEl.appendChild(bar);
      this.bars.push(bar);
    }
  }

  _clearListeningRestart() {
    if (!this._listeningRestartTimer) return;
    clearTimeout(this._listeningRestartTimer);
    this._listeningRestartTimer = null;
  }

  _scheduleListeningRestart(reason, delayMs = 500) {
    this._clearListeningRestart();
    this._listeningRestartTimer = setTimeout(() => {
      this._listeningRestartTimer = null;
      if (this.closed || this.pendingClose) return;
      this._startListening();
    }, Math.max(0, Number(delayMs) || 0));
    logVoiceDebug('overlay:listen:restart-scheduled', { reason, delayMs: Math.max(0, Number(delayMs) || 0) });
  }

  _resetCaptureState(resetNoiseFloor = true) {
    this._hasVoice = false;
    this._voiceFrames = 0;
    this._silenceFrames = 0;
    this._captureFrames = 0;
    this._lastVadDebugTs = 0;
    if (resetNoiseFloor) this._noiseFloor = 0.01;
    this.captureStopping = false;
    this.pcmChunks = [];
    this.pcmSampleRate = 16000;
    this._activeCaptureSession = 0;
  }

  _syncTtsSettings() {
    this.ttsQueue.configure({
      enabled: getVoiceTtsEnabled(),
      rate: getVoiceTtsRate(),
      voiceUri: getVoiceTtsVoiceUri(),
    });
    if (!getVoiceTtsEnabled()) this._setStopSpeakingVisible(false);
  }

  _setStopSpeakingVisible(visible) {
    if (!this.stopSpeakingBtn) return;
    this.stopSpeakingBtn.classList.toggle('hidden', !visible);
  }

  async open() {
    if (!this.overlay) return;
    if (!this.closed) return;
    this.pendingClose = false;
    this._closeFinalized = false;
    this.forceWhisperInOverlay = false;
    this._clearListeningRestart();
    this._resetCaptureState(true);
    this._syncTtsSettings();
    this.closed = false;
    if (this.subtitlesEl) this.subtitlesEl.innerHTML = '';
    this.overlay.classList.remove('hidden');
    this._setStatus('Listening...');
    logVoiceDebug('overlay:open');
    await this._initAudio();
    this._startListening();
  }

  close() {
    logVoiceDebug('overlay:close:begin', {
      recorderState: this.mediaRecorder?.state || 'none',
      hasMicStream: Boolean(this.micStream),
      hasAudioCtx: Boolean(this.audioCtx),
    });
    this.closed = true;
    this.pendingClose = true;
    this._clearListeningRestart();
    this.ttsQueue.cancel();
    this._setStopSpeakingVisible(false);
    const stopRequested = this._stopListening();
    if (!stopRequested) this._finalizeClose();
  }

  _finalizeClose() {
    if (this._closeFinalized) return;
    this._closeFinalized = true;
    this.pendingClose = false;
    this._clearListeningRestart();
    this.ttsQueue.cancel();
    this._setStopSpeakingVisible(false);
    this._resetCaptureState(true);
    this._stopAudio();
    this.overlay?.classList.add('hidden');
    logVoiceDebug('overlay:close:finalize');
    renderChatMessages();
    scrollChatToShowPromptAtTop();
    saveChatMessages();
  }

  async _initAudio() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      this.sourceNode = source;
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.75;
      source.connect(this.analyser);
      await ensureVoiceWorkletModule(this.audioCtx);
      this._animateWaveform();
      logVoiceDebug('overlay:audio:init-ok', {
        tracks: this.micStream?.getTracks?.().map((t) => ({ kind: t.kind, readyState: t.readyState })) || [],
      });
    } catch (e) {
      console.warn('VoiceMode: mic access denied', e);
      this._setStatus('Microphone access denied');
      logVoiceDebug('overlay:audio:init-failed', { error: e?.message || String(e) });
    }
  }

  _stopAudio() {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    if (this.captureNode) {
      try { this.captureNode.disconnect(); } catch (_) {}
      this.captureNode = null;
    }
    try { this.sourceNode?.disconnect(); } catch (_) {}
    this.micStream?.getTracks().forEach((t) => t.stop());
    try { this.audioCtx?.close(); } catch (_) {}
    this.audioCtx = null;
    this.analyser = null;
    this.sourceNode = null;
    this.micStream = null;
    this._activeCaptureSession = 0;
    this.captureStopping = false;
    this.pcmChunks = [];
    logVoiceDebug('overlay:audio:stopped');
  }

  _animateWaveform() {
    const data = new Uint8Array(32);
    const timeData = new Uint8Array(64);
    // Silence detection constants
    const SILENCE_FRAMES_STOP = 96; // ~1.6s at ~60fps
    const MIN_VOICE_FRAMES = 12;    // require at least ~0.20s of speech
    const MIN_CAPTURE_FRAMES_BEFORE_STOP = 54; // ~0.9s guard against short pauses
    const MAX_CAPTURE_FRAMES = 660; // ~11s hard cap per utterance
    const VAD_DEBUG_INTERVAL_MS = 1200;

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      this.analyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const centered = (timeData[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, timeData.length));

      // Silence detection — only while actively recording a user utterance
      if (!this.isAiThinking && this.captureNode) {
        this._captureFrames += 1;
        const adaptiveThreshold = Math.max(0.01, Math.min(0.06, this._noiseFloor * 2.2 + 0.006));
        const isSpeech = rms > adaptiveThreshold;
        if (!isSpeech) {
          this._noiseFloor = this._noiseFloor * 0.985 + rms * 0.015;
        }
        const now = Date.now();
        if (now - this._lastVadDebugTs >= VAD_DEBUG_INTERVAL_MS) {
          this._lastVadDebugTs = now;
          logVoiceDebug('overlay:vad:tick', {
            rms: Number(rms.toFixed(4)),
            threshold: Number(adaptiveThreshold.toFixed(4)),
            noiseFloor: Number(this._noiseFloor.toFixed(4)),
            isSpeech,
            captureFrames: this._captureFrames,
            silenceFrames: this._silenceFrames,
            voiceFrames: this._voiceFrames,
            sourceRate: this.pcmSampleRate || 0,
          });
        }
        if (isSpeech) {
          this._hasVoice = true;
          this._voiceFrames++;
          this._silenceFrames = 0;
        } else {
          this._silenceFrames++;
          if (
            this._hasVoice &&
            this._voiceFrames >= MIN_VOICE_FRAMES &&
            this._captureFrames >= MIN_CAPTURE_FRAMES_BEFORE_STOP &&
            this._silenceFrames >= SILENCE_FRAMES_STOP
          ) {
            this._voiceFrames = 0;
            this._silenceFrames = 0;
            if (this.captureNode) this._stopWhisperCaptureAndTranscribe();
          }
        }
        if (this._captureFrames >= MAX_CAPTURE_FRAMES && this.captureNode) {
          logVoiceDebug('overlay:recording:max-duration', { frames: this._captureFrames });
          this._stopWhisperCaptureAndTranscribe();
        }
      }

      const t = Date.now() / 500;
      this.bars.forEach((bar, i) => {
        let h;
        if (this.isAiThinking) {
          h = 12 + Math.sin(t + i * 0.5) * 10 + Math.sin(t * 1.7 + i * 0.3) * 5;
        } else {
          h = Math.max(4, (data[i] / 255) * 76);
        }
        bar.style.height = Math.round(h) + 'px';
      });
      this.animFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  _startListening() {
    if (this.closed || this.isAiThinking || !this.micStream) return;
    this._clearListeningRestart();
    const sttMode = this.forceWhisperInOverlay ? 'whisper' : getVoiceSttMode();
    if (sttMode === 'webspeech') {
      this._startListeningWebSpeech();
      return;
    }

    this._resetCaptureState(true);
    this._setStatus('Listening...');
    try {
      const captureSessionId = ++this._captureSessionSeq;
      const node = new AudioWorkletNode(this.audioCtx, 'voice-capture-processor');
      node.port.onmessage = (evt) => {
        if (this.closed || this.captureStopping) return;
        if (captureSessionId !== this._activeCaptureSession) return;
        if (this.captureNode !== node) return;
        const channel = evt?.data;
        if (!(channel instanceof Float32Array) || channel.length === 0) return;
        this.pcmChunks.push(channel);
      };
      this.sourceNode?.connect(node);
      this._activeCaptureSession = captureSessionId;
      this.captureNode = node;
      this.pcmSampleRate = Number(this.audioCtx?.sampleRate) || 16000;
      logVoiceDebug('overlay:recording:start', {
        captureSessionId,
        captureNode: 'AudioWorkletNode',
        sampleRate: this.pcmSampleRate,
      });
    } catch (e) {
      console.error('VoiceMode PCM capture start error:', e);
      logVoiceDebug('overlay:recording:start-error', { error: e?.message || String(e) });
      this._setStatus('Voice capture failed');
      this._scheduleListeningRestart('capture-start-error', 600);
    }
  }

  _startListeningWebSpeech() {
    if (this.closed || this.isAiThinking || !this.micStream || this.webSpeechListening) return;
    const RecognitionCtor = getSpeechRecognitionCtor();
    if (!RecognitionCtor) {
      this._addSubtitle('assistant', '⚠️ Web Speech API is not available in this runtime.');
      this._setStatus('Speech API unavailable');
      return;
    }

    this._setStatus('Listening...');
    this.webSpeechListening = true;
    let finalText = '';
    let interimText = '';
    const userSubEl = this._addSubtitle('user', '…');
    const recognition = new RecognitionCtor();
    this.recognition = recognition;
    const configuredLang = getVoiceSpeechLanguage();
    recognition.lang = resolveSpeechRecognitionLanguage();
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      let nextFinal = finalText;
      let nextInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = String(result?.[0]?.transcript || '').trim();
        if (!transcript) continue;
        if (result.isFinal) nextFinal += (nextFinal ? ' ' : '') + transcript;
        else nextInterim += (nextInterim ? ' ' : '') + transcript;
      }
      finalText = nextFinal.trim();
      interimText = nextInterim.trim();
      userSubEl.textContent = finalText || interimText || '…';
    };

    recognition.onerror = (event) => {
      const errType = String(event?.error || '').trim();
      logVoiceDebug('overlay:webspeech:error', {
        error: errType || 'unknown',
        message: event?.message || '',
      });
      // Electron's file:// context often returns SpeechRecognition "network".
      // Fall back to local Whisper for this overlay session so conversation still works.
      if (errType === 'network') {
        this.forceWhisperInOverlay = true;
        this._setStatus('System STT unavailable. Switching to local Whisper...');
        return;
      }
      if (errType && errType !== 'no-speech' && errType !== 'aborted') {
        userSubEl.textContent = `⚠️ ${errType}`;
      }
    };

    recognition.onend = async () => {
      const text = (finalText || interimText || '').trim();
      this.webSpeechListening = false;
      if (this.recognition === recognition) this.recognition = null;
      logVoiceDebug('overlay:webspeech:end', {
        pendingClose: this.pendingClose,
        closed: this.closed,
        hasText: Boolean(text),
      });

      if (this.pendingClose || this.closed) {
        this._finalizeClose();
        return;
      }

      if (!text) {
        userSubEl.remove();
        this._setStatus('Listening...');
        this._scheduleListeningRestart('webspeech-empty', 300);
        return;
      }

      userSubEl.textContent = text;
      try {
        await this._sendToAi(text);
      } catch (e) {
        logVoiceDebug('overlay:webspeech:send:error', { error: e?.message || String(e) });
        this._setStatus('Listening...');
        this._scheduleListeningRestart('webspeech-send-error', 500);
      }
    };

    try {
      recognition.start();
      logVoiceDebug('overlay:webspeech:start', {
        lang: recognition.lang,
        configuredLang,
      });
    } catch (e) {
      this.webSpeechListening = false;
      this.recognition = null;
      userSubEl.textContent = '⚠️ Failed to start speech recognition';
      logVoiceDebug('overlay:webspeech:start:error', { error: e?.message || String(e) });
      this._setStatus('Listening...');
      this._scheduleListeningRestart('webspeech-start-error', 500);
    }
  }

  _stopListening() {
    if (this.webSpeechListening && this.recognition) {
      try { this.recognition.abort(); } catch (_) {}
      this.webSpeechListening = false;
      logVoiceDebug('overlay:webspeech:stop-requested');
      return true;
    }
    if (this.captureNode) {
      this._stopWhisperCaptureAndTranscribe();
      logVoiceDebug('overlay:recording:stop-requested');
      return true;
    }
    this.mediaRecorder = null;
    logVoiceDebug('overlay:recording:no-active');
    return false;
  }

  async _stopWhisperCaptureAndTranscribe() {
    if (this.captureStopping) return;
    this.captureStopping = true;
    const captureSessionId = this._activeCaptureSession;
    this._activeCaptureSession = 0;
    if (this.captureNode) {
      try { this.captureNode.disconnect(); } catch (_) {}
      this.captureNode = null;
    }
    const chunks = this.pcmChunks.slice();
    this.pcmChunks = [];
    const sourceRate = this.pcmSampleRate || 16000;
    const totalSamples = chunks.reduce((acc, c) => acc + (c?.length || 0), 0);
    const durationSec = totalSamples > 0 ? (totalSamples / sourceRate) : 0;
    logVoiceDebug('overlay:onstop', {
      captureSessionId,
      pendingClose: this.pendingClose,
      closed: this.closed,
      hasVoice: this._hasVoice,
      chunks: chunks.length,
      durationSec: Number(durationSec.toFixed(2)),
    });
    if (this.pendingClose || this.closed) {
      this.captureStopping = false;
      this._finalizeClose();
      return;
    }
    if (!this._hasVoice || chunks.length === 0) {
      this.captureStopping = false;
      this._scheduleListeningRestart('whisper-no-voice', 300);
      return;
    }
    if (durationSec < 0.7) {
      this.captureStopping = false;
      this._addSubtitle('user', '… (too short)');
      this._setStatus('Listening...');
      this._scheduleListeningRestart('whisper-too-short', 350);
      return;
    }
    await this._transcribeAndSendPcm(chunks, this.pcmSampleRate, captureSessionId);
    this.captureStopping = false;
  }

  async _transcribeAndSendPcm(chunks, sourceRate, captureSessionId = 0) {
    this._setStatus('Transcribing...');

    const userSubEl = this._addSubtitle('user', '…');

    try {
      const pcm = concatFloat32(chunks);
      const audio = normalizePcmForWhisper(resampleFloat32Linear(pcm, sourceRate || 16000, 16000));
      const whisperLanguageHint = resolveWhisperLanguageHint();
      logVoiceDebug('overlay:transcribe:start', {
        captureSessionId,
        chunks: chunks.length,
        sourceRate: sourceRate || 16000,
        samples16k: audio.length,
        languageConfigured: getVoiceSpeechLanguage(),
        whisperLanguageHint: whisperLanguageHint || 'auto',
      });
      const result = await window.mdviewer?.whisperTranscribe?.({
        audioData: audio.buffer,
        sampleRate: 16000,
        languageHint: whisperLanguageHint || undefined,
      });
      logVoiceDebug('overlay:transcribe:done', {
        captureSessionId,
        chunks: chunks.length,
        sourceRate: sourceRate || 16000,
        samples16k: audio.length,
        durationSec: Number((audio.length / 16000).toFixed(2)),
        hasText: Boolean(result?.text && String(result.text).trim()),
        error: result?.error || '',
      });

      if (result?.error) {
        this.lastNoSpeechSubtitleEl = null;
        this.noSpeechStreak = 0;
        userSubEl.textContent = '⚠️ ' + result.error;
        this._setStatus('Listening...');
        this._scheduleListeningRestart('transcribe-error-result', 500);
        return;
      }

      if (this.pendingClose || this.closed) {
        this._finalizeClose();
        return;
      }

      const text = result?.text?.trim();
      if (!text || this._looksLikeNonSpeechText(text)) {
        this.noSpeechStreak += 1;
        if (this.lastNoSpeechSubtitleEl && this.lastNoSpeechSubtitleEl.isConnected) {
          userSubEl.remove();
          const suffix = this.noSpeechStreak > 1 ? ` ×${this.noSpeechStreak}` : '';
          this.lastNoSpeechSubtitleEl.textContent = `… (no speech recognized)${suffix}`;
        } else {
          this.lastNoSpeechSubtitleEl = userSubEl;
          const suffix = this.noSpeechStreak > 1 ? ` ×${this.noSpeechStreak}` : '';
          userSubEl.textContent = `… (no speech recognized)${suffix}`;
        }
        this._setStatus('Listening...');
        this._scheduleListeningRestart('transcribe-no-speech', 450);
        return;
      }

      this.lastNoSpeechSubtitleEl = null;
      this.noSpeechStreak = 0;
      userSubEl.textContent = text;
      await this._sendToAi(text);
    } catch (e) {
      console.error('VoiceMode transcription error:', e);
      logVoiceDebug('overlay:transcribe:error', { error: e?.message || String(e) });
      userSubEl.textContent = '⚠️ Transcription failed';
      this._setStatus('Listening...');
      this._scheduleListeningRestart('transcribe-exception', 500);
    }
  }

  _looksLikeNonSpeechText(text) {
    const t = String(text || '').trim();
    if (!t) return true;
    const low = t.toLowerCase();
    if (/(^|\s)\[?sounds? of .*?\]?($|\s)/i.test(t)) return true;
    if (/glass breaking|applause|laughter|music|background noise|silence/i.test(low)) return true;
    const bracketed = (t.match(/\[[^\]]+\]/g) || []).length;
    if (bracketed >= 2) return true;
    const alphaChars = (t.match(/[a-zа-яё]/giu) || []).join('');
    if (alphaChars.length >= 36) {
      const uniq = new Set(alphaChars.toLowerCase().split(''));
      if (uniq.size <= 3) return true;
    }
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length >= 12) {
      const oneCharTokens = tokens.filter((tok) => {
        const clean = tok.replace(/[^a-zа-яё]/giu, '');
        return clean.length === 1;
      }).length;
      if (oneCharTokens / tokens.length >= 0.72) return true;
    }
    if (/([a-zа-яё])(?:\s*\1){12,}/iu.test(t)) return true;
    return false;
  }

  async _sendToAi(text) {
    this._syncTtsSettings();
    this._suppressTtsForCurrentTurn = false;
    this.isAiThinking = true;
    this._setStatus('Thinking...');

    const providerId = chatModelSelect?.value;
    const provider = getSelectedProvider();
    if (!providerId || !provider) {
      this._addSubtitle('assistant', '⚠️ No model selected. Please select a model first.');
      this.isAiThinking = false;
      this._setStatus('Listening...');
      if (!this.closed) this._scheduleListeningRestart('no-provider', 600);
      return;
    }

    chatMessagesData.push({ role: 'user', content: text });

    const contextPack = await buildKnowledgebaseContextForPrompt(text).catch(() => ({ contextDocuments: [], references: [] }));
    const messages = this._applyVoiceResponseStyle(buildMessagesForApi(provider));
    const contextWindow = {
      maxContextLength: toInt(provider.maxContextLength),
      loadedContextLength: toInt(provider.loadedContextLength),
      effectiveContextLength: getProviderEffectiveContextLength(provider),
      maxOutputTokens: getProviderReservedOutputTokens(provider),
    };

    let accumulated = '';
    let hadStreamChunks = false;
    const aiSubEl = this._addSubtitle('assistant', '');

    const onDone = async (result) => {
      if (result?.error) {
        this.ttsQueue.cancel();
        this._setStopSpeakingVisible(false);
        aiSubEl.textContent = '⚠️ ' + (result.error || 'Error');
        const idx = chatMessagesData.findLastIndex?.((m) => m.role === 'user' && m.content === text) ?? -1;
        if (idx !== -1) chatMessagesData.splice(idx, 1);
      } else {
        this._renderAssistantSubtitleMarkdown(aiSubEl, accumulated || aiSubEl.textContent || '');
        if (!this._suppressTtsForCurrentTurn) {
          if (!hadStreamChunks && accumulated) this.ttsQueue.appendMarkdownDelta(accumulated);
          this.ttsQueue.flushFinal();
        }
        chatMessagesData.push({ role: 'assistant', content: accumulated });
        await saveChatMessages();
      }
      this.isAiThinking = false;
      if (this.closed) return;
      if (this.ttsQueue.isEnabled()) {
        this._setStatus('Speaking...');
        await this.ttsQueue.waitForIdle();
        if (this.closed) return;
      }
      this._setStatus('Listening...');
      this._scheduleListeningRestart('assistant-turn-done', 120);
    };

    streamChunkHandler = (chunk) => {
      hadStreamChunks = true;
      accumulated += chunk;
      if (!this._suppressTtsForCurrentTurn) this.ttsQueue.appendMarkdownDelta(chunk);
      aiSubEl.textContent = accumulated;
      if (this.subtitlesEl) {
        this.subtitlesEl.scrollTop = this.subtitlesEl.scrollHeight;
      }
    };
    streamDoneHandler = onDone;

    try {
      const res = await window.mdviewer?.chatCompletionStream?.({
        providerId, messages, contextDocuments: contextPack.contextDocuments, contextWindow,
      });
      if (res?.error) {
        streamChunkHandler = null;
        streamDoneHandler = null;
        const nonStream = await window.mdviewer?.chatCompletion?.({
          providerId, messages, contextDocuments: contextPack.contextDocuments, contextWindow,
        }).catch((e) => ({ error: e.message }));
        accumulated = nonStream?.content || '';
        await onDone(nonStream?.error ? { error: nonStream.error } : {});
      }
    } catch (e) {
      streamChunkHandler = null;
      streamDoneHandler = null;
      await onDone({ error: e.message });
    }
  }

  _addSubtitle(role, text) {
    const el = document.createElement('div');
    el.className = 'voice-sub voice-sub-' + role;
    el.textContent = text;
    this.subtitlesEl?.appendChild(el);
    this._pruneSubtitleHistory(48);
    if (this.subtitlesEl) {
      requestAnimationFrame(() => {
        if (!this.subtitlesEl) return;
        this.subtitlesEl.scrollTop = this.subtitlesEl.scrollHeight;
      });
    }
    return el;
  }

  _renderAssistantSubtitleMarkdown(el, text) {
    if (!el) return;
    const raw = String(text || '').trim();
    if (!raw) {
      el.textContent = '';
      return;
    }
    const mdWrap = document.createElement('div');
    mdWrap.className = 'voice-sub-md markdown-body';
    const normalized = normalizeMathMarkdown(closeOpenCodeFences(raw));
    mdWrap.innerHTML = markedLib.parse(normalized);
    renderMathInContainer(mdWrap);
    el.innerHTML = '';
    el.appendChild(mdWrap);
  }

  _applyVoiceResponseStyle(messages) {
    const out = (messages || []).map((m) => ({ ...m }));
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (out[i].role !== 'user') continue;
      const base = String(out[i].content || '').trim();
      out[i].content =
        `Voice mode response style:\n` +
        `- Sound natural and human, like spoken conversation.\n` +
        `- Do NOT use emojis, emoticons, or decorative symbols.\n` +
        `- Keep answers concise and easy to listen to: usually 2-5 short sentences.\n` +
        `- Prefer plain text sentence flow optimized for speech.\n` +
        `- Avoid heavy markdown. No tables, no long lists, no long headings.\n` +
        `- Avoid code blocks unless the user explicitly asks for code.\n` +
        `- If formatting is needed, use minimal markdown only.\n` +
        `- Prioritize clarity when spoken aloud over visual formatting.\n\n` +
        `User message:\n${base}`;
      break;
    }
    return out;
  }

  _pruneSubtitleHistory(maxItems = 48) {
    if (!this.subtitlesEl) return;
    while (this.subtitlesEl.children.length > maxItems) {
      const first = this.subtitlesEl.firstElementChild;
      if (!first) break;
      if (first === this.lastNoSpeechSubtitleEl) this.lastNoSpeechSubtitleEl = null;
      first.remove();
    }
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }
}

function initVoiceMode() {
  document.getElementById('speak-with-doc-btn')?.addEventListener('click', () => {
    openSpeakTab();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
initTheme();
initSettingsGroups();
initAiSettings();
initChatTab();
initVoice();
initVoiceMode();
window.addEventListener('error', (e) => {
  logVoiceDebug('window:error', {
    message: e?.message || '',
    source: e?.filename || '',
    line: e?.lineno || 0,
    column: e?.colno || 0,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e?.reason;
  logVoiceDebug('window:unhandledrejection', {
    reason: reason?.message || String(reason || ''),
  });
});
window.addEventListener('beforeunload', () => {
  releaseVoiceMicStream('beforeunload');
});
window.mdviewer?.onKbImportProgress?.(handleKbImportProgress);
kbHelpBtn?.addEventListener('click', openKnowledgebaseHelpTab);
kbImportFileBtn?.addEventListener('click', importKnowledgebaseFile);
kbImportFolderBtn?.addEventListener('click', importKnowledgebaseFolder);
kbClearAllBtn?.addEventListener('click', clearKnowledgebaseAll);
document.getElementById('talk-to-doc-btn')?.addEventListener('click', () => {
  openChatTab();
});
document.getElementById('header-settings-btn')?.addEventListener('click', () => {
  openSettings();
});
tabsNewBtn?.addEventListener('click', () => {
  openEmptyTab();
});
tabsOverflowBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  tabsOverflowMenu?.classList.toggle('hidden');
});
document.addEventListener('click', () => {
  tabsOverflowMenu?.classList.add('hidden');
});
window.addEventListener('resize', () => {
  updateTabsOverflowControls();
});
updateTalkToDocButton();
restoreOpenTabs();
