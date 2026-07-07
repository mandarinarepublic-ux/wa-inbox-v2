// Service worker mínimo — solo habilita la instalación como app.
// NO tiene handler de fetch → nunca intercepta ni cachea /api/* (van a la red).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
