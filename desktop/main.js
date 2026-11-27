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
const crypto = require('node:crypto');
const { execFile, spawn } = require('child_process');
const { pathToFileURL } = require('url');

const { assetPath, isEditor, isTrusted, DocumentGrants } = require('./native-access');
const grants = new DocumentGrants();

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrusted(event, win)) throw new Error('Accès natif refusé.');
    return callback(event, ...args);
  });
}

const BUNDLED_DIR = path.join(__dirname, 'app');

/* Les mises à jour du contenu web sont vérifiées avant installation et au démarrage. */
const updater = require('./signed-updater');
const UPDATE_URL = 'https://asblpixels.github.io/Plume/';
const UPDATE_DIR = path.join(app.getPath('userData'), 'versions-signees');
const UPDATE_KEY = require('./update-key.json').publicKey;
const readVer = dir => JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version;
const APP_DIR = updater.installed(UPDATE_DIR, BUNDLED_DIR, readVer(BUNDLED_DIR), UPDATE_KEY);
const updateState = { current: readVer(APP_DIR), available: null, ready: false };

async function checkUpdate() {
  try {
    const version = await updater.stage(UPDATE_DIR, updateState.current, UPDATE_URL, UPDATE_KEY, net.fetch.bind(net));
    if (!version) return;
    updateState.available = version;
    updateState.ready = true;
    if (win) win.webContents.send('plume:update-ready', version);
  } catch (e) {
    console.error('Mise à jour impossible :', e.message || e);
  }
}
handle('plume:update-state', () => updateState);
handle('plume:update-restart', () => { app.relaunch(); app.exit(0); });
const OPENABLE = /\.(docx|docm|dotx|dotm|doc|dot|odt|ott|fodt|rtf|pdf|html?|xhtml|md|markdown|txt|csv|wpd|wps|pages|sxw|stw|abw|zabw|lwp|hwp|wri|xml|epub|cwk|sdw|uot|602|gdoc)$/i;

let win = null;
const pending = [];

protocol.registerSchemesAsPrivileged([{ scheme: 'plume', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const filesFromArgv = argv => argv.slice(1).filter(a => OPENABLE.test(a) && fs.existsSync(a));

function sendFile(p) {
  try {
    if (!OPENABLE.test(p) || !fs.statSync(p).isFile()) return;
    const data = fs.readFileSync(p);
    p = grants.grant(p);
    const payload = { name: path.basename(p), path: p, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    if (win && !win.webContents.isLoading()) win.webContents.send('plume:open-file', payload);
    else pending.push(payload);
  } catch (e) { console.error('Ouverture impossible :', p, e); }
}

let exitApproved = false;
let quitAcknowledgement = null;
// Le gestionnaire de fenêtre vaut sur Linux, Windows et macOS : la fermeture
// native (Alt+F4, bouton X, Cmd+Q) passe par la même confirmation de Plume.
function requestWindowClose(event) {
  if (exitApproved) return;
  event.preventDefault();
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading() || win.webContents.isDestroyed() || (typeof win.webContents.isCrashed === 'function' && win.webContents.isCrashed())) {
    const answer = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Quitter Plume',
      message: 'Le document n’est pas accessible. Quitter Plume ?',
      detail: 'Les modifications non enregistrées pourraient être perdues.',
      buttons: ['Annuler', 'Quitter'], defaultId: 0, cancelId: 0
    });
    if (answer === 1) { exitApproved = true; win.destroy(); app.quit(); }
    return;
  }
  win.webContents.send('plume:request-quit');
  // Secours quand le moteur JS ne répond pas : une app doit toujours
  // pouvoir être fermée depuis le système, même après un plantage partiel.
  if (quitAcknowledgement) clearTimeout(quitAcknowledgement);
  quitAcknowledgement = setTimeout(() => {
    quitAcknowledgement = null;
    if (!win || win.isDestroyed() || exitApproved) return;
    const answer = dialog.showMessageBoxSync(win, {
      type: 'warning', title: 'Plume ne répond pas',
      message: 'Plume n’a pas répondu à la demande de fermeture.',
      detail: 'Forcer la fermeture peut perdre des modifications non enregistrées.',
      buttons: ['Annuler', 'Forcer la fermeture'], defaultId: 0, cancelId: 0
    });
    if (answer === 1) { exitApproved = true; win.destroy(); app.quit(); }
  }, 2500);
}
ipcMain.on('plume:quit-ack', event => {
  if (isTrusted(event, win) && quitAcknowledgement) {
    clearTimeout(quitAcknowledgement);
    quitAcknowledgement = null;
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 360, minHeight: 480,
    title: 'Plume', backgroundColor: '#0D1013', show: false,
    icon: path.join(APP_DIR, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  // Barre de menus native conservée en secours, y compris sous Wayland :
  // l'utilisateur peut toujours quitter via le système d'exploitation.
  const applicationMenu = Menu.buildFromTemplate([
    { label: 'Fichier', submenu: [
      { label: 'Quitter Plume', accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Ctrl+Q',
        click: () => win && !win.isDestroyed() && win.close() }
    ] },
    { label: 'Édition', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ] }
  ]);
  Menu.setApplicationMenu(applicationMenu);
  win.on('close', requestWindowClose);
  const ses = win.webContents.session;
  const langs = ['fr', 'fr-FR', 'fr-BE', 'nl', 'en-GB'].filter(l => ses.availableSpellCheckerLanguages.includes(l));
  if (langs.length) ses.setSpellCheckerLanguages(langs.slice(0, 3));
  win.loadURL('plume://app/index.html');
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-finish-load', () => { while (pending.length) win.webContents.send('plume:open-file', pending.shift()); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isEditor(url)) { e.preventDefault(); if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url); } });
  win.webContents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && !isEditor(url)) event.preventDefault();
  });
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
      const file = assetPath(APP_DIR, req.url);
      if (!file) return new Response('Introuvable', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    createWindow();
    filesFromArgv(process.argv).forEach(sendFile);
    if (!process.env.PLUME_NO_UPDATE) setTimeout(checkUpdate, 4000);
  });
  app.on('window-all-closed', () => app.quit());
}

