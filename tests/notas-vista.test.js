// Notas del panel Ventas: solo las más recientes a la vista, el resto escondido.
import test from 'node:test'
import assert from 'node:assert'
import { partirNotas, NOTAS_VISIBLES } from '../lib/notas-vista.js'

const notas = (k) => Array.from({ length: k }, (_, i) => ({ id: i + 1 }))

test('por defecto se ven 3 y el resto queda escondido', () => {
  assert.strictEqual(NOTAS_VISIBLES, 3)
  const { recientes, antiguas } = partirNotas(notas(16))
  assert.deepStrictEqual(recientes.map(n => n.id), [1, 2, 3])
  assert.strictEqual(antiguas.length, 13)
  assert.strictEqual(antiguas[0].id, 4) // sigue el orden: la más nueva primero
})

test('con pocas notas no se esconde nada', () => {
  for (const k of [0, 1, 3]) {
    const { recientes, antiguas } = partirNotas(notas(k))
    assert.strictEqual(recientes.length, k)
    assert.strictEqual(antiguas.length, 0)
  }
})

test('entrada rara no rompe el panel', () => {
  assert.deepStrictEqual(partirNotas(null), { recientes: [], antiguas: [] })
  assert.deepStrictEqual(partirNotas(undefined, 'x'), { recientes: [], antiguas: [] })
  assert.strictEqual(partirNotas(notas(5), -2).antiguas.length, 5)
})
