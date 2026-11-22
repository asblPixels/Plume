/* Plume — service worker : l'application fonctionne hors ligne */
const CACHE = 'plume-1.4.0';   // mis à jour par outils/version.js
/* liste des fichiers lue dans version.json : rien à maintenir à la main */
const FILES = () => fetch('version.json', { cache: 'no-cache' }).then(r => r.json()).then(v => ['./', 'version.json', ...v.files.map(f => f.path).filter(p => !p.startsWith('vendor/fonts/ttf/'))]);
self.addEventListener('install', e => { e.waitUntil(Promise.all([caches.open(CACHE), FILES()]).then(([c, f]) => c.addAll(f))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
/* Réseau d'abord (mises à jour), cache si hors ligne */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
