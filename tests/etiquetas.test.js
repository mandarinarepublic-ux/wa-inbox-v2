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
