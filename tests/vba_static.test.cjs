'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function integer(value, width) {
  const bytes = Buffer.alloc(width);
  bytes.writeUIntLE(value, 0, width);
  return bytes;
}
function record(id, data = Buffer.alloc(0)) {
  return Buffer.concat([integer(id, 2), integer(data.length, 4), data]);
}
function compressed(data) {
  const groups = [];
  for (let i = 0; i < data.length; i += 8) groups.push(Buffer.from([0]), data.subarray(i, i + 8));
  const payload = Buffer.concat(groups);
  return Buffer.concat([Buffer.from([1]), integer(0xb000 | (payload.length - 1), 2), payload]);
}

const code = 'Public Sub TestSimple()\r\nEnd Sub\r\nPrivate Function Local() As Integer\r\nEnd Function';
const moduleName = 'ModuleExemple';
const records = Buffer.concat([
  record(1, integer(1, 4)), record(2, integer(1033, 4)), record(0x14, integer(1033, 4)),
  record(3, integer(1252, 2)), record(0x0f, integer(1, 2)), record(0x13, integer(0, 2)),
  record(0x19, Buffer.from(moduleName)), record(0x1a, Buffer.from(moduleName)),
  record(0x32, Buffer.from(moduleName, 'utf16le')), record(0x1c), record(0x48),
  record(0x31, integer(3, 4)), record(0x1e, integer(0, 4)), record(0x2c, integer(0, 2)),
  record(0x21), record(0x2b), record(0x10)
]);

const streams = { dir: compressed(records), [moduleName]: Buffer.concat([
  Buffer.from([42, 0, 0]), compressed(Buffer.from(code))
]) };
const globals = {
  TextDecoder,
  LegacyDoc: {
    readCfb(_bytes, names) {
      return Object.fromEntries([...names].map(name => [name, streams[name]]));
    }
  }
};
const sandbox = vm.createContext(globals);
const reader = vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/vba.js'), 'utf8') +
  '\nVbaProject', sandbox);
const [moduleData] = reader.readSources(new Uint8Array());
assert.equal(moduleData.name, moduleName);
assert.equal(moduleData.source, code);
assert.deepEqual(Array.from(moduleData.procedures), ['TestSimple', 'Local']);
streams[moduleName] = Buffer.from([0, 0, 0, 1, 0x02, 0xb0, 1, 0, 0]);
assert.equal(reader.readSources(new Uint8Array())[0].source, null, 'Une copie sans octet source est refusée.');
streams.dir = Buffer.from([1, 0xff, 0xbf, 0]);
assert.throws(() => reader.readSources(new Uint8Array()), /Flux VBA non valide/);
console.log('Source VBA, inventaire des procédures et flux invalides vérifiés.');
