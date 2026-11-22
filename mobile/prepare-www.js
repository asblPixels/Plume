/* Copie l'application web dans mobile/www (sans le service worker, inutile dans l'app) */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dest = path.join(__dirname, 'www');
fs.rmSync(dest, { recursive: true, force: true });
for (const item of ['index.html', 'manifest.webmanifest', 'version.json', 'css', 'js', 'vendor', 'icons']) fs.cpSync(path.join(root, item), path.join(dest, item), { recursive: true });
console.log('Application copiée dans mobile/www');
