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
  getPathForFile: (file) => {
    if (!file) return '';
    try {
      return (webUtils?.getPathForFile?.(file)) || file.path || '';
    } catch (_) {
      return file.path || '';
    }
  },
});
