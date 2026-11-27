'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../vendor/jszip.min.js');

const code = fs.readFileSync(path.join(__dirname, '../js/office-archive.js'), 'utf8');
const arch = vm.runInNewContext(code + '\nOfficeArchive', { JSZip, Uint8Array, DataView });
async function sample(compression = 'DEFLATE') {
  const zip = new JSZip();
  zip.file('word/document.xml', '<document/>');
  zip.file('word/styles.xml', '<styles/>');
  return zip.generateAsync({ type: 'uint8array', compression, comment: 'Plume' });
}
for (const method of ['STORE', 'DEFLATE']) {
  test('Lecture du paquet original en mode ' + method, async () => {
    const zip = await arch.load(await sample(method));
    assert.equal(await zip.file('word/document.xml').async('string'), '<document/>');
  });
}
test('Vérification des budgets avant import', async () => {
  const bytes = await sample();
  for (const low of [{ count: 1 }, { compressed: 1 }, { entry: 5 }, { expanded: 15 }, { directory: 10 }]) {
    await assert.rejects(arch.verify(bytes, { ...arch.limits, ...low }), /limites/);
  }
  await assert.rejects(arch.verify(bytes.subarray(0, bytes.length - 3)), /invalide/);
  await assert.rejects(arch.verify(new Uint8Array(0)), /invalide/);
});

test('Le worker accepte un document et signale une archive tronquée', async () => {
  let result;
  const context = vm.createContext({
    JSZip, Uint8Array, DataView,
    self: { postMessage: message => { result = message; } },
    importScripts: () => vm.runInContext(code, context)
  });
  const worker = fs.readFileSync(path.join(__dirname, '../js/office-archive-worker.js'), 'utf8');
  vm.runInContext(worker, context);
  const input = await sample();
  await context.self.onmessage({ data: input });
  assert.equal(result.ok, true);
  await context.self.onmessage({ data: input.subarray(0, 4) });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalide/);
});
