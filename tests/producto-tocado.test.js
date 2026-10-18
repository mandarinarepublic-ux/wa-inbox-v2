import test from 'node:test'
import assert from 'node:assert'
import { restoProductoTocado } from '../lib/producto-tocado.js'

// Textos REALES que mandó Meta cuando el cliente tocó un producto dentro del anuncio.
test('MANDI: producto tocado, con y sin variante', () => {
  assert.equal(restoProductoTocado('Me interesa Hoodie Tortugas Ninja - Casey Jones.'), 'Hoodie Tortugas Ninja - Casey Jones.')
  assert.equal(
    restoProductoTocado('Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)'),
    'Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)')
})

test('IND: "Vi tu anuncio en Instagram." antes del producto', () => {
  assert.equal(restoProductoTocado('Vi tu anuncio en Instagram.\nMe interesa Conjunto "Dual Lifestyle".'), 'Conjunto "Dual Lifestyle".')
})

test('el texto genérico del anuncio no es un producto tocado', () => {
  assert.equal(restoProductoTocado('¡Hola! Quiero más información.'), '')
  assert.equal(restoProductoTocado('Hola, me interesa X'), '')
  assert.equal(restoProductoTocado(''), '')
  assert.equal(restoProductoTocado(null), '')
})
