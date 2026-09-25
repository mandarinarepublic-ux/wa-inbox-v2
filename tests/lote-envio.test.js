import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revisarAntesDeEnviar, validarLote } from '../lib/lote-envio.js'

const H = 3600 * 1000
// 11:30 hora Ecuador = 16:30 UTC
const AHORA = Date.parse('2026-09-25T16:30:00Z')
const hace = (h) => new Date(AHORA - h * H).toISOString()

// Caso real del 25-sep: el flujo preguntó la talla en el mismo minuto y el cliente se calló.
const hiloCallado = [
  { direccion: 'ENTRANTE', tipo: 'texto', mensaje: '¡Hola! Quiero más información.', timestamp: hace(7) },
  { direccion: 'SALIENTE', tipo: 'texto', mensaje: '¿En qué talla lo estabas buscando?', timestamp: hace(7) },
]
const revisar = (extra = {}) => revisarAntesDeEnviar({
  hilo: hiloCallado, entranteEsperadoAt: hace(7), salienteEsperadoAt: hace(7),
  texto: '¡Hola Luis! Me quedé con la duda…', ahoraMs: AHORA, ...extra,
})

// Caso real del 25-sep: a Luis le escribieron A MANO la retoma (con otro saludo)
// después de que se armó la lista. Mandarle la del lote sería el segundo mensaje.
test('alguien ya le escribió después de armar la lista (otro texto) → no se manda', () => {
  const hilo = [...hiloCallado, { direccion: 'SALIENTE', tipo: 'texto', mensaje: '¡Hola Bro! Soy Andrés…', timestamp: hace(0.5) }]
  const r = revisar({ hilo })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /ya le escribió/)
})

test('callado tras nuestra pregunta, ventana abierta y de día → se manda', () => {
  assert.deepEqual(revisar(), { ok: true })
})

test('el cliente escribió después de armar la lista → no se manda', () => {
  const hilo = [...hiloCallado, { direccion: 'ENTRANTE', tipo: 'texto', mensaje: 'Talla XL', timestamp: hace(0.1) }]
  const r = revisar({ hilo })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /escribió/)
})

test('una reacción del cliente también cuenta como que respondió', () => {
  const hilo = [...hiloCallado, { direccion: 'ENTRANTE', tipo: 'reaction', mensaje: '', timestamp: hace(0.1) }]
  assert.equal(revisar({ hilo }).ok, false)
})

test('el cliente habló último (espera respuesta nuestra) → no se manda', () => {
  const hilo = [{ direccion: 'ENTRANTE', tipo: 'texto', mensaje: 'Tiene en talla 12?', timestamp: hace(2) }]
  const r = revisar({ hilo, entranteEsperadoAt: hace(2) })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /espera respuesta/)
})

test('ventana a menos de 15 min de cerrarse → no se manda', () => {
  const hilo = [
    { direccion: 'ENTRANTE', tipo: 'texto', mensaje: 'hola', timestamp: hace(23.8) },
    { direccion: 'SALIENTE', tipo: 'texto', mensaje: '¿Qué talla?', timestamp: hace(23.7) },
  ]
  const r = revisar({ hilo, entranteEsperadoAt: hace(23.8) })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /ventana/)
})

test('ya le mandamos este mismo texto antes (lista vieja) → no se repite', () => {
  const texto = '¡Hola Luis! Me quedé con la duda…'
  const hilo = [...hiloCallado, { direccion: 'SALIENTE', tipo: 'texto', mensaje: texto, timestamp: hace(0.5) }]
  const r = revisar({ hilo, texto, salienteEsperadoAt: hace(0.5) })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /ya se le mandó/)
})

test('de noche (antes de las 08:00 Ecuador) → no se manda', () => {
  const noche = Date.parse('2026-09-25T11:00:00Z') // 06:00 Ecuador
  const hilo = [
    { direccion: 'ENTRANTE', tipo: 'texto', mensaje: 'hola', timestamp: new Date(noche - 2 * H).toISOString() },
    { direccion: 'SALIENTE', tipo: 'texto', mensaje: '¿Qué talla?', timestamp: new Date(noche - 2 * H).toISOString() },
  ]
  const r = revisarAntesDeEnviar({ hilo, entranteEsperadoAt: hilo[0].timestamp, salienteEsperadoAt: hilo[1].timestamp, texto: 'x', ahoraMs: noche })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /horario/)
})

test('hilo vacío (la lectura falló o no hay mensajes) → no se manda', () => {
  assert.equal(revisar({ hilo: [] }).ok, false)
})

test('validarLote exige teléfono, canal, texto y fecha del último entrante', () => {
  const bueno = { telefono: '593999000111', phone_id: '1024077200794372', texto: 'hola', entrante_at: hace(3), saliente_at: hace(3) }
  assert.deepEqual(validarLote([bueno]), [])
  const errores = validarLote([{ ...bueno, texto: '  ' }, { ...bueno, phone_id: '' }, { ...bueno, saliente_at: '' }])
  assert.equal(errores.length, 3)
})

test('validarLote rechaza un texto con LINKPAGO (lo convertiría en cobro)', () => {
  const errores = validarLote([{ telefono: '593999000111', phone_id: '1', texto: 'LINKPAGO35', entrante_at: hace(1), saliente_at: hace(1) }])
  assert.equal(errores.length, 1)
})

test('validarLote rechaza el "▎" de una cita de markdown pegada por error', () => {
  const errores = validarLote([{ telefono: '593999000111', phone_id: '1', texto: '¡Hola!\n▎ Me quedé con la duda', entrante_at: hace(1), saliente_at: hace(1) }])
  assert.equal(errores.length, 1)
})
