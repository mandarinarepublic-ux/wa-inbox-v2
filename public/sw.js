// Service worker — habilita la instalación como app y recibe los avisos de push.
// NO tiene handler de fetch → nunca intercepta ni cachea /api/* (van a la red).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ── Avisos de mensajes nuevos ────────────────────────────────────────────────
// Si el inbox está al FRENTE no molestamos (lo pidió el usuario): igual avisamos a
// la pestaña para que refresque su contador.
//
// Ojo: el navegador espera que todo push recibido muestre algo. Suprimir consume un
// presupuesto; si se agota, Chrome muestra un genérico "Este sitio se actualizó en
// segundo plano". Si eso aparece, la salida es mostrar siempre.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = {} }

  const titulo = d.titulo || 'Mensaje nuevo'
  const cuerpo = d.cuerpo || ''
  const url    = d.url || '/inbox'
  const tag    = d.tag || 'inbox'
  const tel    = d.tel || ''

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    // Avisar SIEMPRE a las pestañas abiertas para que refresquen.
    for (const w of wins) {
      w.postMessage({ tipo: 'push-recibido', url })
    }

    // ¿Hay una ventana del inbox enfocada? Entonces el usuario ya está mirando.
    const mirando = wins.some((w) => w.focused)
    if (mirando) return

    await self.registration.showNotification(titulo, {
      body: cuerpo,
      tag,                                  // un aviso por chat: el nuevo reemplaza al anterior
      renotify: d.renotify !== false,       // …y suena, salvo que sea la misma ráfaga
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url, tel },
    })
  })())
})

// Al tocar el aviso: si ya hay una pestaña del inbox abierta la enfocamos y le
// decimos por postMessage qué chat abrir (más confiable que navegar por URL, que en
// una app de una sola página puede no re-montar nada). Si no hay ninguna, abrimos
// una con ?tel= en el enlace, que App.jsx lee al arrancar.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = event.notification.data?.url || '/inbox'
  const tel     = event.notification.data?.tel || ''

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus()
        w.postMessage({ tipo: 'abrir-chat', tel })
        return
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino)
  })())
})
