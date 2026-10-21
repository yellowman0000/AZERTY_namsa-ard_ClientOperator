const CACHE_NAME = 'namsaard-operator-shell-v1';
const APP_SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(APP_SHELL_URL, { cache: 'reload' });
      if (!response.ok) {
        throw new Error(`Could not cache the operator app shell (${response.status}).`);
      }

      const shell = await response.clone().text();
      await cache.put(APP_SHELL_URL, response);

      const assets = new Set();
      const assetPattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g;
      for (const match of shell.matchAll(assetPattern)) {
        const asset = new URL(match[1], self.location.origin);
        if (asset.origin === self.location.origin) assets.add(asset.href);
      }

      await Promise.all(
        [...assets].map(async (url) => {
          try {
            const assetResponse = await fetch(url);
            if (assetResponse.ok) await cache.put(url, assetResponse);
          } catch (error) {
            console.warn('[ServiceWorker] Could not precache app asset:', url, error);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('namsaard-operator-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok && url.pathname === APP_SHELL_URL) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(APP_SHELL_URL, response.clone());
          }
          return response;
        } catch {
          const cachedShell = await caches.match(APP_SHELL_URL);
          return cachedShell || new Response('Operator app is not available offline yet.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      })()
    );
  }
});
