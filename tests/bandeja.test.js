// La ventana de 24 h de WhatsApp es por par (cliente ↔ número NUESTRO), no por
// cliente, y por dónde sale una respuesta lo decide la CONVERSACIÓN, no la pestaña.
//
// Esas dos reglas mandaron 9 mensajes a la basura en agosto: 3 el 19-ago (un
// cliente escribió por REPUBLIC y las respuestas salieron por MANDI, rechazadas
// con 131047) y 6 el 16-ago, a alguien que NUNCA había escrito a ese número.
//
// Estas son las primeras pruebas multi-número del repo. No había ninguna, y por
// eso esta familia de bugs llegó a producción cinco veces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canalDeEnvio, ventanaAbierta, patchesDeMensaje, VENTANA_MS } from '../lib/bandeja.js'

const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'

// ── Por dónde sale la respuesta ───────────────────────────────────────────────

test('manda la CONVERSACIÓN, no la pestaña', () => {
  // El caso de trabajo real: estás en GENERAL (donde conviven los dos números) y
  // abres el chat de REPUBLIC. La respuesta sale por REPUBLIC.
  assert.equal(canalDeEnvio({ conversacion: REPUBLIC, pestana: MANDI }), REPUBLIC)
})

test('sin conversación abierta cae a la pestaña', () => {
  // CONTACTOS y las plantillas mandan sin tener un chat abierto.
  assert.equal(canalDeEnvio({ conversacion: '', pestana: REPUBLIC }), REPUBLIC)
})

test('NUNCA devuelve vacío', () => {
  // Un `Canal` vacío no falla: cae al número principal EN SILENCIO (ver `canalDe`
  // en /api/saliente). Así es exactamente como mueren los mensajes.
  assert.equal(canalDeEnvio({ porDefecto: MANDI }), MANDI)
  assert.equal(canalDeEnvio({}), '')
  assert.equal(canalDeEnvio(), '')
})

// ── La ventana de 24 h, por canal ─────────────────────────────────────────────

test('la ventana se mide POR CANAL, no por persona', () => {
  // El caso exacto del 19-ago: escribió por REPUBLIC hace 20 minutos y por MANDI
  // hace 35 días. La app medía "escribió hace 20 minutos" —el dato de la persona—
  // y dejaba salir el mensaje por MANDI. Meta lo rechazó.
  const ahora = Date.parse('2026-08-19T16:40:00Z')
  assert.equal(ventanaAbierta('2026-08-19T16:20:35Z', ahora), true)   // REPUBLIC
  assert.equal(ventanaAbierta('2026-07-15T19:08:58Z', ahora), false)  // MANDI
})

test('un canal sin NINGÚN entrante tiene la ventana cerrada (el caso del 16-ago)', () => {
  // Ese cliente nunca escribió a MANDI y le mandamos 6 mensajes por ahí. Los 6
  // murieron. Sin entrante no hay ventana: nunca se abrió.
  assert.equal(ventanaAbierta(null, Date.now()), false)
  assert.equal(ventanaAbierta('', Date.now()), false)
})

test('la ventana cierra exactamente a las 24 h', () => {
  const ahora = Date.parse('2026-08-20T12:00:00Z')
  assert.equal(ventanaAbierta(new Date(ahora - VENTANA_MS + 1000).toISOString(), ahora), true)
  assert.equal(ventanaAbierta(new Date(ahora - VENTANA_MS - 1000).toISOString(), ahora), false)
})

test('una fecha corrupta deja la ventana CERRADA, no abierta', () => {
  // Ante la duda, cerrada: un falso "abierta" manda un mensaje que muere en Meta
  // y el vendedor cree que llegó. Un falso "cerrada" solo obliga a usar plantilla.
  assert.equal(ventanaAbierta('no-es-fecha', Date.now()), false)
})

// ── El efecto bola de nieve ───────────────────────────────────────────────────
// Antes, CUALQUIER mensaje —incluido uno que salía— redefinía "el canal de esta
// persona" en `conversaciones.phone_id`, y la interfaz leía ese campo para decidir
// por dónde mandar el siguiente. Así, el primer mensaje que salía por el número
// equivocado CONTAMINABA la ficha y arrastraba a todos los que venían detrás.

test('un SALIENTE no cambia el canal de la persona', () => {
  const { conv } = patchesDeMensaje({ direccion: 'SALIENTE', phone_id: MANDI, fecha: '2026-08-19T16:49:29Z' })
  assert.equal(conv.phone_id, undefined, 'un saliente NO puede redefinir el canal del cliente')
  assert.equal(conv.ultimo_entrante_at, undefined, 'un saliente tampoco reabre la ventana de 24h')
})

test('un ENTRANTE sí cambia el canal de la persona', () => {
  const { conv } = patchesDeMensaje({ direccion: 'ENTRANTE', phone_id: REPUBLIC, fecha: '2026-08-19T16:11:31Z' })
  assert.equal(conv.phone_id, REPUBLIC)
  assert.equal(conv.ultimo_entrante_at, '2026-08-19T16:11:31Z')
})

test('un ENTRANTE reabre a PENDIENTE, y solo la bandeja de SU canal', () => {
  const { bandeja } = patchesDeMensaje({ direccion: 'ENTRANTE', phone_id: REPUBLIC, fecha: '2026-08-19T16:11:31Z' })
  assert.equal(bandeja.estado, 'PENDIENTE')
  assert.equal(bandeja.ultimo_entrante_at, '2026-08-19T16:11:31Z')
})

test('un SALIENTE NO reabre la bandeja (contestar no es un pendiente nuevo)', () => {
  const { bandeja } = patchesDeMensaje({ direccion: 'SALIENTE', phone_id: MANDI, fecha: '2026-08-19T16:49:29Z' })
  assert.equal(bandeja.estado, undefined)
  assert.equal(bandeja.ultimo_mensaje_at, '2026-08-19T16:49:29Z')
})

test('sin phone_id NO se escribe bandeja (una fila sin canal no significa nada)', () => {
  const { bandeja } = patchesDeMensaje({ direccion: 'ENTRANTE', phone_id: null, fecha: '2026-08-19T16:11:31Z' })
  assert.equal(bandeja, null)
})

test('la dirección en minúsculas se trata igual que en MAYÚSCULAS', () => {
  // En la base está en MAYÚSCULAS, pero una sola fila en minúsculas haría que un
  // entrante no reabra la bandeja y el cliente desaparezca de Pendientes.
  const { bandeja } = patchesDeMensaje({ direccion: 'entrante', phone_id: MANDI, fecha: '2026-08-19T16:11:31Z' })
  assert.equal(bandeja.estado, 'PENDIENTE')
})
