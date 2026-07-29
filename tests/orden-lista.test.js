import test from 'node:test'
import assert from 'node:assert'
import { moverItem } from '../lib/orden-lista.js'

test('baja un elemento una posicion', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
})

test('sube un elemento una posicion', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b'])
})

test('mover a una posicion lejana reordena bien', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'd', 'a'])
})

test('subir el primero o bajar el ultimo no cambia nada', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'])
  assert.deepEqual(moverItem(['a', 'b', 'c'], 2, 3), ['a', 'b', 'c'])
})

test('no muta la lista original', () => {
  const original = ['a', 'b', 'c']
  moverItem(original, 0, 2)
  assert.deepEqual(original, ['a', 'b', 'c'])
})

test('tolera entradas invalidas sin lanzar', () => {
  assert.deepEqual(moverItem(null, 0, 1), [])
  assert.deepEqual(moverItem(['a'], 5, 0), ['a'])
})
