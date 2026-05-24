const CACHE_NAME = 'hamsog-v7-online';
const ASSETS = ['/', '/index.html', '/admin-v4.html', '/styles.css', '/app.js', '/admin.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => { const clone = response.clone(); if (event.request.method === 'GET' && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)); return response; }).catch(() => caches.match(event.request).then(r => r || caches.match('/'))));
});
