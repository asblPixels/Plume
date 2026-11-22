/* Plume — service worker : l'application fonctionne hors ligne */
const CACHE = 'plume-v10';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'css/plume.css', 'vendor/jszip.min.js', 'vendor/jspdf.umd.min.js', 'vendor/html2canvas.min.js',
  'js/icons.js', 'js/util.js', 'js/docx-import.js', 'js/docx-export.js', 'js/embed-fonts.js', 'js/odt.js', 'js/rtf.js', 'js/markdown.js', 'js/legacy.js', 'js/formats.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'js/editor.js', 'js/ribbon.js', 'js/backstage.js', 'js/tools.js', 'js/native.js', 'js/app.js',
  'css/fonts.css', 'vendor/fonts/andika-latin-400-italic.woff2', 'vendor/fonts/andika-latin-400-normal.woff2', 'vendor/fonts/andika-latin-700-italic.woff2', 'vendor/fonts/andika-latin-700-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-400-italic.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-700-italic.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2', 'vendor/fonts/comic-neue-latin-400-italic.woff2', 'vendor/fonts/comic-neue-latin-400-normal.woff2', 'vendor/fonts/comic-neue-latin-700-italic.woff2', 'vendor/fonts/comic-neue-latin-700-normal.woff2', 'vendor/fonts/lexend-latin-400-normal.woff2', 'vendor/fonts/lexend-latin-700-normal.woff2', 'vendor/fonts/opendyslexic-latin-400-italic.woff2', 'vendor/fonts/opendyslexic-latin-400-normal.woff2', 'vendor/fonts/opendyslexic-latin-700-italic.woff2', 'vendor/fonts/opendyslexic-latin-700-normal.woff2', 'vendor/fonts/playwrite-fr-moderne-latin-400-normal.woff2', 'vendor/fonts/playwrite-fr-trad-latin-400-normal.woff2', 'vendor/fonts/marelle-regular.woff2', 'vendor/fonts/borel-latin-400-normal.woff2', 'vendor/fonts/borel-latin-ext-400-normal.woff2', 'icons/favicon.svg', 'icons/plume-wordmark-light.svg', 'icons/plume-wordmark-dark.svg', 'icons/favicon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
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
