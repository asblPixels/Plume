'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const MANIFEST_LIMIT = 1024 * 1024;
const FILE_LIMIT = 64 * 1024 * 1024;
function compare(a, b) {
  const parts = b.split('.').map(Number);
  return a.split('.').map((n, i) => Number(n) - parts[i]).find(Boolean) || 0;
}
function verifiedManifest(bytes, signature, key) {
  if (!key || bytes.length > MANIFEST_LIMIT || signature.length !== 64 ||
      !crypto.verify(null, bytes, key, signature)) throw Error('Signature du manifeste invalide');
  const manifest = JSON.parse(bytes);
  if (manifest.app !== 'Plume' || typeof manifest.version !== 'string' || !VERSION.test(manifest.version) ||
      !Array.isArray(manifest.files) || manifest.files.length > 4096) throw Error('Manifeste invalide');
  const paths = new Set();
  let total = 0;
  for (const f of manifest.files) {
    if (typeof f.path !== 'string' || !/^(?:index\.html|manifest\.webmanifest|(?:css|js|vendor|icons)\/[A-Za-z0-9_.\/-]+)$/.test(f.path) ||
        f.path.split('/').some(p => !p || p.startsWith('.') || p.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) ||
        paths.has(f.path.toLowerCase()) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > FILE_LIMIT ||
        typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw Error('Entrée du manifeste invalide');
    paths.add(f.path.toLowerCase());
    total += f.size;
  }
  if (!paths.has('index.html') || total > 256 * 1024 * 1024) throw Error('Manifeste incomplet ou trop grand');
  return manifest;
}
function checkData(data, file) {
  if (data.length !== file.size || crypto.createHash('sha256').update(data).digest('hex') !== file.sha256)
    throw Error('Empreinte incorrecte : ' + file.path);
}
function readLimited(file, limit) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > limit) throw Error('Fichier local invalide');
  return fs.readFileSync(file);
}
function verifyDirectory(dir, version, key) {
  if (!fs.lstatSync(dir).isDirectory()) throw Error('Répertoire invalide');
  const manifest = verifiedManifest(readLimited(path.join(dir, 'version.json'), MANIFEST_LIMIT),
    readLimited(path.join(dir, 'version.json.sig'), 64), key);
  if (manifest.version !== version) throw Error('Version incorrecte');
  const expected = new Map(manifest.files.map(f => [f.path, f]));
  const dirs = new Set();
  for (const name of expected.keys()) {
    let parent = path.posix.dirname(name);
    while (parent !== '.') { dirs.add(parent); parent = path.posix.dirname(parent); }
  }
  function walk(rel) {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const name = path.posix.join(rel, entry.name);
      if (name === 'version.json' || name === 'version.json.sig') continue;
      if (entry.isDirectory() && dirs.has(name)) { walk(name); continue; }
      const file = expected.get(name);
      if (!file || !entry.isFile()) throw Error('Fichier local inattendu');
      checkData(readLimited(path.join(dir, name), file.size), file);
      expected.delete(name);
    }
  }
  walk('');
  if (expected.size) throw Error('Mise à jour incomplète');
}
function installed(root, bundled, version, key) {
  if (!key) return bundled;
  let entries;
  try {
    if (!fs.lstatSync(root).isDirectory()) return bundled;
    entries = fs.readdirSync(root);
  } catch { return bundled; }
  const versions = entries.filter(v => VERSION.test(v) && compare(v, version) > 0);
  for (const candidate of versions.sort((a, b) => compare(b, a))) {
    const dir = path.join(root, candidate);
    try { verifyDirectory(dir, candidate, key); return dir; } catch { /* Essayer la version précédente. */ }
  }
  return bundled;
}
async function download(fetch, url, limit) {
  const response = await fetch(url.href, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('HTTP ' + response.status);
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > limit) throw Error('Téléchargement trop grand');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function stage(root, current, base, key, fetch) {
  if (!key) return null;
  const bytes = await download(fetch, new URL('version.json', base), MANIFEST_LIMIT);
  const signature = await download(fetch, new URL('version.json.sig', base), 64);
  const manifest = verifiedManifest(bytes, signature, key);
  if (compare(manifest.version, current) <= 0) return null;
  fs.mkdirSync(root, {recursive: true});
  const tmp = fs.mkdtempSync(path.join(root, 'stage-'));
  try {
    for (const file of manifest.files) {
      const data = await download(fetch, new URL(file.path, base), file.size);
      checkData(data, file);
      const target = path.join(tmp, file.path);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, data, {flag: 'wx'});
    }
    fs.writeFileSync(path.join(tmp, 'version.json'), bytes);
    fs.writeFileSync(path.join(tmp, 'version.json.sig'), signature);
    const target = path.join(root, manifest.version);
    if (fs.existsSync(target)) {
      try { verifyDirectory(target, manifest.version, key); return manifest.version; }
      catch { fs.rmSync(target, {recursive: true, force: true}); }
    }
    fs.renameSync(tmp, target);
    return manifest.version;
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}
module.exports = { installed, stage, verifiedManifest };
