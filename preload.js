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
  onOpenSettings: (cb) => ipcRenderer.on('open-settings', () => cb()),
  setDefaultMdApp: () => ipcRenderer.invoke('set-default-md-app'),
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
  fetchOpenAIModels: (apiKey) => ipcRenderer.invoke('fetch-openai-models', apiKey),
  fetchAnthropicModels: (apiKey) => ipcRenderer.invoke('fetch-anthropic-models', apiKey),
  fetchGoogleModels: (apiKey) => ipcRenderer.invoke('fetch-google-models', apiKey),
  getPathForFile: (file) => {
    if (!file) return '';
    try {
      return (webUtils?.getPathForFile?.(file)) || file.path || '';
    } catch (_) {
      return file.path || '';
    }
  },
});
