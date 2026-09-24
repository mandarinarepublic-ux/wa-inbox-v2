// La versión del inbox: "¿cambió algo desde tu última pregunta?"
//
// El polling pide ~370 KB completos cada 10 s. Medido el 28-ago sobre 24 h en
// horario de atención: en IND **3 de cada 4 ciclos no traen nada nuevo** (74,8%)
// y en MANDI 9 de cada 10 (93,6%). Esos son bytes pagados por repetir lo mismo:
// Fast Origin Transfer es el 63% de la factura y sale a $0,41/GB desde São Paulo.
//
// La versión se arma con dos marcas de tiempo:
//   · inbox.bandeja.actualizado_en    → mensajes y estado de bandeja, POR CANAL
//   · inbox.conversaciones.updated_at → alias, notas, temperatura, modo IA, venta
//
// ☠️ LA ASIMETRÍA QUE DEFINE ESTE ARCHIVO. Equivocarse tiene dos precios muy
// distintos:
//   · un falso "cambió"    → se manda todo de más. Cuesta unos centavos.
//   · un falso "no cambió" → la pantalla se CONGELA con datos viejos y el
//     vendedor no se entera. Es la familia "la pantalla miente", la que este
//     inbox lleva meses pagando.
// Por eso, ante cualquier duda, se responde "cambió".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etagDe, sinCambios, acuseAgrupado } from '../lib/version-inbox.js'

test('el mismo estado da el mismo etag', () => {
  const a = etagDe(['2026-08-28T21:00:00Z', '2026-08-28T20:00:00Z'])
  const b = etagDe(['2026-08-28T21:00:00Z', '2026-08-28T20:00:00Z'])
  assert.equal(a, b)
  assert.ok(a)
})

test('si cambia CUALQUIERA de las dos marcas, cambia el etag', () => {
  const base = etagDe(['2026-08-28T21:00:00Z', '2026-08-28T20:00:00Z'])
  // llegó un mensaje (bandeja)
  assert.notEqual(etagDe(['2026-08-28T21:00:05Z', '2026-08-28T20:00:00Z']), base)
  // alguien cambió una temperatura (conversaciones)
  assert.notEqual(etagDe(['2026-08-28T21:00:00Z', '2026-08-28T22:00:00Z']), base)
})

test('una marca nula no rompe: se usa la que haya', () => {
  // Un canal sin ninguna fila de bandeja todavía es un canal válido.
  assert.ok(etagDe([null, '2026-08-28T20:00:00Z']))
  assert.ok(etagDe(['2026-08-28T21:00:00Z', null]))
})

test('sin NINGUNA marca el etag es vacío = "no se sabe"', () => {
  assert.equal(etagDe([null, null]), '')
  assert.equal(etagDe([]), '')
  assert.equal(etagDe(null), '')
})

test('dos etags iguales significan sin cambios', () => {
  assert.equal(sinCambios('abc', 'abc'), true)
})

test('dos etags distintos significan que hay que mandar todo', () => {
  assert.equal(sinCambios('abc', 'xyz'), false)
})

test('☠️ si NO se pudo calcular la versión, SIEMPRE se manda todo', () => {
  // La base no respondió, la consulta falló, la tabla está vacía. Contestar
  // "sin cambios" acá congelaría el inbox con datos viejos y nadie se enteraría.
  assert.equal(sinCambios('abc', ''), false)
  assert.equal(sinCambios('abc', null), false)
  assert.equal(sinCambios('abc', undefined), false)
})

test('un cliente sin etag previo recibe todo', () => {
  // Primera carga de la pantalla: no tiene con qué comparar.
  assert.equal(sinCambios('', 'abc'), false)
  assert.equal(sinCambios(null, 'abc'), false)
})

test('el etag no depende del orden de las marcas', () => {
  // Se usa la más reciente, así que dar vuelta las partes da lo mismo. Si
  // dependiera del orden, agregar una tercera fuente mañana rompería el caché
  // de todos en silencio.
  assert.equal(
    etagDe(['2026-08-28T21:00:00Z', '2026-08-28T20:00:00Z']),
    etagDe(['2026-08-28T20:00:00Z', '2026-08-28T21:00:00Z']),
  )
})

test('una fecha corrupta se ignora, no envenena el etag', () => {
  assert.equal(
    etagDe(['no-es-fecha', '2026-08-28T20:00:00Z']),
    etagDe([null, '2026-08-28T20:00:00Z']),
  )
})

// ── Los acuses de entrega, agrupados (23-sep-2026) ─────────────────────────
// Cada ✓/✓✓/leído invalidaba la versión y TODAS las pantallas recargaban todo:
// en una ráfaga de fotos fueron 45 por minuto y la base se cayó. Ahora el
// acuse cuenta agrupado en ventanas de 30 s. La regla que NO se negocia: el
// último acuse SIEMPRE termina moviendo la versión (a lo más 30 s tarde).
const V = 30_000
const T = Date.parse('2026-09-23T21:00:00Z') // borde exacto de una ventana

test('acuse: sin acuses no aporta nada a la versión', () => {
  assert.equal(acuseAgrupado(null, T), null)
  assert.equal(acuseAgrupado('basura', T), null)
})

test('acuse: muchos acuses dentro de la misma ventana dan UNA sola versión', () => {
  const ahora = T + 25_000
  const a = acuseAgrupado(new Date(T + 2_000).toISOString(), ahora, V)
  const b = acuseAgrupado(new Date(T + 11_000).toISOString(), ahora, V)
  const c = acuseAgrupado(new Date(T + 24_000).toISOString(), ahora, V)
  assert.equal(a, b)
  assert.equal(b, c)
})

test('acuse: ☠️ el último acuse SIEMPRE termina moviendo la versión', () => {
  // Llegó un "leído" a los 12 s. Mientras la ventana no cierra, la versión puede
  // no moverse; en cuanto cierra, TIENE que moverse — si no, la pantalla se
  // queda en ✓ para siempre ("la pantalla miente").
  const acuse = new Date(T + 12_000).toISOString()
  const antes = etagDe(['2026-09-23T21:00:05Z', null, acuseAgrupado(acuse, T + 20_000, V)])
  const despues = etagDe(['2026-09-23T21:00:05Z', null, acuseAgrupado(acuse, T + V, V)])
  assert.notEqual(antes, despues)
})

test('acuse: nunca devuelve una hora del futuro', () => {
  // Una marca futura sería la más reciente y taparía los mensajes nuevos que
  // lleguen hasta esa hora: la versión no cambiaría con ellos.
  for (const ahora of [T + 1, T + 12_000, T + 29_999, T + V, T + 45_000]) {
    const r = acuseAgrupado(new Date(T + 1).toISOString(), ahora, V)
    assert.ok(Date.parse(r) <= ahora, `devolvió ${r} con ahora=${new Date(ahora).toISOString()}`)
  }
})

test('acuse: un mensaje nuevo sigue moviendo la versión al instante', () => {
  const acuse = acuseAgrupado(new Date(T + 5_000).toISOString(), T + 10_000, V)
  const base = etagDe(['2026-09-23T21:00:08Z', null, acuse])
  assert.notEqual(etagDe(['2026-09-23T21:00:09Z', null, acuse]), base)
})
