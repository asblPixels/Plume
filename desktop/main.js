/* =====================================================================
   Plume — application de bureau (Windows, Linux, macOS) via Electron
   Charge l'application web embarquée et ouvre les .docx passés au lancement.
   ===================================================================== */
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
const pending = [];   // fichiers à ouvrir dès que la fenêtre est prête

/** Fichiers .docx/.html/.txt/.md passés en argument (double-clic dans l'Explorateur) */
const filesFromArgv = argv => argv.slice(1).filter(a => /\.(docx|html?|txt|md)$/i.test(a) && fs.existsSync(a));

function sendFile(p) {
  try {
    const data = fs.readFileSync(p);
    const payload = { name: path.basename(p), path: p, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    if (win && win.webContents && !win.webContents.isLoading()) win.webContents.send('plume:open-file', payload);
    else pending.push(payload);
  } catch (e) { console.error('Ouverture impossible :', p, e); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 480,
    title: 'Plume', backgroundColor: '#0D1013', show: false,
    icon: path.join(__dirname, 'app', 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true }
  });
  Menu.setApplicationMenu(null);  // le ruban de Plume remplace la barre de menus
  win.webContents.session.setSpellCheckerLanguages(['fr', 'fr-BE'].filter(l => win.webContents.session.availableSpellCheckerLanguages.includes(l)));
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-finish-load', () => { while (pending.length) win.webContents.send('plume:open-file', pending.shift()); });
  // liens externes : navigateur par défaut
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

// Une seule instance : un 2e double-clic ouvre le fichier dans la fenêtre existante
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    filesFromArgv(argv).forEach(sendFile);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); sendFile(p); });  // macOS
  app.whenReady().then(() => {
    createWindow();
    filesFromArgv(process.argv).forEach(sendFile);
  });
  app.on('window-all-closed', () => app.quit());
}

// Enregistrement direct dans le fichier ouvert depuis l'Explorateur
ipcMain.handle('plume:write-file', async (e, { path: p, data }) => {
  fs.writeFileSync(p, Buffer.from(data));
  return true;
});
