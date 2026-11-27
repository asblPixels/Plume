'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assetPath, isTrusted, DocumentGrants } = require('../desktop/native-access');

test('Seul le document principal de la fenêtre active reçoit le pont natif', () => {
  const frame = { url: 'plume://app/index.html#document' };
  const sender = { mainFrame: frame };
  const window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: frame };
  assert.ok(isTrusted(event, window));
  assert.ok(!isTrusted({ ...event, senderFrame: { ...frame } }, window));
  assert.ok(!isTrusted({ ...event, sender: {} }, window));
  assert.ok(!isTrusted({ sender }, window));
  for (frame.url of ['plume://autre/index.html', 'plume://app/a.html', 'https://app/index.html', 'plume://user@app/index.html']) {
    assert.ok(!isTrusted(event, window));
  }
});

test('Le protocole sert les ressources existantes dans le dossier applicatif', t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-assets-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'app');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), '');
  assert.equal(assetPath(root, 'plume://app/index.html?v=2'), fs.realpathSync(path.join(root, 'index.html')));
  assert.equal(assetPath(root, 'plume://ailleurs/index.html'), null);
  assert.equal(assetPath(root, 'plume://app/missing.js'), null);
  if (process.platform !== 'win32') {
    fs.symlinkSync(base, path.join(root, 'hors-app'));
    fs.writeFileSync(path.join(base, 'file.txt'), '');
    assert.equal(assetPath(root, 'plume://app/hors-app/file.txt'), null);
  }
});

test('Création et sauvegardes successives limitées au fichier sélectionné', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plume-grant-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const selected = path.join(root, 'doc.docx');
  const other = path.join(root, 'autre.docx');
  const grants = new DocumentGrants();
  assert.throws(() => grants.write(selected, Buffer.alloc(0)), /non autorisé/);
  assert.equal(grants.grant(selected), selected);
  grants.write(selected, Uint8Array.from([1, 2, 3]).buffer);
  grants.write(selected, Buffer.from([4]));
  assert.deepEqual(fs.readFileSync(selected), Buffer.from([4]));
  assert.throws(() => grants.write(other, Buffer.alloc(0)), /non autorisé/);
  assert.throws(() => grants.write(selected, 'texte'), /invalides/);
  if (process.platform !== 'win32') {
    fs.writeFileSync(other, 'original');
    fs.unlinkSync(selected);
    fs.symlinkSync(other, selected);
    assert.throws(() => grants.write(selected, Buffer.alloc(0)), /modifiée/);
    assert.equal(fs.readFileSync(other, 'utf8'), 'original');
  }
});
