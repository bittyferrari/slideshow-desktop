const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 設定頁用
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  listImages: (dir, recursive) => ipcRenderer.invoke('list-images', dir, recursive),
  startSlideshow: (config) => ipcRenderer.invoke('start-slideshow', config),

  // 播放頁用
  exitSlideshow: () => ipcRenderer.invoke('exit-slideshow'),
  fileInfo: (p) => ipcRenderer.invoke('file-info', p),
  onConfig: (callback) =>
    ipcRenderer.on('slideshow-config', (_evt, config) => callback(config)),
});
