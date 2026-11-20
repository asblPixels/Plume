/* Plume — service worker : l'application fonctionne hors ligne */
const CACHE = 'plume-v5';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/plume.css', 'vendor/jszip.min.js',
  'js/icons.js', 'js/util.js', 'js/docx-import.js', 'js/docx-export.js', 'js/odt.js', 'js/rtf.js', 'js/markdown.js', 'js/legacy.js', 'js/formats.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'js/editor.js', 'js/ribbon.js', 'js/backstage.js', 'js/tools.js', 'js/app.js',
  'icons/favicon.svg', 'icons/plume-wordmark-light.svg', 'icons/plume-wordmark-dark.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
/* Réseau d'abord (mises à jour), cache si hors ligne */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
