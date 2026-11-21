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

// 🔎 Buscador (20-nov-2026)
import { coincideBusqueda } from '../lib/grupos-respuestas.js'

const conTexto = [
  { id: 'x', grupo: 'tallas', text: 'Tabla de tallas de NIÑO' },
  { id: 'y', grupo: 'datos', text: 'Cuentas bancarias', botones: ['Ya transferí'] },
  { id: 'z', grupo: 'productos', text: 'Mira estos', carrusel: [{ nombre: 'Hoodie Dragón Ball' }] },
  { id: 'w', grupo: null, text: 'Hola, ¿en qué te ayudo?' },
]

test('buscar: sin tildes ni mayúsculas, y TODAS las palabras', () => {
  assert.ok(coincideBusqueda(conTexto[0], 'tallas nino'))
  assert.ok(coincideBusqueda(conTexto[0], '  NIÑO  '))
  assert.ok(!coincideBusqueda(conTexto[0], 'tallas adulto'))
  assert.ok(coincideBusqueda(conTexto[3], ''))
})

test('buscar también en los botones y en los productos del carrusel', () => {
  assert.ok(coincideBusqueda(conTexto[1], 'transferi'))
  assert.ok(coincideBusqueda(conTexto[2], 'dragon'))
})

test('la búsqueda se suma al botón, y los conteos dicen dónde hay', () => {
  assert.deepEqual(indicesVisibles(conTexto, TODAS, 'tallas'), [0])
  assert.deepEqual(indicesVisibles(conTexto, 'datos', 'tallas'), [])
  const n = conteoPorGrupo(conTexto, 'tallas')
  assert.equal(n[TODAS], 1); assert.equal(n.tallas, 1); assert.equal(n.datos, 0)
  // Sin búsqueda, igual que antes.
  assert.equal(conteoPorGrupo(conTexto)[TODAS], 4)
})
