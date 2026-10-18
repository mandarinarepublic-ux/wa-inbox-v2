import test from 'node:test'
import assert from 'node:assert'
import { restoProductoTocado, partesProductoTocado, emparejarProductoTocado } from '../lib/producto-tocado.js'

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

// Títulos REALES de crm.productos_shopify (MANDARINA / INDSTORE).
const catalogo = [
  { title: 'Hoodie Tortugas Ninja - Casey Jones', price: '29.99', image: 'https://cdn/tmnt.jpg' },
  { title: 'Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉', price: '35.00', image: 'https://cdn/dbz.jpg' },
  { title: 'Camisetas Dragon Ball', price: '19.99', image: 'https://cdn/db.jpg' },
  { title: 'Camisetas Dragon Ball - Vegeta', price: '20.00', image: 'https://cdn/vegeta.jpg' },
  { title: '🔥 Hoodie Deadpool – Edición Limitada 🔥', price: '30.00', image: 'https://cdn/dp.jpg' },
  { title: 'Camiseta The Amazing Spider-Man', price: '25.00', image: 'https://cdn/sm1.jpg' },
  { title: 'Camiseta The Amazing Spider-Man', price: '25.00', image: 'https://cdn/sm2.jpg' },
  { title: 'Zip Hoodie Venom "Symbiote" Dark Edition', price: '45', image: 'https://cdn/venom.jpg' },
  { title: 'Conjunto "Dual Lifestyle"', price: '50', image: 'https://cdn/dual.jpg' },
  { title: 'Hoodie Spiderman', price: '30', image: 'https://cdn/spi.jpg' },
]
const titulo = (r) => r.productos.map(p => p.title)

test('emparejar: Tortugas Ninja, sin variante', () => {
  const r = emparejarProductoTocado('Me interesa Hoodie Tortugas Ninja - Casey Jones.', catalogo)
  assert.deepEqual(titulo(r), ['Hoodie Tortugas Ninja - Casey Jones'])
  assert.equal(r.variante, '')
})

test('emparejar: título con "|" y emoji + variante', () => {
  const r = emparejarProductoTocado('Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)', catalogo)
  assert.equal(r.productos[0].image, 'https://cdn/dbz.jpg')
  assert.equal(r.variante, 'Azul, 2XL')
})

test('emparejar: gana el título más largo', () => {
  assert.deepEqual(titulo(emparejarProductoTocado('Me interesa Camisetas Dragon Ball - Vegeta. (XL)', catalogo)), ['Camisetas Dragon Ball - Vegeta'])
  assert.deepEqual(titulo(emparejarProductoTocado('Me interesa Camisetas Dragon Ball. (L)', catalogo)), ['Camisetas Dragon Ball'])
})

test('emparejar: emoji al inicio, comillas, formato IND y texto agregado por el cliente', () => {
  assert.equal(emparejarProductoTocado('Me interesa 🔥 Hoodie Deadpool – Edición Limitada 🔥.', catalogo).productos.length, 1)
  assert.deepEqual(titulo(emparejarProductoTocado('Vi tu anuncio en Instagram.\nMe interesa Conjunto "Dual Lifestyle".', catalogo)), ['Conjunto "Dual Lifestyle"'])
  assert.deepEqual(titulo(emparejarProductoTocado('Me interesa Zip Hoodie Venom "Symbiote" Dark Edition. Buenos días me interesa', catalogo)), ['Zip Hoodie Venom "Symbiote" Dark Edition'])
})

test('emparejar: duplicados en Shopify vienen los dos', () => {
  assert.equal(emparejarProductoTocado('Me interesa Camiseta The Amazing Spider-Man. (M)', catalogo).productos.length, 2)
})

test('emparejar: no calza un título que es prefijo de otra palabra, ni un producto que no existe', () => {
  assert.equal(emparejarProductoTocado('Me interesa Hoodie Spiderman 2099.', catalogo).productos.length, 0)
  const r = emparejarProductoTocado('Me interesa Chaqueta Pokemon - Haunter. (Rojo, L)', catalogo)
  assert.equal(r.productos.length, 0)
  assert.equal(r.variante, 'Rojo, L')
})

test('partes sin catálogo: nombre y variante del texto', () => {
  assert.deepEqual(partesProductoTocado('Me interesa Chaqueta Pokemon - Haunter. (Rojo, L)'), { nombre: 'Chaqueta Pokemon - Haunter', variante: 'Rojo, L' })
  assert.deepEqual(partesProductoTocado('Me interesa SPIDER-VERSE "HERO SUIT".'), { nombre: 'SPIDER-VERSE "HERO SUIT"', variante: '' })
  assert.deepEqual(partesProductoTocado('¡Hola! Quiero más información.'), { nombre: '', variante: '' })
})

test('lo que el cliente escribe a mano (sin el punto de Meta) no es un producto seleccionado', () => {
  assert.equal(restoProductoTocado('Me interesa la chompa de el anuncio dispone en talla m'), '')
  assert.equal(restoProductoTocado('Me interesa Chaqueta  de los power rangers'), '')
  // …pero el texto de Meta con algo agregado por el cliente sí cuenta.
  assert.match(restoProductoTocado('Me interesa Zip Hoodie Venom "Symbiote" Dark Edition. Buenos días me interesa'), /^Zip Hoodie Venom/)
})
