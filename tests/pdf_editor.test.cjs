/* Vérifications ciblées du mode PDF. Exécution : node tests/pdf_editor.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]);
const calls = [];
const mockPage = {
  getViewport({ scale }) { return { width: 100 * scale, height: 200 * scale }; },
  async getTextContent() { return { items: [] }; },
  render() { calls.push('render'); return { promise: Promise.resolve() }; }
};
function canvas() {
  return {
    width: 0, height: 0,
    getContext() {
      return {
        fillRect() { calls.push('rect'); },
        fillText() { calls.push('text'); },
        set fillStyle(value) {}, set font(value) {}, set textBaseline(value) {}
      };
    },
    toBlob(callback) { callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type:'image/png' })); }
  };
}
const pdfPage = {
  getSize() { return { width: 100, height: 200 }; },
  setSize() {},
  setOrEmbedFont() { return { newFontKey: "F1" }; },
  drawRectangle() { calls.push('vector-rectangle'); },
  drawText() { calls.push('vector-text'); },
  drawImage() { calls.push('image'); }
};
const base = {
  embedFont: async () => ({ encodeText(value) { return value; } }),
  getPage: () => pdfPage,
  getPageIndices: () => [0, 1],
  addPage: () => pdfPage,
  copyPages: async () => [pdfPage],
  embedPng: async data => {
    assert.equal(data instanceof ArrayBuffer, true, 'Le PNG doit être transmis sous forme d’octets, jamais comme Blob');
    calls.push('png');
    return {};
  },
  save: async () => new Uint8Array([1, 2, 3])
};
const sandbox = {
  Blob, Uint8Array, ArrayBuffer, console,
  document: { createElement: type => { assert.equal(type, 'canvas'); return canvas(); } },
  window: {
    PDFLib: {
      PDFDocument: {
        load: async () => { calls.push('load'); return base; },
        create: async () => { calls.push('create'); return base; }
      },
      StandardFonts: { Helvetica:'Helvetica' },
      rgb: () => ({})
    }
  }
};
vm.createContext(sandbox);
const file = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf-editor.js'), 'utf8');
const hooked = file.replace(
  '  return { open, close, exportPdf,',
  '  return { __test: { seed(data, changes, num=1) { original=data; edits=changes; pdf={numPages:num,getPage:async()=>mockPage}; }, reset(){ original=null; edits=[]; } }, open, close, exportPdf,'
);
assert.notEqual(hooked, file, 'L’interface du module a changé');
sandbox.mockPage = mockPage;
vm.runInContext(hooked + '\nthis.subject = PdfEditor;', sandbox);
const editor = sandbox.subject;
const testEdit = { kind:'redact',page:0,x:.2,y:.3,w:.25,h:.04,font:12,value:'' };
async function run() {
  editor.__test.seed(new Uint8Array(bytes), []);
  const original = await editor.exportPdf();
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  assert.deepEqual(calls, [], 'L’enregistrement sans édition ne doit jamais réécrire le PDF');

  editor.__test.seed(new Uint8Array(bytes), [
    {kind:'highlight', page:0,x:.2,y:.3,w:.2,h:.04},
    {kind:'note', page:0,x:.25,y:.35,w:.3,h:.03,font:12,value:'Note'}
  ]);
  await editor.exportPdf();
  assert.ok(calls.includes('vector-rectangle'));
  assert.ok(calls.includes('vector-text'));
  assert.ok(!calls.includes('render'), 'Une annotation ne doit pas rasteriser le document');

  calls.length = 0;
  editor.__test.seed(new Uint8Array(bytes), [testEdit], 2);
  await editor.exportPdf();
  assert.ok(calls.includes('create'));
  assert.ok(calls.includes('render'), 'La page supprimée doit être redessinée sans texte source');
  assert.ok(calls.includes('png'), 'Le nouveau dessin doit être intégré avec ses octets PNG');
  assert.ok(calls.includes('image'));
  editor.__test.reset();
  console.log('Mode PDF : restitution identique, annotations vectorielles et suppression de texte ciblée.');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
