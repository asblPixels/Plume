/* =====================================================================
   Plume — application de bureau (Windows, Linux, macOS) via Electron
   - sert l'application web par un protocole interne sécurisé (plume://)
   - ouvre les fichiers passés au lancement (double-clic dans l'Explorateur)
   - enregistre directement sur le disque, export PDF réel
   - module de conversion : utilise LibreOffice s'il est installé
   ===================================================================== */
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
const OPENABLE = /\.(docx|docm|dotx|dotm|doc|dot|odt|ott|fodt|rtf|pdf|html?|xhtml|md|markdown|txt|csv|wpd|wps|pages|sxw|stw|abw|zabw|lwp|hwp|wri|xml|epub|cwk|sdw|uot|602|gdoc)$/i;

let win = null;
const pending = [];

protocol.registerSchemesAsPrivileged([{ scheme: 'plume', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const filesFromArgv = argv => argv.slice(1).filter(a => OPENABLE.test(a) && fs.existsSync(a));

function sendFile(p) {
  try {
    const data = fs.readFileSync(p);
    const payload = { name: path.basename(p), path: p, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    if (win && !win.webContents.isLoading()) win.webContents.send('plume:open-file', payload);
    else pending.push(payload);
  } catch (e) { console.error('Ouverture impossible :', p, e); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 480,
    title: 'Plume', backgroundColor: '#0D1013', show: false,
    icon: path.join(APP_DIR, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  Menu.setApplicationMenu(null);   // le ruban de Plume remplace la barre de menus
  const ses = win.webContents.session;
  const langs = ['fr', 'fr-FR', 'fr-BE', 'nl', 'en-GB'].filter(l => ses.availableSpellCheckerLanguages.includes(l));
  if (langs.length) ses.setSpellCheckerLanguages(langs.slice(0, 3));
  win.loadURL('plume://app/index.html');
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-finish-load', () => { while (pending.length) win.webContents.send('plume:open-file', pending.shift()); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('plume://')) { e.preventDefault(); if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url); } });
  // menu contextuel : suggestions orthographiques + copier/coller
  win.webContents.on('context-menu', (e, params) => {
    const items = [];
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (params.misspelledWord) items.push({ label: 'Ajouter au dictionnaire', click: () => ses.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    items.push({ label: 'Couper', role: 'cut', enabled: params.editFlags.canCut }, { label: 'Copier', role: 'copy', enabled: params.editFlags.canCopy }, { label: 'Coller', role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { label: 'Tout sélectionner', role: 'selectAll' });
    Menu.buildFromTemplate(items).popup();
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    filesFromArgv(argv).forEach(sendFile);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (e, p) => { e.preventDefault(); sendFile(p); });   // macOS
  app.whenReady().then(() => {
    protocol.handle('plume', req => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const file = path.normalize(path.join(APP_DIR, rel));
      if (!file.startsWith(APP_DIR)) return new Response('Interdit', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    filesFromArgv(process.argv).forEach(sendFile);
  });
  app.on('window-all-closed', () => app.quit());
}

/* ---------- Fichiers ---------- */
ipcMain.handle('plume:write-file', async (e, { path: p, data }) => { fs.writeFileSync(p, Buffer.from(data)); return true; });
ipcMain.handle('plume:save-dialog', async (e, { name, ext, label }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer sous', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: label, extensions: [ext] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('plume:print-pdf', async () => {
  const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true });
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
});

/* ---------- Module de conversion (LibreOffice) ---------- */
function findSoffice() {
  const cands = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean).flatMap(d => [path.join(d, 'LibreOffice', 'program', 'soffice.exe'), path.join(d, 'OpenOffice 4', 'program', 'soffice.exe')])
    : process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice', '/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice'];
  return cands.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}
ipcMain.handle('plume:converter-available', () => !!findSoffice());
ipcMain.handle('plume:convert', async (e, { data, from, to }) => {
  const soffice = findSoffice();
  if (!soffice) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-'));
  const input = path.join(dir, 'document.' + String(from).replace(/[^a-z0-9]/gi, ''));
  fs.writeFileSync(input, Buffer.from(data));
  const filter = { docx: 'docx:MS Word 2007 XML', doc: 'doc:MS Word 97', odt: 'odt', pdf: 'pdf' }[to] || to;   // pas de guillemets : arguments passés sans shell
  const profile = pathToFileURL(path.join(os.tmpdir(), 'plume-lo-profile')).toString();
  try {
    await new Promise((resolve, reject) => execFile(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--convert-to', filter, '--outdir', dir, input], { timeout: 180000, windowsHide: true }, err => err ? reject(err) : resolve()));
    const out = path.join(dir, 'document.' + to);
    if (!fs.existsSync(out)) return null;
    const buf = fs.readFileSync(out);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (err) { console.error('Conversion échouée', err); return null; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
});
