// =========================================================
// Service Worker — GastosBOTijo
// Estrategias:
//   - Cache-first:           shell (HTML, CSS, JS, iconos)
//   - Network-only:          Google APIs (tokens / datos en tiempo real)
//   - Network-first + cache: CDN externo (Chart.js)
// =========================================================

const CACHE_NAME  = 'gastos-shell-v9';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/reset.css',
  '/css/variables.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/config.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/sheets.js',
  '/js/state.js',
  '/js/views/transactions.js',
  '/js/views/budgets.js',
  '/js/views/reports.js',
  '/js/views/charts.js',
  '/js/views/addExpense.js',
  '/js/views/settings.js',
  '/js/views/debts.js',
  '/js/expense/parser.js',
  '/js/expense/normalizer.js',
  '/js/expense/classifier.js',
  '/js/utils/colors.js',
  '/js/utils/formatters.js',
  '/js/utils/dom.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// =========================================================
// Install — precachear el shell
// =========================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// =========================================================
// Activate — eliminar cachés antiguas
// =========================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// =========================================================
// Fetch — routing por origen
// =========================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo gestionar peticiones http/https (ignorar chrome-extension, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // NETWORK-ONLY: Google APIs (datos en vivo, tokens OAuth)
  if (
    url.hostname === 'sheets.googleapis.com' ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'oauth2.googleapis.com'
  ) {
    return; // deja que el navegador haga la petición directamente
  }

  // NETWORK-FIRST + CACHE FALLBACK: CDN externos
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(_networkFirstWithCache(request));
    return;
  }

  // CACHE-FIRST: shell de la app
  event.respondWith(_cacheFirst(request));
});

// =========================================================
// Estrategias
// =========================================================

async function _cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin red y sin caché → devolvemos index.html para SPA
    const fallback = await caches.match('/index.html');
    return fallback ?? new Response('Offline', { status: 503 });
  }
}

async function _networkFirstWithCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('Offline', { status: 503 });
  }
}
