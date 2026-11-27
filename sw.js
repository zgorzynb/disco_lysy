/* Service worker – potrzebny, żeby Android proponował „Zainstaluj aplikację”.
 * Nic nie zapisuje offline. Pliki aplikacji zawsze sprawdza w sieci (bez starej kopii
 * z pamięci przeglądarki), więc po publikacji nowa wersja działa od razu. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => fetch(req)));
});
