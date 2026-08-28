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
import { etagDe, sinCambios } from '../lib/version-inbox.js'

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
