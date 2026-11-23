/* Pont sécurisé entre la fenêtre Plume et le système (fichiers, PDF, conversion) */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('plumeDesktop', {
  platform: process.platform,
  onOpenFile: cb => ipcRenderer.on('plume:open-file', (e, f) => cb(f)),
  quit: () => ipcRenderer.invoke('plume:quit'),
  onQuitRequested: cb => ipcRenderer.on('plume:request-quit', () => {
    ipcRenderer.send('plume:quit-ack');
    cb();
  }),
  writeFile: (path, data) => ipcRenderer.invoke('plume:write-file', { path, data }),
  saveDialog: (name, ext, label) => ipcRenderer.invoke('plume:save-dialog', { name, ext, label }),
  printToPdf: () => ipcRenderer.invoke('plume:print-pdf'),
  update: {
    state: () => ipcRenderer.invoke('plume:update-state'),
    onReady: cb => ipcRenderer.on('plume:update-ready', (e, v) => cb(v)),
    restart: () => ipcRenderer.invoke('plume:update-restart')
  },
  converter: {
    available: () => ipcRenderer.invoke('plume:converter-available'),
    convert: (data, from, to) => ipcRenderer.invoke('plume:convert', { data, from, to })
  }
});
