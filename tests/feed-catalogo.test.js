import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filaDeProducto, csvDelFeed, filasSeguras, MINIMO_PRODUCTOS } from '../lib/feed-catalogo.js'

const prod = (o = {}) => ({
  id: 8184165007453, handle: 'camiseta-web-of-spider-man', title: 'Camiseta Web of Spider-Man',
  body_html: '<p>📖 <strong>Web of Spider-Man</strong> &amp; más</p>', vendor: 'Mandarina Republic', product_type: 'Camiseta',
  images: [{ src: 'https://cdn/a.png' }, { src: 'https://cdn/b.png' }],
  variants: [{ price: '25.00', compare_at_price: null, available: true }, { price: '27.00', available: true }],
  ...o,
})

test('feed: id de Shopify, enlace por handle, descripción sin HTML, precio de la más barata en stock', () => {
  const f = filaDeProducto(prod())
  assert.equal(f.id, '8184165007453')
  assert.equal(f.link, 'https://mandarinaec.com/products/camiseta-web-of-spider-man')
  assert.equal(f.description, '📖 Web of Spider-Man & más')
  assert.equal(f.price, '25.00 USD')
  assert.equal(f.sale_price, '')
  assert.equal(f.availability, 'in stock')
  assert.equal(f.image_link, 'https://cdn/a.png')
  assert.equal(f.additional_image_link, 'https://cdn/b.png')
})

test('feed: con precio tachado va como oferta; agotado; sin foto o sin precio no entra', () => {
  const o = filaDeProducto(prod({ variants: [{ price: '31.50', compare_at_price: '35.00', available: true }] }))
  assert.equal(o.price, '35.00 USD')
  assert.equal(o.sale_price, '31.50 USD')
  assert.equal(filaDeProducto(prod({ variants: [{ price: '25', available: false }] })).availability, 'out of stock')
  assert.equal(filaDeProducto(prod({ images: [] })), null)
  assert.equal(filaDeProducto(prod({ variants: [{ price: '0', available: true }] })), null)
})

test('feed: CSV con encabezado y comillas escapadas', () => {
  const csv = csvDelFeed([prod({ title: 'Hoodie "Krang", edición' }), prod({ images: [] })])
  const lineas = csv.trim().split('\n')
  assert.equal(lineas.length, 2)
  assert.ok(lineas[0].startsWith('id,title,description'))
  assert.ok(lineas[1].includes('"Hoodie ""Krang"", edición"'))
})

test('feed: lista demasiado corta = error, para que REEMPLAZAR no vacíe el catálogo', () => {
  const muchos = Array.from({ length: MINIMO_PRODUCTOS }, (_, i) => prod({ id: 1000 + i }))
  assert.equal(filasSeguras(muchos).length, MINIMO_PRODUCTOS)
  assert.throws(() => filasSeguras(muchos.slice(1)), /mínimo/)
  // Los sin foto no cuentan: 100 productos sin foto tampoco son una lista válida.
  assert.throws(() => filasSeguras(muchos.map((p) => ({ ...p, images: [] }))), /solo 0/)
  assert.throws(() => csvDelFeed([], undefined, MINIMO_PRODUCTOS), /mínimo/)
})
