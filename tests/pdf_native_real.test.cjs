/* Test d'intégrité PDF avec le vrai moteur pdf-lib embarqué.
 * node tests/pdf_native_real.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const PDFLib = require('../vendor/pdf-lib.min.js');
const { PDFDocument, StandardFonts, rgb } = PDFLib;

async function run() {
  const source = await PDFDocument.create();
  const page = source.addPage([595.28, 841.89]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText('Le PDF original reste intact.', {
    x: 42, y: 780, size: 14, font, color: rgb(0, 0, 0)
  });
  const input = new Uint8Array(await source.save());

  const ctx = {
    Blob, Uint8Array, console,
    window: { PDFLib },
    document: {
      createElement() {
        return {
          getContext: () => ({ fillRect() {}, fillText() {} }),
          toBlob: callback => callback(new Blob([Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
            'base64')]))
        };
      }
    },
  };
  ctx.mockPage = {
    getViewport: ({ scale }) => ({ scale, width: page.getWidth() * scale, height: page.getHeight() * scale }),
    render: () => ({ promise: Promise.resolve() }),
    getTextContent: async () => ({ items: [
      { str: 'FRAGMENT A EFFACER', transform: [12, 0, 0, 12, 60, 90], width: 120, height: 12 },
      { str: 'FRAGMENT A CONSERVER', transform: [12, 0, 0, 12, 60, 220], width: 150, height: 12 }
    ] })
  };
  vm.createContext(ctx);
  const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf-editor.js'), 'utf8');
  const hooked = script.replace(
    '  return { open, close, exportPdf,',
    '  return { __seed(data, change) { original = data; edits = change; lib = { Util: { transform: (_, matrix) => matrix } }; pdf = { numPages: 1, getPage: async () => mockPage }; }, open, close, exportPdf,'
  );
  assert.notEqual(script, hooked);
  vm.runInContext(hooked + '\nthis.target = PdfEditor;', ctx);
  const target = ctx.target;

  target.__seed(input, []);
  const same = new Uint8Array(await (await target.exportPdf()).arrayBuffer());
  assert.deepEqual(same, input, 'Un PDF non modifié ne doit jamais être recomposé');

  target.__seed(input, [{
    kind:'note', page:0, x:.1,y:.07,w:.3,h:.04,font:12,value:'Annotation Plume'
  }]);
  const saved = new Uint8Array(await (await target.exportPdf()).arrayBuffer());
  assert.notDeepEqual(saved, input, 'Une annotation doit être intégrée au PDF');
  const parsed = await PDFDocument.load(saved);
  assert.equal(parsed.getPageCount(), 1, 'Le nombre de pages doit rester inchangé');
  assert.equal(parsed.getPage(0).getWidth(), page.getWidth());
  assert.equal(parsed.getPage(0).getHeight(), page.getHeight());
  target.__seed(input, [{
    kind: 'redact', page: 0, x: .09, y: .09, w: .25, h: .035, font: 12, value: 'REMPLACEMENT'
  }]);
  const edited = Buffer.from(await (await target.exportPdf()).arrayBuffer());
  assert.equal((await PDFDocument.load(edited)).getPageCount(), 1);
  const extract = spawnSync('pdftotext', ['-', '-'], { input: edited, encoding: 'utf8' });
  if (extract.error?.code !== 'ENOENT') {
    assert.equal(extract.status, 0, extract.stderr);
    assert.match(extract.stdout, /FRAGMENT A CONSERVER/);
    assert.match(extract.stdout, /REMPLACEMENT/);
    assert.doesNotMatch(extract.stdout, /FRAGMENT A EFFACER|Le PDF original/);
  }
  console.log('PDF réel : lecture identique, écriture vectorielle valide, pagination conservée.');
}
run().catch(e => { console.error(e); process.exitCode=1; });
