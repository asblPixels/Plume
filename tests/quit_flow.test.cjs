/* Plume — tests de sortie multios sans créer de fenêtre Electron.
 * node tests/quit_flow.test.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = read('js/app.js'), main = read('desktop/main.js');
const start = app.indexOf('  async requestQuit() {');
const end = app.indexOf('  /* ---------- Documents ---------- */', start);
assert.ok(start > -1 && end > start, 'La méthode requestQuit est introuvable');
const method = app.slice(start,end);
let calls, answer, savingWorks, mobile;
function build(dirty) {
  calls = []; answer = 'cancel'; savingWorks = false; mobile = false;
  const box = {
    window: { plumeDesktop: {
      quit: async () => { calls.push('quit-desktop'); return true; }
    }, Native: null },
    Native: {
      get on() { return mobile; },
      plugin: () => ({ exitApp: async () => { calls.push('quit-mobile'); } })
    },
    dialog: async () => { calls.push('dialog'); return answer; },
  };
  vm.createContext(box);
  vm.runInContext('this.App = { dirty: ' + dirty + ', _quitAllowed: false,'+
    ' async save() { this.dirty = !savingWorks; calls.push("save"); },'+
    ' '+method+' };', { ...box, calls });
  return box.App;
}
async function run() {
  let target = build(false);
  await target.requestQuit();
  assert.deepEqual(calls, ['quit-desktop']);
  assert.equal(target._quitAllowed, true);

  target = build(true);
  await target.requestQuit();
  assert.deepEqual(calls, ['dialog'], 'Annuler doit conserver la fenêtre');
  assert.equal(target._quitAllowed, false);

  target = build(true);
  answer = 'save';
  await target.requestQuit();
  assert.deepEqual(calls, ['dialog', 'save'], 'Un échec ou une annulation de sauvegarde empêche la sortie');

  target = build(true);
  answer = 'save'; savingWorks = true;
  await target.requestQuit();
  assert.deepEqual(calls, ['dialog', 'save', 'quit-desktop']);

  target = build(true);
  answer = 'discard';
  await target.requestQuit();
  assert.deepEqual(calls, ['dialog', 'quit-desktop']);
  assert.equal(target._quitAllowed, true, 'Le garde-fou beforeunload doit reconnaître le choix explicite');

  target = build(false);
  mobile = true; target._quitAllowed = false;
  // Si le pont de bureau est absent, le système mobile reçoit la fermeture.
  const mobileBox = { window: {}, Native: {
    on: true, plugin: () => ({ exitApp: async () => calls.push('quit-mobile') })
  }, dialog: async () => 'cancel', calls: [] };
  vm.createContext(mobileBox);
  vm.runInContext('this.App={dirty:false, '+method+'};',mobileBox);
  await mobileBox.App.requestQuit();
  assert.deepEqual(mobileBox.calls,['quit-mobile']);

  assert.match(main, /win\.on\('close', requestWindowClose\)/, 'Fermeture native interceptée');
  assert.match(main, /ipcMain\.handle\('plume:quit'/, 'IPC de fermeture native');
  assert.match(read('desktop/preload.js'), /onQuitRequested/, 'Notification de fermeture disponible');
  assert.match(read('js/backstage.js'), /\['quit', 'Quitter Plume'/, 'Menu Fichier Quitter');
  assert.match(read('js/native.js'), /App\.requestQuit\(\)/, 'Retour Android sécurisé');
  assert.match(app, /if \(!this\._quitAllowed && this\.dirty/, 'beforeunload ne doit pas bloquer une fermeture confirmée');
  console.log('Sortie Plume : tests réussis pour Linux, Windows, macOS, Android et protection des documents.');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
