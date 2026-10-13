import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarCarrusel, ventanaAbiertaCarrusel, plantillaCarrusel, payloadInteractivo, payloadPlantilla, guardadoCarrusel, leerCarrusel } from '../lib/carrusel.js'
import { productosParaCarrusel } from '../lib/catalogo-lista.js'

const prods = (n) => Array.from({ length: n }, (_, i) => ({ retailerId: String(7900000000000 + i), nombre: `P${i}`, precio: '$35', foto: 'https://x/y.png' }))

test('validarCarrusel: 2 a 10, sin repetidos, texto obligatorio ≤1024', () => {
  assert.throws(() => validarCarrusel(prods(1), 'hola'), /al menos 2/)
  assert.throws(() => validarCarrusel(prods(11), 'hola'), /Máximo 10/)
  assert.throws(() => validarCarrusel(prods(2), '   '), /texto/)
  assert.throws(() => validarCarrusel(prods(2), 'x'.repeat(1025)), /1024/)
  // repetidos y vacíos no cuentan: 2 iguales = 1 producto
  assert.throws(() => validarCarrusel([prods(1)[0], prods(1)[0], { retailerId: '' }], 'hola'), /al menos 2/)
  const ok = validarCarrusel(prods(10), '  mira estas  ')
  assert.equal(ok.productos.length, 10)
  assert.equal(ok.texto, 'mira estas')
})

test('ventanaAbiertaCarrusel: 24 h desde el último entrante, o pauta vigente, con margen', () => {
  const ahora = Date.parse('2026-10-13T12:00:00Z')
  const hace = (h) => new Date(ahora - h * 3600e3).toISOString()
  assert.equal(ventanaAbiertaCarrusel({ ultimoEntranteAt: hace(23) }, ahora), true)
  assert.equal(ventanaAbiertaCarrusel({ ultimoEntranteAt: hace(23.99) }, ahora), false)   // margen de 2 min
  assert.equal(ventanaAbiertaCarrusel({ ultimoEntranteAt: hace(30) }, ahora), false)
  assert.equal(ventanaAbiertaCarrusel({ ultimoEntranteAt: hace(30), pautaVenceEn: hace(-48) }, ahora), true)
  assert.equal(ventanaAbiertaCarrusel({}, ahora), false)
  assert.equal(ventanaAbiertaCarrusel(undefined, ahora), false)
})

test('plantillaCarrusel lee "nombre|idioma"', () => {
  assert.equal(plantillaCarrusel(''), null)
  assert.deepEqual(plantillaCarrusel('carrusel_productos'), { nombre: 'carrusel_productos', idioma: 'es' })
  assert.deepEqual(plantillaCarrusel(' carrusel | es_EC '), { nombre: 'carrusel', idioma: 'es_EC' })
})

test('payloadInteractivo: forma exacta de la doc (13-oct-2026)', () => {
  const p = payloadInteractivo({ to: '593969904191' }, 'CAT', prods(2), 'hola')
  assert.equal(p.type, 'interactive')
  assert.equal(p.interactive.type, 'carousel')
  assert.deepEqual(p.interactive.body, { text: 'hola' })
  assert.equal(p.interactive.header, undefined)
  assert.equal(p.interactive.footer, undefined)
  assert.deepEqual(p.interactive.action.cards[1], { card_index: 1, type: 'product', action: { product_retailer_id: '7900000000001', catalog_id: 'CAT' } })
})

test('payloadPlantilla: texto como {{1}} y producto en el header de cada tarjeta', () => {
  const p = payloadPlantilla({ to: '593' }, 'CAT', prods(2), 'hola', { nombre: 'carr', idioma: 'es' })
  assert.equal(p.template.name, 'carr')
  assert.deepEqual(p.template.components[0], { type: 'body', parameters: [{ type: 'text', text: 'hola' }] })
  assert.deepEqual(p.template.components[1].cards[0].components[0].parameters[0].product, { product_retailer_id: '7900000000000', catalog_id: 'CAT' })
})

test('guardado y lectura del carrusel en `botones`; los botones de siempre no se confunden', () => {
  const g = guardadoCarrusel(prods(2), 'interactivo')
  assert.equal(leerCarrusel(g).carrusel.length, 2)
  assert.equal(leerCarrusel('[{"id":"btn_1","title":"Sí"}]'), null)
  assert.equal(leerCarrusel('basura'), null)
  assert.equal(leerCarrusel(''), null)
})

test('productosParaCarrusel: sin foto / oculto / sin stock fuera; nombre repetido una vez', () => {
  const filas = [
    { retailer_id: '1', name: 'Chaqueta Dragon Ball Z', image_url: '', availability: 'in stock', visibility: 'published' },
    { retailer_id: '7903025463389', name: 'Chaqueta Dragon Ball Z Clásica | Mandarina Republic', image_url: 'https://a.png', price: '$35.00', availability: 'in stock', visibility: 'published' },
    { retailer_id: '7905920942173', name: 'Hoodie X-Men Storm Marvel | Mandarina Republic', image_url: 'https://b.png', availability: 'in stock', visibility: 'published' },
    { retailer_id: '7905920745565', name: 'Hoodie X-Men Storm Marvel | Mandarina Republic', image_url: 'https://c.png', availability: 'in stock', visibility: 'published' },
    { retailer_id: '9', name: 'Oculto', image_url: 'https://d.png', visibility: 'staging' },
    { retailer_id: '10', name: 'Agotado', image_url: 'https://e.png', availability: 'out of stock' },
  ]
  const r = productosParaCarrusel(filas)
  assert.deepEqual(r.map(p => p.retailerId), ['7903025463389', '7905920942173'])
  assert.equal(r[0].nombre, 'Chaqueta Dragon Ball Z Clásica')
  assert.equal(r[0].precio, '$35.00')
})
