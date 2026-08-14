// La lista de rutas públicas es lo más delicado de todo el candado: una de menos
// y dejas de recibir mensajes de Meta. Estas pruebas son el inventario del
// 7-ago-2026 convertido en red de seguridad.
import test from 'node:test'
import assert from 'node:assert'
import { esRutaPublica } from '../lib/rutas-publicas.js'

// Las 5 que NUNCA pueden pedir sesión. Cada una se defiende sola.
const PUBLICAS = [
  '/api/webhook',            // Meta (WhatsApp) — 1035 llamadas en 24h
  '/api/social/webhook',     // Meta (FB/IG)
  '/api/cron/seguimientos',  // cron de Vercel, cada hora
  '/api/cron/pendientes',    // cron de Vercel, cada 5 min — recordatorio Telegram
  '/api/pago-dlocal',        // dLocal, ya protegida con secreto en la URL
]

// Todo lo demás del inventario: son del navegador y van protegidas.
const PROTEGIDAS = [
  '/api/automatizaciones', '/api/buscar', '/api/capi/diag', '/api/cliente-pedidos',
  '/api/contactos', '/api/contactos/estado', '/api/conversacion', '/api/dashboard',
  '/api/directorio', '/api/hilo', '/api/inbox-sync', '/api/linkpago', '/api/lista', '/api/media',
  '/api/media/precache', '/api/media/upload', '/api/mensaje', '/api/mensajes',
  '/api/notas', '/api/plantillas', '/api/push/subscribe', '/api/push/test',
  '/api/respuestas', '/api/saliente', '/api/social/estado', '/api/social/ingest',
  '/api/social/lista', '/api/social/media', '/api/social/saliente', '/api/tienda',
  '/api/upload-foto', '/api/upload-url',
  '/inbox', '/dashboard',
]

for (const ruta of PUBLICAS) {
  test(`PÚBLICA: ${ruta}`, () => {
    assert.strictEqual(esRutaPublica(ruta), true, `${ruta} tiene que quedar abierta`)
  })
}

for (const ruta of PROTEGIDAS) {
  test(`PROTEGIDA: ${ruta}`, () => {
    assert.strictEqual(esRutaPublica(ruta), false, `${ruta} NO puede quedar abierta`)
  })
}

test('el prefijo no alcanza para colarse', () => {
  // /api/webhook-falso NO es /api/webhook. Si se compara con startsWith a secas,
  // cualquiera abre una puerta agregándole texto al final.
  assert.strictEqual(esRutaPublica('/api/webhook-falso'), false)
  assert.strictEqual(esRutaPublica('/api/webhookeria'), false)
})

test('las subrutas de una pública SÍ son públicas', () => {
  // Meta puede llamar con subruta; el cron también.
  assert.strictEqual(esRutaPublica('/api/webhook/'), true)
  assert.strictEqual(esRutaPublica('/api/cron/seguimientos'), true)
})

test('la barra final no cambia la decisión', () => {
  assert.strictEqual(esRutaPublica('/api/hilo/'), false)
})
