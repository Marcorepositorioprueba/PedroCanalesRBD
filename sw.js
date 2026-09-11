// sw.js — service worker mínimo para PWA
// Cachea el shell (HTML/CSS/JS) para que cargue aunque no haya red.
// NO cachea llamadas a Apps Script (datos siempre frescos).
const CACHE = 'pc-shell-v3'; // v3: V2 — simpatizantes, roles por líder, panel admin, aviso de privacidad
const SHELL = [
  './',
  './index.html',
  './app.html',
  './aviso-privacidad.html',
  './css/styles.css',
  './js/config.js',
  './js/ui.js',
  './js/api.js',
  './js/auth.js',
  './manifest.webmanifest',
  './assets/img/icon-192.svg',
  './assets/img/icon-512.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // No cachear requests al backend (Apps Script)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return;
  }
  // Network-first para HTML/JS/CSS (revalidar siempre)
  if (e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request).then((resp) => {
        const clone = resp.clone();
        if (resp.ok) caches.open(CACHE).then((c) => c.put(e.request, clone));
        return resp;
      }).catch(() => caches.match(e.request))
    );
  }
});