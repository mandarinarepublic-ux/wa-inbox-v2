import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorEtiqueta } from '../lib/etiquetas.js'

test('errorEtiqueta: nombre obligatorio, máximo 30, color #rrggbb', () => {
  assert.equal(errorEtiqueta({ nombre: 'Pauta', color: '#1877f2' }), '')
  assert.equal(errorEtiqueta({ nombre: 'Sin color' }), '')
  assert.match(errorEtiqueta({ nombre: '   ' }), /nombre/)
  assert.match(errorEtiqueta({ nombre: 'x'.repeat(31) }), /30/)
  assert.match(errorEtiqueta({ nombre: 'ok', color: 'red' }), /Color/)
  assert.match(errorEtiqueta({ nombre: 'ok', color: '#12345' }), /Color/)
})

import { expandirEtiquetas } from '../lib/etiquetas-mapa.js'

test('expandirEtiquetas: { id: "tel,tel" } → { tel: [ids] }, tolera basura', () => {
  assert.deepEqual(expandirEtiquetas({ 1: '593a,593b', 2: '593b' }), { '593a': [1], '593b': [1, 2] })
  assert.deepEqual(expandirEtiquetas(null), {})
  assert.deepEqual(expandirEtiquetas({ x: '593a', 0: '593b', 3: '' }), {})
})
