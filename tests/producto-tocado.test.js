import test from 'node:test'
import assert from 'node:assert'
import { restoProductoTocado, emparejarProductoTocado, precioVisible, piezasProductoTocado } from '../lib/producto-tocado.js'

// Títulos REALES de crm.productos_shopify (MANDARINA) y textos REALES que mandó Meta.
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
]

test('Tortugas Ninja tocado dentro de otro anuncio → Tortugas Ninja, sin variante', () => {
  const r = emparejarProductoTocado('Me interesa Hoodie Tortugas Ninja - Casey Jones.', catalogo)
  assert.equal(r.producto.title, 'Hoodie Tortugas Ninja - Casey Jones')
  assert.equal(r.variante, '')
})

test('título con "|" y emoji + variante de color y talla', () => {
  const r = emparejarProductoTocado('Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)', catalogo)
  assert.equal(r.producto.price, '35.00')
  assert.equal(r.variante, 'Azul, 2XL')
})

test('gana el título más largo: Vegeta no se confunde con la genérica', () => {
  const r = emparejarProductoTocado('Me interesa Camisetas Dragon Ball - Vegeta. (XL)', catalogo)
  assert.equal(r.producto.title, 'Camisetas Dragon Ball - Vegeta')
  assert.equal(r.variante, 'XL')
  assert.equal(emparejarProductoTocado('Me interesa Camisetas Dragon Ball. (L)', catalogo).producto.title, 'Camisetas Dragon Ball')
})

test('emoji al inicio del título', () => {
  assert.equal(emparejarProductoTocado('Me interesa 🔥 Hoodie Deadpool – Edición Limitada 🔥.', catalogo).producto.price, '30.00')
})

test('dos productos con el MISMO título → en duda, no se adivina', () => {
  assert.deepEqual(emparejarProductoTocado('Me interesa Camiseta The Amazing Spider-Man. (M)', catalogo), { motivo: 'varios' })
})

test('producto que ya no existe en Shopify → ninguno', () => {
  assert.deepEqual(emparejarProductoTocado('Me interesa Chaqueta Pokemon - Haunter. (Rojo, L)', catalogo), { motivo: 'ninguno' })
})

test('lo que escribe el cliente a mano no es un producto tocado', () => {
  assert.deepEqual(emparejarProductoTocado('Me interesa Chaqueta  de los power rangers', catalogo), { motivo: 'ninguno' })
  assert.deepEqual(emparejarProductoTocado('¡Hola! Quiero más información.', catalogo), { motivo: 'sin-formato' })
  assert.deepEqual(emparejarProductoTocado('', catalogo), { motivo: 'sin-formato' })
})

test('formato de IND: "Vi tu anuncio en Instagram." + comillas en el título', () => {
  const r = emparejarProductoTocado('Vi tu anuncio en Instagram.\nMe interesa Conjunto "Dual Lifestyle".', catalogo)
  assert.equal(r.producto.title, 'Conjunto "Dual Lifestyle"')
})

test('el cliente agrega texto después del punto de Meta', () => {
  const r = emparejarProductoTocado('Me interesa Zip Hoodie Venom "Symbiote" Dark Edition. Buenos días me interesa', catalogo)
  assert.equal(r.producto.title, 'Zip Hoodie Venom "Symbiote" Dark Edition')
  assert.equal(r.variante, '')
})

test('un título que es prefijo de otra palabra no calza', () => {
  const cat = [{ title: 'Hoodie Spiderman', price: '30' }]
  assert.deepEqual(emparejarProductoTocado('Me interesa Hoodie Spiderman 2099.', cat), { motivo: 'ninguno' })
  assert.equal(emparejarProductoTocado('Me interesa Hoodie Spiderman. (2XL)', cat).variante, '2XL')
})

test('restoProductoTocado', () => {
  assert.equal(restoProductoTocado('me interesa X.'), 'X.')
  assert.equal(restoProductoTocado('Hola, me interesa X'), '')
})

test('precioVisible', () => {
  assert.equal(precioVisible('35.00'), '$35')
  assert.equal(precioVisible('29.99'), '$29.99')
  assert.equal(precioVisible(''), '')
  assert.equal(precioVisible(null), '')
})

test('piezas: texto citado con precio y variante, foto, y la pregunta', () => {
  const r = emparejarProductoTocado('Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)', catalogo)
  const p = piezasProductoTocado({ ...r, contacto: { telefono: '593999', nombre: 'Ana', phoneId: 'P1' }, citaId: 'wamid.X' })
  assert.equal(p.length, 3)
  assert.equal(p[0].ContextoId, 'wamid.X')
  assert.match(p[0].Mensaje, /\*Chaqueta Dragon Ball Z Roja Ecuador \| Envío Gratis 🐉\*/)
  assert.match(p[0].Mensaje, /\$35/)
  assert.match(p[0].Mensaje, /Azul, 2XL/)
  assert.equal(p[1].ImagenURL, 'https://cdn/dbz.jpg')
  assert.equal(p[1].ContextoId, undefined)
  assert.match(p[2].Mensaje, /Azul, 2XL/)
  assert.equal(p[0].Canal, 'P1')
})

test('piezas sin variante preguntan la talla', () => {
  const r = emparejarProductoTocado('Me interesa Hoodie Tortugas Ninja - Casey Jones.', catalogo)
  const p = piezasProductoTocado({ ...r, contacto: { telefono: '1', phoneId: 'P' } })
  assert.match(p.at(-1).Mensaje, /talla/)
})
