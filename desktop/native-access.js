'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function appURL(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'plume:' && url.host === 'app' && !url.username && !url.password) return url;
  } catch {}
  return null;
}

function isEditor(raw) {
  return appURL(raw)?.pathname === '/index.html';
}

function isTrusted(event, window) {
  if (!window || window.isDestroyed()) return false;
  const contents = window.webContents;
  const frame = event.senderFrame;
  return event.sender === contents && !!frame && frame === contents.mainFrame && isEditor(frame.url);
}

function assetPath(root, raw) {
  const url = appURL(raw);
  if (!url) return null;
  try {
    const parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\/:\x00]/.test(part))) return null;
    const base = fs.realpathSync(root);
    const file = fs.realpathSync(path.join(base, ...parts));
    const relative = path.relative(base, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}

class DocumentGrants {
  constructor() { this.paths = new Map(); }
  grant(file) {
    const requested = path.resolve(file);
    const parent = fs.realpathSync(path.dirname(requested));
    let target;
    try { target = fs.realpathSync(requested); }
    catch (err) {
      if (err.code !== 'ENOENT' || fs.lstatSync(requested, { throwIfNoEntry: false })) throw err;
      target = path.join(parent, path.basename(requested));
    }
    this.paths.set(requested, target);
    return requested;
  }
  target(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Document non autorisé.');
    const target = this.paths.get(path.resolve(file));
    if (!target || fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('Document non autorisé.');
    return target;
  }
  write(file, data) {
    const target = this.target(file);
    if (!(data instanceof ArrayBuffer) && !Buffer.isBuffer(data)) throw new Error('Données de document invalides.');
    const bytes = Buffer.from(data);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isFile() || fs.realpathSync(target) !== target) throw new Error('Destination modifiée.');
      fs.accessSync(target, fs.constants.W_OK);
    }
    const staging = path.join(path.dirname(target), '.plume-' + crypto.randomUUID() + '.tmp');
    // Le fichier précédent reste disponible si le disque est plein ou si l’écriture échoue.
    const fd = fs.openSync(staging, 'wx', 0o600);
    try {
      try {
        fs.writeFileSync(fd, bytes);
        if (existing) fs.fchmodSync(fd, existing.mode & 0o777);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(staging, target);
    } finally { fs.rmSync(staging, { force: true }); }
  }
}

module.exports = { assetPath, isEditor, isTrusted, DocumentGrants };
