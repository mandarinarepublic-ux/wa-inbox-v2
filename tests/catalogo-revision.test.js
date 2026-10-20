import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararCatalogos, precioNumero } from '../lib/catalogo-revision.js'

const ahora = new Date('2026-10-20T12:00:00Z')
const cargaOk = { inicio: '2026-10-20T11:30:00Z', guardados: 2, borrados: 0, errores: 0 }
const fila = (id, o = {}) => ({ id, title: `Prod ${id}`, price: '35.00 USD', sale_price: '', availability: 'in stock', ...o })
const item = (id, o = {}) => ({ retailer_id: id, name: `Prod ${id}`, price: '$35.00', availability: 'in stock', ...o })

test('revisión: precios en los formatos de Shopify y de Meta', () => {
  assert.equal(precioNumero('35.00 USD'), 35)
  assert.equal(precioNumero('$1,234.50'), 1234.5)
  assert.equal(precioNumero('35,00 US$'), 35)
  assert.equal(precioNumero(''), null)
})

test('revisión: iguales → ok', () => {
  const r = compararCatalogos([fila('1'), fila('2')], [item('1'), item('2')], cargaOk, ahora)
  assert.equal(r.estado, 'ok')
  assert.match(r.resumen, /Iguales: 2 productos/)
})

test('revisión: faltan, sobran, precio de oferta y stock distintos → aviso con nombres', () => {
  const r = compararCatalogos(
    [fila('1', { sale_price: '30.00 USD' }), fila('2', { availability: 'out of stock' }), fila('3')],
    [item('1'), item('2'), item('9', { name: 'Viejo' })], cargaOk, ahora)
  assert.equal(r.estado, 'aviso')
  assert.deepEqual(r.detalle.faltan.map((x) => x.id), ['3'])
  assert.deepEqual(r.detalle.sobran.map((x) => x.nombre), ['Viejo'])
  assert.deepEqual(r.detalle.precio, [{ id: '1', nombre: 'Prod 1', shopify: 30, whatsapp: 35 }])
  assert.equal(r.detalle.stock.length, 1)
  assert.match(r.resumen, /Sobran en WhatsApp 1/)
  assert.match(r.resumen, /mañana 6:30/)
})

test('revisión: carga de Meta con errores o de hace días → error aunque las listas cuadren', () => {
  assert.equal(compararCatalogos([fila('1')], [item('1')], { ...cargaOk, errores: 3 }, ahora).estado, 'error')
  const vieja = compararCatalogos([fila('1')], [item('1')], { ...cargaOk, inicio: '2026-10-18T11:30:00Z' }, ahora)
  assert.equal(vieja.estado, 'error')
  assert.match(vieja.resumen, /desde hace 49 h/)
})

test('revisión: sin poder leer la carga, igual compara y lo dice', () => {
  const r = compararCatalogos([fila('1')], [item('1')], null, ahora)
  assert.equal(r.estado, 'ok')
  assert.match(r.resumen, /No se pudo leer la última carga/)
})
