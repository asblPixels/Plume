'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {stage, installed, verifiedManifest} = require('../desktop/signed-updater');
const {publicKey, privateKey} = crypto.generateKeyPairSync('ed25519');
function release(version) {
  const data = Buffer.from('Plume ' + version);
  const manifest = {app: 'Plume', version, files: [{path: 'index.html', size: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex')}]};
  const bytes = Buffer.from(JSON.stringify(manifest));
  return {'version.json': bytes, 'version.json.sig': crypto.sign(null, bytes, privateKey), 'index.html': data};
}
test('Intégrité, reprise et rejet des anciennes versions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-update-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  let files = release('1.4.2');
  const fetch = url => new Response(files[path.basename(new URL(url).pathname)]);
  const run = (version = '1.4.1') => stage(root, version, 'https://example.invalid/', publicKey, fetch);
  const active = () => installed(root, '/bundled', '1.4.1', publicKey);
  assert.equal(await stage(root, '1.4.1', '', null, () => assert.fail()), null);
  assert.equal(await run(), '1.4.2');
  assert.equal(active(), path.join(root, '1.4.2'));
  assert.equal(await run('1.4.2'), null);
  files = release('1.4.3');
  files['version.json.sig'][0] ^= 1;
  await assert.rejects(run());
  files = release('1.4.3');
  files['index.html'][0] ^= 1;
  await assert.rejects(run());
  assert.deepEqual(fs.readdirSync(root), ['1.4.2']);
  files = release('1.4.3');
  await run();
  assert.equal(active(), path.join(root, '1.4.3'));
  fs.writeFileSync(path.join(active(), 'extra.js'), 'extra');
  assert.equal(active(), path.join(root, '1.4.2'));
  await run('1.4.2');
  assert.equal(active(), path.join(root, '1.4.3'));
  fs.writeFileSync(path.join(active(), 'index.html'), 'oops');
  fs.unlinkSync(path.join(root, '1.4.2/version.json.sig'));
  assert.equal(active(), '/bundled');
});
test('Le manifeste de distribution respecte le schéma signé', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../version.json'));
  assert.ok(verifiedManifest(bytes, crypto.sign(null, bytes, privateKey), publicKey));
});