/* ---------- Fermeture contrôlée pour toutes les plateformes de bureau ---------- */
handle('plume:quit', event => {
  exitApproved = true;
  if (quitAcknowledgement) { clearTimeout(quitAcknowledgement); quitAcknowledgement = null; }
  win.close();
  app.quit();
  return true;
});

/* ---------- Fichiers ---------- */
handle('plume:open-in-word', async (event, file) => {
  if (process.platform !== 'win32' || !win || event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      typeof file !== 'string' || !/^[a-z]:[\\/]/i.test(file) || !/\.(docm|dotm)$/i.test(file)) {
    throw new Error('Sélectionnez un document Word avec macros enregistré sur ce PC.');
  }
  const original = grants.target(file);
  if (await fs.promises.realpath(original) !== original || !(await fs.promises.stat(original)).isFile()) {
    throw new Error('Le document enregistré est introuvable.');
  }
  const programs = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
  const word = programs.filter(Boolean).flatMap(dir => [
    path.join(dir, 'Microsoft Office', 'root', 'Office16', 'WINWORD.EXE'),
    path.join(dir, 'Microsoft Office', 'Office16', 'WINWORD.EXE')
  ]).find(candidate => fs.existsSync(candidate));
  if (!word) throw new Error('Microsoft Word n’a pas été trouvé dans les dossiers d’installation standard.');
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: 'Ouvrir une copie dans Microsoft Word',
    message: path.basename(original),
    detail: 'Plume crée une copie à côté de ce fichier. Vous pourrez choisir une macro dans Word selon ses paramètres de sécurité.',
    buttons: ['Annuler', 'Créer la copie et ouvrir Word'], defaultId: 0, cancelId: 0
  });
  if (response !== 1) return false;
  const { dir, name, ext } = path.parse(original);
  const copy = path.join(dir, name.slice(0, 180) + ' - essai VBA ' + crypto.randomUUID() + ext);
  const zone = async filePath => {
    try { return await fs.promises.readFile(filePath + ':Zone.Identifier'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const sourceZone = await zone(original);
  await fs.promises.copyFile(original, copy, fs.constants.COPYFILE_EXCL);
  try {
    const copyZone = await zone(copy);
    if (sourceZone && (!copyZone || !sourceZone.equals(copyZone))) {
      throw new Error('La provenance du document n’a pas pu être conservée dans la copie.');
    }
    await new Promise((resolve, reject) => {
      const child = spawn(word, ['/m', copy], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } catch (error) {
    await fs.promises.unlink(copy).catch(() => {});
    throw error;
  }
  return copy;
});
handle('plume:write-file', async (e, { path: p, data }) => { grants.write(p, data); return true; });
handle('plume:save-dialog', async (e, { name, ext, label }) => {
  if (typeof name !== 'string' || typeof ext !== 'string' || !/^[a-z0-9]{1,10}$/i.test(ext) || typeof label !== 'string') throw new Error('Format invalide.');
  name = path.basename(path.win32.basename(name)).replace(/[\x00-\x1f:]/g, '').slice(0, 240);
  if (!name || name === '.' || name === '..') name = 'Document.' + ext;
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer sous', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: label, extensions: [ext] }, { name: 'Tous les fichiers', extensions: ['*'] }] });
  return r.canceled ? null : grants.grant(r.filePath);
});
handle('plume:print-pdf', async () => {
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
handle('plume:converter-available', () => !!findSoffice());
handle('plume:convert', async (e, { data, from, to }) => {
  if (typeof from !== 'string' || !/^[a-z0-9]{1,10}$/i.test(from) || !['docx', 'doc', 'odt', 'pdf'].includes(to) || !(data instanceof ArrayBuffer || Buffer.isBuffer(data))) throw new Error('Conversion invalide.');
  const soffice = findSoffice();
  if (!soffice) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-'));
  const input = path.join(dir, 'document.' + String(from).replace(/[^a-z0-9]/gi, ''));
  const filter = { docx: 'docx:MS Word 2007 XML', doc: 'doc:MS Word 97', odt: 'odt', pdf: 'pdf' }[to] || to;   // pas de guillemets : arguments passés sans shell
  const profile = pathToFileURL(path.join(dir, 'profile')).toString();
  try {
    fs.writeFileSync(input, Buffer.from(data));
    await new Promise((resolve, reject) => execFile(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--norestore', '--nologo', '--convert-to', filter, '--outdir', dir, input], { timeout: 180000, windowsHide: true }, err => err ? reject(err) : resolve()));
    const out = path.join(dir, 'document.' + to);
    if (!fs.existsSync(out)) return null;
    const buf = fs.readFileSync(out);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (err) { console.error('Conversion échouée', err); return null; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
});
