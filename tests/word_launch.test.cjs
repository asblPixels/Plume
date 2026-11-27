'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../desktop/main.js'), 'utf8');
const start = main.indexOf("handle('plume:open-in-word'");
const stop = main.indexOf("handle('plume:write-file'", start);
assert.ok(start >= 0 && stop > start);

const original = 'C:\\Bureau\\Modèle avec espaces.docm';
const copy = 'C:\\Bureau\\Modèle avec espaces - essai VBA identifiant.docm';
const word = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE';
const zone = Buffer.from('[ZoneTransfer]\r\nZoneId=3');
function fixture({ response = 1, copyZone = zone, launchError = false } = {}) {
  const calls = [];
  const webContents = { mainFrame: {} };
  const box = {
    path: path.win32,
    process: { platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } },
    win: { webContents },
    crypto: { randomUUID: () => 'identifiant' },
    grants: { target: file => file },
    handle(_channel, handler) { box.invoke = handler; },
    dialog: { showMessageBox: async () => ({ response }) },
    fs: {
      constants: { COPYFILE_EXCL: 1 },
      existsSync: file => file === word,
      promises: {
        realpath: async file => file,
        stat: async () => ({ isFile: () => true }),
        readFile: async file => {
          if (file === original + ':Zone.Identifier') return zone;
          if (file === copy + ':Zone.Identifier' && copyZone) return copyZone;
          throw Object.assign(new Error('Introuvable'), { code: 'ENOENT' });
        },
        copyFile: async (...args) => calls.push(['copy', ...args]),
        unlink: async file => calls.push(['unlink', file])
      }
    },
    spawn(executable, args) {
      calls.push(['spawn', executable, ...args]);
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => launchError ? child.emit('error', new Error('Word bloqué')) : child.emit('spawn'));
      return child;
    }
  };
  vm.runInNewContext(main.slice(start, stop), box);
  return { calls, invoke: (file = original, frame = webContents.mainFrame) =>
    box.invoke({ sender: webContents, senderFrame: frame }, file) };
}

async function run() {
  let target = fixture();
  assert.equal(await target.invoke(), copy);
  assert.deepEqual(target.calls, [['copy', original, copy, 1], ['spawn', word, '/m', copy]]);

  target = fixture({ response: 0 });
  assert.equal(await target.invoke(), false);
  assert.deepEqual(target.calls, []);
  await assert.rejects(target.invoke(original, {}), /Sélectionnez/);
  await assert.rejects(target.invoke('\\\\serveur\\document.docm'), /Sélectionnez/);

  target = fixture({ copyZone: null });
  await assert.rejects(target.invoke(), /provenance/);
  assert.deepEqual(target.calls, [['copy', original, copy, 1], ['unlink', copy]]);

  target = fixture({ launchError: true });
  await assert.rejects(target.invoke(), /Word bloqué/);
  assert.deepEqual(target.calls.at(-1), ['unlink', copy]);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
