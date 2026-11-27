/* Minimalny service worker – potrzebny, żeby Android proponował „Zainstaluj aplikację”.
 * Celowo nic nie zapisuje offline: aplikacja i tak wymaga internetu (YouTube). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* przepuszczamy wszystko do sieci */ });
