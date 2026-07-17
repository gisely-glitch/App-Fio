// sw.js — Minimal service worker: enables PWA installability, the Web Share
// Target flow (share_target uses GET to index.html, so no fetch interception
// is required for it to work), a small offline app-shell cache, and relays
// local notification clicks back to focus the app.

const CACHE_NAME = 'fio-cache-v2';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/parsers.js',
  './js/appointments.js',
  './js/finance.js',
  './js/documents.js',
  './js/notifications.js',
  './js/voice.js',
  './js/ocr.js',
  './js/share.js',
  './js/integrations/google.js',
  './js/integrations/gmail.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[Fio SW] Falha ao popular cache do app shell:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

// Network-first for navigation requests (so users get fresh app logic when
// online), falling back to the cached shell when offline. Cache-first for
// same-origin static assets.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      return response;
    }).catch(() => cached))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
