// Grupos de respuestas rápidas (lib/grupos-respuestas.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarGrupo, indicesVisibles, conteoPorGrupo, vecinaVisible, TODAS } from '../lib/grupos-respuestas.js'

const replies = [
  { id: 'a', grupo: 'productos' },
  { id: 'b', grupo: 'tallas' },
  { id: 'c', grupo: null },          // saludo: sin grupo
  { id: 'd', grupo: 'tallas' },
  { id: 'e', grupo: 'Datos ' },      // mayúsculas y espacios
  { id: 'f', grupo: 'promos' },      // grupo que ya no existe
]

test('Todas muestra TODO, incluidas las sin grupo o con grupo desconocido', () => {
  assert.deepEqual(indicesVisibles(replies, TODAS), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(indicesVisibles(replies, ''), [0, 1, 2, 3, 4, 5])
})

test('un botón muestra solo su grupo, con los índices de la lista completa', () => {
  assert.deepEqual(indicesVisibles(replies, 'tallas'), [1, 3])
  assert.deepEqual(indicesVisibles(replies, 'datos'), [4])
})

test('conteo por botón', () => {
  assert.deepEqual(conteoPorGrupo(replies), { todas: 6, datos: 1, productos: 1, tallas: 2 })
})

test('normalizar: solo los grupos conocidos; lo demás es sin grupo', () => {
  assert.equal(normalizarGrupo(' TALLAS'), 'tallas')
  assert.equal(normalizarGrupo('promos'), '')
  assert.equal(normalizarGrupo(null), '')
})

test('las flechas saltan a la vecina VISIBLE', () => {
  const v = indicesVisibles(replies, 'tallas')   // [1, 3]
  assert.equal(vecinaVisible(v, 3, -1), 1)
  assert.equal(vecinaVisible(v, 1, -1), -1)       // ya es la primera
  assert.equal(vecinaVisible(v, 3, +1), -1)       // ya es la última
})
