// La ventana de 24 h de WhatsApp es por par (cliente ↔ número NUESTRO), no por
// cliente. `inbox.conversaciones` tiene UNA fila por persona y por eso no puede
// decir "a este le contesté por REPUBLIC pero le debo una respuesta por MANDI".
//
// Esa confusión mandó 3 mensajes al número equivocado el 19-ago (Meta los rechazó
// con 131047) y 6 más el 16-ago, a alguien que NUNCA escribió a ese número.
//
// Estas son las primeras pruebas multi-número del repo. No había ninguna, y por eso
// esta familia de bugs llegó a producción cinco veces.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claveBandeja, mapaBandeja, estadoDeBandeja, ventanaAbierta, VENTANA_MS,
  patchesDeMensaje,
} from '../lib/bandeja.js'

const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'
const TEL      = '593960643698'

test('la clave separa al MISMO cliente por número', () => {
  assert.notEqual(claveBandeja(TEL, MANDI), claveBandeja(TEL, REPUBLIC))
})

test('la clave tolera el teléfono en cualquier formato (0987… vs 593987…)', () => {
  // En la base conviven los dos formatos; si la clave no los une, el mismo chat
  // se parte en dos filas del MISMO canal y aparece duplicado sin motivo.
  assert.equal(claveBandeja('0960643698', MANDI), claveBandeja('593960643698', MANDI))
  assert.equal(claveBandeja('+593 96 064 3698', MANDI), claveBandeja('593960643698', MANDI))
})

test('un phone_id vacío NO colisiona con otro vacío de distinto teléfono', () => {
  assert.notEqual(claveBandeja('593111111111', ''), claveBandeja('593222222222', ''))
})

test('el estado de un canal no se contamina con el del otro', () => {
  const mapa = mapaBandeja([
    { telefono: TEL, phone_id: MANDI,    estado: 'PENDIENTE' },
    { telefono: TEL, phone_id: REPUBLIC, estado: 'ATENDIDO'  },
  ])
  assert.equal(estadoDeBandeja(mapa, TEL, MANDI),    'pendiente')
  assert.equal(estadoDeBandeja(mapa, TEL, REPUBLIC), 'atendido')
})

test('contestar por un canal NO apaga el otro (el caso del 19-ago)', () => {
  // Lo que pasó: le contestamos por REPUBLIC y el inbox dio por atendido al
  // cliente entero, incluida la conversación de MANDI que seguía sin responder.
  const mapa = mapaBandeja([
    { telefono: TEL, phone_id: MANDI,    estado: 'PENDIENTE' },
    { telefono: TEL, phone_id: REPUBLIC, estado: 'ATENDIDO'  },
  ])
  const pendientes = [...mapa.values()].filter(b => b.estado === 'pendiente')
  assert.equal(pendientes.length, 1)
  assert.equal(pendientes[0].phoneId, MANDI)
})

test('sin fila en la bandeja el estado es "pendiente", nunca undefined', () => {
  // Un chat recién llegado todavía no tiene fila. Si esto devolviera undefined, la
  // interfaz lo pintaría fuera de toda bandeja y el cliente sería invisible — el
  // bug más reincidente de este inbox.
  assert.equal(estadoDeBandeja(mapaBandeja([]), TEL, MANDI), 'pendiente')
})

test('la ventana de 24 h se mide POR CANAL, no por persona', () => {
  // El caso exacto del 19-ago: escribió por REPUBLIC hace 20 minutos y por MANDI
  // hace 35 días. La app medía "escribió hace 20 minutos" y dejaba salir el
  // mensaje por MANDI. Meta lo rechazó.
  const ahora  = Date.parse('2026-08-19T16:40:00Z')
  const mapa = mapaBandeja([
    { telefono: TEL, phone_id: MANDI,    estado: 'ATENDIDO', ultimo_entrante_at: '2026-07-15T19:08:58Z' },
    { telefono: TEL, phone_id: REPUBLIC, estado: 'ATENDIDO', ultimo_entrante_at: '2026-08-19T16:20:35Z' },
  ])
  assert.equal(ventanaAbierta(mapa, TEL, REPUBLIC, ahora), true)
  assert.equal(ventanaAbierta(mapa, TEL, MANDI,    ahora), false)
})

test('un canal sin NINGÚN entrante tiene la ventana cerrada (el caso del 16-ago)', () => {
  // Ese cliente nunca escribió a MANDI y le mandamos 6 mensajes por ahí. Los 6
  // murieron. Sin entrante no hay ventana: nunca se abrió.
  const mapa = mapaBandeja([
    { telefono: TEL, phone_id: MANDI, estado: 'PENDIENTE', ultimo_entrante_at: null },
  ])
  assert.equal(ventanaAbierta(mapa, TEL, MANDI, Date.now()), false)
})

test('la ventana se cierra exactamente a las 24 h, no antes ni después', () => {
  const ahora = Date.parse('2026-08-20T12:00:00Z')
  const justo = new Date(ahora - VENTANA_MS + 1000).toISOString() // 1 s antes de cerrar
  const tarde = new Date(ahora - VENTANA_MS - 1000).toISOString() // 1 s después
  const abierta = mapaBandeja([{ telefono: TEL, phone_id: MANDI, ultimo_entrante_at: justo }])
  const cerrada = mapaBandeja([{ telefono: TEL, phone_id: MANDI, ultimo_entrante_at: tarde }])
  assert.equal(ventanaAbierta(abierta, TEL, MANDI, ahora), true)
  assert.equal(ventanaAbierta(cerrada, TEL, MANDI, ahora), false)
})

// ── El efecto bola de nieve ───────────────────────────────────────────────────
// Antes, CUALQUIER mensaje —incluido uno que salía— redefinía "el canal de esta
// persona" en `conversaciones.phone_id`, y la interfaz leía ese campo para decidir
// por dónde mandar el siguiente. Así, el primer mensaje que salía por el número
// equivocado CONTAMINABA la ficha y arrastraba a todos los que venían detrás: 3
// muertos seguidos el 19-ago, 6 el 16-ago.

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

test('una fecha corrupta deja la ventana CERRADA, no abierta', () => {
  // Ante la duda, cerrada: un falso "abierta" manda un mensaje que muere en Meta
  // y el vendedor cree que llegó. Un falso "cerrada" solo obliga a usar plantilla.
  const mapa = mapaBandeja([{ telefono: TEL, phone_id: MANDI, ultimo_entrante_at: 'no-es-fecha' }])
  assert.equal(ventanaAbierta(mapa, TEL, MANDI, Date.now()), false)
})
