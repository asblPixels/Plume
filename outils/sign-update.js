'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const [command, filename] = process.argv.slice(2);
if (command === 'pin' && filename) {
  const key = crypto.createPublicKey(fs.readFileSync(filename));
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Clé publique Ed25519 requise');
  const publicKey = key.export({format: 'pem', type: 'spki'});
  fs.writeFileSync(path.join(root, 'desktop/update-key.json'), JSON.stringify({ publicKey }, null, 2) + '\n');
} else if (command === 'sign' && filename) {
  const bytes = fs.readFileSync(path.join(root, 'version.json'));
  const privateKey = crypto.createPrivateKey(fs.readFileSync(filename));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw Error('Clé privée Ed25519 requise');
  const signature = crypto.sign(null, bytes, privateKey);
  require('../desktop/signed-updater').verifiedManifest(bytes, signature, require('../desktop/update-key.json').publicKey);
  fs.writeFileSync(path.join(root, 'version.json.sig'), signature);
} else throw Error('Usage : node outils/sign-update.js pin cle-publique.pem | sign chemin-cle-privee.pem');
