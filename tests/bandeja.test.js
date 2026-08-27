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
import { canalDeEnvio, ventanaAbierta, patchesDeMensaje, canalParaEscribir, opcionesDeCanal, VENTANA_MS } from '../lib/bandeja.js'

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

// ── A qué número se le escribe desde CONTACTOS ───────────────────────────────
// `/api/directorio` es la AGENDA: una fila por persona, sin canal. El arreglo del
// 19-ago NO tocó esta ruta. Sigue calculando `dentro24h` con el último entrante
// de la PERSONA —mezclando los dos números— y mandando con el canal de la
// PESTAÑA. Las dos cosas a la vez: pinta la ventana en verde porque el cliente
// escribió al OTRO número, y después manda por el que está abierto en pantalla.
//
// Medido el 26-ago sobre 30 días: 19 mensajes de MANDI muertos con 131047, y en
// 18 de los 19 el OTRO número tenía la ventana abierta. Lleva 7 días en cero
// porque no le ha disparado, no porque esté cubierto.
//
// En IND el mismo hueco se llevó 79 mensajes.

test('elige el canal donde el cliente escribió, no el de la pestaña', () => {
  const ahora = Date.parse('2026-08-19T16:40:00Z')
  const r = canalParaEscribir([
    { phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' },
    { phone_id: MANDI,    ultimo_entrante_at: null },
  ], ahora)
  assert.equal(r.canal, REPUBLIC)
  assert.equal(r.dentro24h, true)
})

test('con los dos abiertos gana el más reciente', () => {
  const ahora = Date.parse('2026-08-19T16:40:00Z')
  const r = canalParaEscribir([
    { phone_id: MANDI,    ultimo_entrante_at: '2026-08-19T10:00:00Z' },
    { phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' },
  ], ahora)
  assert.equal(r.canal, REPUBLIC, 'el último entrante manda')
})

test('un canal SIN entrante nunca gana (el caso del 16-ago)', () => {
  // Seis mensajes a alguien que NUNCA había escrito a ese número. Sin entrante
  // no hay ventana: nunca se abrió.
  const r = canalParaEscribir([{ phone_id: MANDI, ultimo_entrante_at: null }], Date.now())
  assert.equal(r.canal, '')
  assert.equal(r.dentro24h, false)
})

test('sin ninguna fila no inventa un canal', () => {
  assert.deepEqual(canalParaEscribir([], Date.now()), { canal: '', dentro24h: false, ultimoEntranteAt: null })
  assert.deepEqual(canalParaEscribir(null, Date.now()), { canal: '', dentro24h: false, ultimoEntranteAt: null })
})

test('la ventana se mide contra EL CANAL ELEGIDO, no contra la persona', () => {
  const ahora = Date.parse('2026-08-19T16:40:00Z')
  const r = canalParaEscribir([
    { phone_id: MANDI, ultimo_entrante_at: '2026-08-18T09:00:00Z' },  // 31 h
  ], ahora)
  assert.equal(r.canal, MANDI)
  assert.equal(r.dentro24h, false, 'cerrada: 31 h en ESE número')
})

test('una fecha corrupta no puede ganar el canal', () => {
  const ahora = Date.parse('2026-08-19T16:40:00Z')
  const r = canalParaEscribir([
    { phone_id: MANDI,    ultimo_entrante_at: 'no-es-fecha' },
    { phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' },
  ], ahora)
  assert.equal(r.canal, REPUBLIC)
  assert.equal(r.dentro24h, true)
})

// ── Las opciones que ve el vendedor al escribir ──────────────────────────────
// El sistema NO adivina por dónde mandar: muestra los dos números con su estado
// real y deja elegir, con el más fresco preseleccionado.
//
// `canalParaEscribir` toma el último entrante, y eso falla en un caso muy real:
// el cliente escribe por REPUBLIC por un pedido a las 10 y por MANDI por otra
// cosa a las 11. El vendedor contesta el hilo de REPUBLIC y el mensaje sale por
// MANDI, EN SILENCIO. Acá `canalParaEscribir` pasa de decidir a PRESELECCIONAR.
//
// ⚠️ `CANALES` NO incluye GENERAL: GENERAL es una pestaña, no un número. Meter
// una opción "GENERAL" acá mandaría por un phone_id que no existe.

const CANALES_MANDI = [
  { phoneId: MANDI,    etiqueta: 'MANDI' },
  { phoneId: REPUBLIC, etiqueta: 'REPUBLIC' },
]

test('muestra TODOS los números, no solo por los que escribió', () => {
  // Un número al que nunca escribió sigue siendo alcanzable POR PLANTILLA.
  const ops = opcionesDeCanal([{ phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' }],
                              CANALES_MANDI, Date.parse('2026-08-19T16:40:00Z'))
  assert.equal(ops.length, 2)
})

test('el más fresco va primero y viene preseleccionado', () => {
  const ops = opcionesDeCanal([
    { phone_id: MANDI,    ultimo_entrante_at: '2026-08-19T10:00:00Z' },
    { phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' },
  ], CANALES_MANDI, Date.parse('2026-08-19T16:40:00Z'))
  assert.equal(ops[0].etiqueta, 'REPUBLIC')
  assert.equal(ops[0].preseleccionado, true)
  assert.equal(ops[1].preseleccionado, false)
})

test('dice por cuál se escribe libre y por cuál toca plantilla', () => {
  // El caso exacto del 19-ago: REPUBLIC hace 20 minutos, MANDI hace 35 días.
  const ops = opcionesDeCanal([
    { phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' },
    { phone_id: MANDI,    ultimo_entrante_at: '2026-07-15T19:08:58Z' },
  ], CANALES_MANDI, Date.parse('2026-08-19T16:40:00Z'))
  assert.equal(ops.find(o => o.etiqueta === 'REPUBLIC').dentro24h, true)
  assert.equal(ops.find(o => o.etiqueta === 'MANDI').dentro24h, false)
})

test('un número al que nunca escribió va como cerrado (el caso del 16-ago)', () => {
  const ops = opcionesDeCanal([{ phone_id: REPUBLIC, ultimo_entrante_at: '2026-08-19T16:20:35Z' }],
                              CANALES_MANDI, Date.parse('2026-08-19T16:40:00Z'))
  const n = ops.find(o => o.etiqueta === 'MANDI')
  assert.equal(n.dentro24h, false)
  assert.equal(n.ultimoEntranteAt, null)
})

test('si no escribió por NINGUNO, no hay preseleccionado', () => {
  // Sin preselección la pantalla no puede mandar sola: hay que elegir a propósito.
  const ops = opcionesDeCanal([], CANALES_MANDI, Date.now())
  assert.equal(ops.some(o => o.preseleccionado), false)
})

test('sin canales configurados devuelve lista vacía, no inventa uno', () => {
  assert.deepEqual(opcionesDeCanal([{ phone_id: MANDI, ultimo_entrante_at: '2026-08-19T16:20:35Z' }], [], Date.now()), [])
})
