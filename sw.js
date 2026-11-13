// Service Worker: legt alle App-Dateien für den Offline-Betrieb in den Cache
const CACHE = 'jobradar-v9';
const DATEIEN = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './data/jobs.json',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Installation: alle Dateien vorladen
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)));
  self.skipWaiting();
});

// Aktivierung: alte Caches entfernen
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Abrufe: Stellen zuerst vom Netz (aktuell), alles andere zuerst aus dem Cache
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Live-Stellen nie aus dem Service-Worker-Cache (die App speichert sie selbst für offline)
  if (url.pathname.includes('/api/')) return;

  if (url.pathname.endsWith('/data/jobs.json')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const kopie = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((treffer) => treffer || fetch(e.request))
  );
});
