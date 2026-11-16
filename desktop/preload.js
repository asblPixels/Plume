/* Pont sécurisé entre la fenêtre Plume et le système (ouverture/enregistrement de fichiers) */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('plumeDesktop', {
  platform: process.platform,
  onOpenFile: cb => ipcRenderer.on('plume:open-file', (e, f) => cb(f)),
  writeFile: (path, data) => ipcRenderer.invoke('plume:write-file', { path, data })
});
