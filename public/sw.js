// Service worker mínimo — habilita la instalación como app (Android/Chrome).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
// Un handler de fetch (aunque no cachee) es requisito para el prompt de instalar.
self.addEventListener('fetch', () => {})
