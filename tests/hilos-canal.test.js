// El caché de historiales es la ÚNICA fuente de la bandeja que no pasa por el
// backend, y por ahí se coló una conversación de MANDI en la pestaña de REPUBLIC.
//
// Reportado por Rodrigo el 9-sep: en REPUBLIC le aparecía el chat de una clienta
// que nunca escribió a ese número. `load()` arma la lista mezclando `rows`,
// `hilos` y `lista`; el backend filtra las dos primeras por `phone_id` y la del
// medio no. El pintado tampoco filtra por canal en ninguna parte —confía en el
// backend— así que la fila colada se veía igual que las de verdad.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hilosDelCanal, canalDeClave } from '../lib/hilos.js'

const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'

const msg = (id, phoneId) => ({ id, phoneId, mensaje: `m${id}` })

const CACHE = {
  [`593999885686|${MANDI}`]:    [msg('a', MANDI), msg('b', MANDI)],
  [`593911112222|${REPUBLIC}`]: [msg('c', REPUBLIC)],
}

test('en GENERAL pasan los hilos de los dos números', () => {
  // GENERAL no filtra por canal a propósito: muestra las dos colas.
  const r = hilosDelCanal(CACHE, '')
  assert.equal(r.length, 3)
})

test('en la pestaña de un número NO pasa el hilo del otro', () => {
  // EL BUG. Con el caché cargado con el hilo de MANDI, pedir REPUBLIC devolvía
  // los tres mensajes y `buildConvs` le armaba fila propia a la clienta de MANDI.
  const r = hilosDelCanal(CACHE, REPUBLIC)
  assert.deepEqual(r.map(m => m.id), ['c'])

  const m = hilosDelCanal(CACHE, MANDI)
  assert.deepEqual(m.map(m => m.id), ['a', 'b'])
})

test('un hilo sin canal en la clave queda FUERA al pedir un canal', () => {
  // Default seguro, y acá se puede: dejar un hilo fuera NUNCA esconde una
  // conversación, porque `lista` trae todas las del canal sobre todo el
  // historial. Lo único que se pierde es el historial ya descargado, que se
  // vuelve a bajar al abrir el chat. Es lo contrario de `esPintable`, donde
  // excluir sí escondía clientes.
  const cache = { '593999885686|': [msg('x', '')] }
  assert.equal(hilosDelCanal(cache, REPUBLIC).length, 0)
  assert.equal(hilosDelCanal(cache, '').length, 1)   // en GENERAL sí pasa
})

test('la clave se parte por el ÚLTIMO separador', () => {
  assert.equal(canalDeClave(`593999885686|${MANDI}`), MANDI)
  assert.equal(canalDeClave('593999885686|'), '')
  assert.equal(canalDeClave('sin-separador'), '')
})

test('un caché vacío o nulo no revienta', () => {
  assert.deepEqual(hilosDelCanal({}, MANDI), [])
  assert.deepEqual(hilosDelCanal(null, MANDI), [])
  assert.deepEqual(hilosDelCanal({ 'tel|x': null }, ''), [])
})
