/* Tests isolés de reconnaissance OOXML : aucune installation nécessaire.
 * Exécution : node tests/formats_word.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

let packageParts = {};
const context = {
  console,
  Uint8Array,
  TextDecoder,
  OfficeArchive: {
    limits: { compressed: 128 * 1024 * 1024 },
    async load() {
      return { file(name) {
        return Object.prototype.hasOwnProperty.call(packageParts, name)
          ? { async: async () => packageParts[name] }
          : null;
      } };
    }
  },
  DocxImport: { importDocx: async () => ({ source: null, html: '<p>OK</p>' }) },
  DocxExport: { hasMacros: () => false },
};
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'formats.js'), 'utf8');
vm.runInContext(source + '\nthis.FormatsForTests = Formats;', context, { filename: 'formats.js' });
const Formats = context.FormatsForTests;
const pkg = mime => ({
  'word/document.xml': '<w:document/>',
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ContentType="' + mime + '"/></Types>'
});
const payload = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0, 0, 0, 0]);
const file = name => ({ name, arrayBuffer: async () => payload.buffer });
const flavors = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  dotm: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml'
};
async function check() {
  for (const [real, mime] of Object.entries(flavors)) {
    for (const extension of Object.keys(flavors)) {
      packageParts = pkg(mime);
      const result = await Formats.open(file('exemple.' + extension));
      assert.equal(result.format, real,
        'Le contenu ' + real + ' doit primer sur l’extension ' + extension);
    }
  }
  packageParts = { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' };
  await assert.rejects(() => Formats.open(file('faux.docx')), /INVALID_WORD/);
  packageParts = { 'word/document.xml': '<w:document/>' };
  assert.equal((await Formats.open(file('ancien.docx'))).format, 'docx');
  console.log('18 contrôles OOXML réussis : variantes DOCX/DOCM/DOTX/DOTM, faux fichier et ancien document.');
}
check().catch(error => { console.error(error); process.exitCode = 1; });
