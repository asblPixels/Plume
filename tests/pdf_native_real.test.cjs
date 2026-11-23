/* Test d'intégrité PDF avec le vrai moteur pdf-lib embarqué.
 * node tests/pdf_native_real.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
    document: {},
  };
  vm.createContext(ctx);
  const script = fs.readFileSync(path.join(__dirname, '..', 'js', 'pdf-editor.js'), 'utf8');
  const hooked = script.replace(
    '  return { open, close, exportPdf,',
    '  return { __seed(data, change) { original = data; edits = change; }, open, close, exportPdf,'
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
  console.log('PDF réel : lecture identique, écriture vectorielle valide, pagination conservée.');
}
run().catch(e => { console.error(e); process.exitCode=1; });
