// Service worker mínimo.
// - Network-first para os arquivos do próprio site (HTML, JS, CSS, ícones):
//   sempre busca a versão nova; o cache só é usado quando está offline.
// - Nunca intercepta chamadas ao Supabase nem a outros domínios.
// - Para publicar uma versão que invalide o cache antigo, aumente CACHE_VERSION.

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'gisela-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isSupabase(url) {
  return /\.supabase\.(co|in)$/.test(url.hostname) || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isSupabase(url)) return; // segue direto para a rede

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Offline: páginas com query string (?mes=2026-09) usam a versão em cache sem a query.
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const home = await cache.match('index.html', { ignoreSearch: true });
      if (home) return home;
    }
    throw error;
  }
}
