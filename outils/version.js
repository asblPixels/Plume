/* Génère version.json : version de Plume + liste des fichiers de l'application (taille, empreinte SHA-256).
   Sert aux mises à jour automatiques des applications installées (bureau) et au contrôle de version.
   Usage : node outils/version.js   (à relancer avant chaque publication ; la CI le vérifie) */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const version = /VERSION:\s*'([^']+)'/.exec(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'))[1];
const files = [];
const walk = rel => {
  const abs = path.join(root, rel);
  if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs).sort()) walk(path.posix.join(rel, f)); return; }
  const data = fs.readFileSync(abs);
  files.push({ path: rel, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
};
for (const item of ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons']) walk(item);
const out = { app: 'Plume', version, files };
// le service worker change de nom de cache à chaque version : les navigateurs installent la nouvelle
const swPath = path.join(root, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8').replace(/const CACHE = '[^']+'/, `const CACHE = 'plume-${version}'`);
if (!process.argv.includes('--check')) fs.writeFileSync(swPath, sw);
const check = process.argv.includes('--check');
const target = path.join(root, 'version.json');
const json = JSON.stringify(out, null, 1) + '\n';
if (check) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur !== json) { console.error('version.json n’est pas à jour : lancez « node outils/version.js »'); process.exit(1); }
  console.log('version.json à jour (' + version + ')');
} else {
  fs.writeFileSync(target, json);
  console.log(`version.json : Plume ${version}, ${files.length} fichiers`);
}
