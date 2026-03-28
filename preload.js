const { contextBridge, ipcRenderer } = require('electron');
let webUtils;
try { webUtils = require('electron').webUtils; } catch (_) {}

// marked, mermaid, hljs loaded via script tags (ESM/require issues in preload)

contextBridge.exposeInMainWorld('mdviewer', {
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  readDir: (path) => ipcRenderer.invoke('read-dir', path),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_, path) => cb(path)),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_, paths) => cb(paths)),
  onOpenFolder: (cb) => ipcRenderer.on('open-folder', (_, path) => cb(path)),
  onPdfImportProgress: (cb) => ipcRenderer.on('pdf-import-progress', (_, payload) => cb(payload)),
  onPdfImportDone: (cb) => ipcRenderer.on('pdf-import-done', (_, payload) => cb(payload)),
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  setDefaultMdApp: () => ipcRenderer.invoke('set-default-md-app'),
  importPdf: (filePath) => ipcRenderer.invoke('import-pdf', filePath),
  showFolderDialog: () => ipcRenderer.invoke('show-folder-dialog'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showTabContextMenu: (index) => ipcRenderer.invoke('show-tab-context-menu', index),
  onTabContextAction: (cb) => ipcRenderer.on('tab-context-action', (_, data) => cb(data)),
  getAiConfig: () => ipcRenderer.invoke('get-ai-config'),
  saveAiConfig: (config) => ipcRenderer.invoke('save-ai-config', config),
  chatCompletion: (args) => ipcRenderer.invoke('chat-completion', args),
  chatCompletionStream: (args) => ipcRenderer.invoke('chat-completion-stream', args),
  onChatStreamChunk: (cb) => ipcRenderer.on('chat-stream-chunk', (_, chunk) => cb(chunk)),
  onChatStreamDone: (cb) => ipcRenderer.on('chat-stream-done', (_, result) => cb(result)),
  getChatMessages: () => ipcRenderer.invoke('get-chat-messages'),
  saveChatMessages: (messages) => ipcRenderer.invoke('save-chat-messages', messages),
  getChatSessions: () => ipcRenderer.invoke('get-chat-sessions'),
  saveChatSessions: (data) => ipcRenderer.invoke('save-chat-sessions', data),
  getOpenTabs: () => ipcRenderer.invoke('get-open-tabs'),
  saveOpenTabs: (state) => ipcRenderer.invoke('save-open-tabs', state),
  fetchLmStudioModels: (baseUrl) => ipcRenderer.invoke('fetch-lmstudio-models', baseUrl),
  checkLmStudioAvailability: (baseUrl) => ipcRenderer.invoke('check-lmstudio-availability', baseUrl),
  fetchOllamaModels: (baseUrl) => ipcRenderer.invoke('fetch-ollama-models', baseUrl),
  checkOllamaAvailability: (baseUrl) => ipcRenderer.invoke('check-ollama-availability', baseUrl),
  getOllamaRemovalInfo: (args) => ipcRenderer.invoke('get-ollama-removal-info', args),
  shutdownOllama: (args) => ipcRenderer.invoke('shutdown-ollama', args),
  startOllamaAutosetup: (args) => ipcRenderer.invoke('start-ollama-autosetup', args),
  uninstallOllama: (args) => ipcRenderer.invoke('uninstall-ollama', args),
  onOllamaSetupProgress: (cb) => ipcRenderer.on('ollama-setup-progress', (_, payload) => cb(payload)),
  onOllamaSetupDone: (cb) => ipcRenderer.on('ollama-setup-done', (_, payload) => cb(payload)),
  onOllamaDebug: (cb) => ipcRenderer.on('ollama-debug', (_, payload) => cb(payload)),
  fetchOpenAIModels: (apiKey) => ipcRenderer.invoke('fetch-openai-models', apiKey),
  fetchAnthropicModels: (apiKey) => ipcRenderer.invoke('fetch-anthropic-models', apiKey),
  fetchGoogleModels: (apiKey) => ipcRenderer.invoke('fetch-google-models', apiKey),
  kbGetDocumentStatus: (args) => ipcRenderer.invoke('kb-get-document-status', args),
  kbAddDocument: (args) => ipcRenderer.invoke('kb-add-document', args),
  kbDeleteDocument: (args) => ipcRenderer.invoke('kb-delete-document', args),
  kbListDocuments: () => ipcRenderer.invoke('kb-list-documents'),
  kbBuildContext: (args) => ipcRenderer.invoke('kb-build-context', args),
  kbImportFileDialog: () => ipcRenderer.invoke('kb-import-file-dialog'),
  kbImportFolderDialog: () => ipcRenderer.invoke('kb-import-folder-dialog'),
  kbClearAll: () => ipcRenderer.invoke('kb-clear-all'),
  onKbImportProgress: (cb) => ipcRenderer.on('kb-import-progress', (_, payload) => cb(payload)),
  whisperGetStatus: () => ipcRenderer.invoke('whisper-get-status'),
  whisperPreload: () => ipcRenderer.invoke('whisper-preload'),
  whisperTranscribe: (args) => ipcRenderer.invoke('whisper-transcribe', args),
  onWhisperProgress: (cb) => ipcRenderer.on('whisper-progress', (_, p) => cb(p)),
  voiceDebug: (payload) => ipcRenderer.send('voice-debug', payload),
  getPathForFile: (file) => {
    if (!file) return '';
    try {
      return (webUtils?.getPathForFile?.(file)) || file.path || '';
    } catch (_) {
      return file.path || '';
    }
  },
});
