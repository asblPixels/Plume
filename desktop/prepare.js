/* Copie l'application web dans desktop/app et prépare les icônes */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dest = path.join(__dirname, 'app');
fs.rmSync(dest, { recursive: true, force: true });
for (const item of ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons']) {
  fs.cpSync(path.join(root, item), path.join(dest, item), { recursive: true });
}
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.copyFileSync(path.join(root, 'icons', 'icon-512.png'), path.join(__dirname, 'build', 'icon.png'));
console.log('Application copiée dans desktop/app');
