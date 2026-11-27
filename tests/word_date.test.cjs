const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/editor.js'), 'utf8');
const dateFormat = vm.runInNewContext(source + '\nEd.formatWordDate', { debounce: f => f });
assert.equal(dateFormat('2028-02-29', { dateFormat: 'dd/MM/yyyy' }), '29/02/2028');
assert.equal(dateFormat('2027-04-03', { dateFormat: 'yyyyMMdd' }), '20270403');
assert.equal(dateFormat('2026-11-27', { dateFormat: "dddd d MMMM yyyy 'à Paris'", lid: 'fr-FR' }),
  'vendredi 27 novembre 2026 à Paris');
assert.equal(dateFormat('2026-11-27', { dateFormat: 'ddd, MMM d, yy', lid: 'en-US' }), 'Fri, Nov 27, 26');
assert.equal(dateFormat('2026-02-30', { dateFormat: 'dd/MM/yyyy' }), null);
assert.equal(dateFormat('2026-11-27', { dateFormat: 'dd/MM/yyyy', calendar: 'hijri' }), null);
assert.equal(dateFormat('2026-11-27', { dateFormat: 'dd/MM/yyyy HH:mm' }), null);
assert.equal(dateFormat('2026-11-27', { dateFormat: 'dd/MM/yyyy', lid: '<invalide>' }), null);
