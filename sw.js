const CACHE_NAME = 'ilahia-campus-shell-v65';
const APP_SHELL = ['/', '/canteen.html', '/canteen-admin.html', '/manifest.webmanifest', '/assets/icons/ilahia-ecosystem-appicon-i-v35-180.png', '/assets/icons/ilahia-ecosystem-appicon-i-v35-192.png', '/assets/icons/ilahia-ecosystem-appicon-i-v35-512.png', '/assets/icons/ilahia-ecosystem-appicon-i-v35-1024.png', '/assets/icons/ilahia-ecosystem-appicon-i-v35-maskable-512.png', '/assets/icons/ilahia-ecosystem-wordmark-gold.png', '/assets/campuses/ilahia-public-school-hero.jpg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ilahia-campus-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match('/')) || Response.error()));
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});
