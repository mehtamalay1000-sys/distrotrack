// ================================================================
// DistroTrack v2 — Stage 9E: Production Progressive Web App Service Worker
// File: public/sw.js
// ================================================================

const CACHE_VERSION = 'distrotrack-v1';
const SHELL_CACHE_NAME = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE_NAME = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/distrotrack_logo.png',
  '/icon-192.png',
  '/icon-512.png',
];

const BACKGROUND_SYNC_TAG = 'distrotrack-outbox-sync';
const SW_BACKGROUND_SYNC_MESSAGE = 'DISTROTRACK_BACKGROUND_SYNC_TRIGGER';

// ── 1. Install Lifecycle ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => {
      // Precache application shell assets
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Precache asset fetch failure:', err);
      });
    })
  );
});

// ── 2. Activate Lifecycle ────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete obsolete DistroTrack cache versions
            if (
              cacheName.startsWith('distrotrack-') &&
              cacheName !== SHELL_CACHE_NAME &&
              cacheName !== RUNTIME_CACHE_NAME
            ) {
              return caches.delete(cacheName);
            }
            return Promise.resolve(false);
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ── 3. Fetch Event Routing & Strategy ─────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // A. SECURITY: Never cache sensitive Supabase API / RPC / Auth requests
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/rpc') ||
    url.pathname.startsWith('/auth/v1')
  ) {
    // Network-only bypass
    return;
  }

  // B. NAVIGATION FALLBACK: For SPA navigation requests (e.g. /w, /w/route, /login)
  // Network-first with cached /index.html fallback when offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => {
              cache.put('/index.html', clone).catch(() => {});
            });
          }
          return response;
        })
        .catch(async () => {
          // Offline fallback: serve cached application shell
          const cached = await caches.match('/index.html');
          if (cached) {
            return cached;
          }
          return caches.match('/');
        })
    );
    return;
  }

  // C. STATIC ASSETS: Cache-first for scripts, styles, fonts, and images
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.ico') ||
      url.pathname.endsWith('.woff2'));

  const isCdnFont =
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset || isCdnFont) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request)
          .then((networkResponse) => {
            if (
              networkResponse &&
              (networkResponse.status === 200 || networkResponse.type === 'opaque')
            ) {
              const responseClone = networkResponse.clone();
              caches.open(RUNTIME_CACHE_NAME).then((cache) => {
                cache.put(request, responseClone).catch(() => {});
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Return fallback if available
            return caches.match(request);
          });
      })
    );
    return;
  }
});

// ── 4. Message Handling & Update Lifecycle ────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'GET_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({
        type: 'VERSION',
        version: CACHE_VERSION,
        shellCache: SHELL_CACHE_NAME,
        runtimeCache: RUNTIME_CACHE_NAME,
      });
    }
  }
});

// ── 5. Stage 9D Background Sync Relay ─────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === BACKGROUND_SYNC_TAG) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({
            type: SW_BACKGROUND_SYNC_MESSAGE,
            tag: event.tag,
            timestamp: new Date().toISOString(),
          });
        }
      })
    );
  }
});
