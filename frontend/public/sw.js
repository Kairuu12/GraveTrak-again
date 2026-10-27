/* GraveTrak Progressive Web App (PWA) Service Worker */
const CACHE_NAME = 'gravetrak-v12-private-api-bypass';
const TILES_CACHE_NAME = 'gravetrak-tiles-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/gravetrak-app-icon-192.png',
  '/icons/gravetrak-app-icon-512.png',
  '/icons/gravetrak-logo.svg',
];

// Install: Precache shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_NAME, TILES_CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            console.log('[SW] Deleting obsolete cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Smart Caching Strategies
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore non-GET requests (e.g. POST, PUT, DELETE) from cache handling
  if (request.method !== 'GET') {
    return;
  }

  // Online imagery uses normal browser caching; do not build an offline
  // satellite-tile archive or duplicate imagery in the PWA asset cache.
  if (url.hostname === 'services.arcgisonline.com' && url.pathname.includes('/World_Imagery/MapServer/tile/')) {
    return;
  }

  // Strategy 1: Map Tiles (OpenStreetMap, CartoDB, etc.)
  // Cache-first to keep cemetery map imagery available offline
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('cartocdn.com') ||
    url.pathname.includes('/tiles/')
  ) {
    event.respondWith(
      caches.open(TILES_CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // If offline and not in cache, fallback or transparent fail
          return cachedResponse || new Response('', { status: 408, statusText: 'Offline tile unavailable' });
        }
      })
    );
    return;
  }

  // Account data and documents must never fall back to another session's
  // response. Activation above removes the old shared API cache.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Strategy 3: Navigation Requests (SPA Root HTML Fallback)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedIndex = await caches.match('/index.html');
        return cachedIndex || caches.match('/');
      })
    );
    return;
  }

  // Strategy 4: Static Assets (JS, CSS, Images, Fonts) -> Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
