import test from 'node:test'
import assert from 'node:assert'
import { itemsDePedido, armarPedido } from '../lib/catalogo.js'

// Un pedido del catálogo de WhatsApp trae SOLO el id del producto: ni nombre ni
// foto. Medido el 4-sep-2026: 20 pedidos ($760) y ninguno se podía identificar.
// El precio no sirve para adivinar — 45 productos de MANDARINA cuestan $35.
const RAW = {
  type: 'order',
  order: {
    catalog_id: '3995559414068729',
    product_items: [
      { product_retailer_id: '44500256129117', quantity: 1, item_price: 35, currency: 'USD' },
      { product_retailer_id: '43669013037149', quantity: 2, item_price: 40, currency: 'USD' },
    ],
  },
}

test('itemsDePedido saca el catalogo y las lineas del payload de Meta', () => {
  const p = itemsDePedido(RAW)
  assert.equal(p.catalogId, '3995559414068729')
  assert.equal(p.items.length, 2)
  assert.deepEqual(p.items[0], { retailerId: '44500256129117', cant: 1, precio: 35, moneda: 'USD' })
  assert.equal(p.items[1].cant, 2)
})

test('itemsDePedido devuelve null si no es un pedido', () => {
  assert.equal(itemsDePedido({ type: 'text', text: { body: 'hola' } }), null)
  assert.equal(itemsDePedido(null), null)
})

test('armarPedido le pega el nombre y la foto a cada linea', () => {
  const { items } = itemsDePedido(RAW)
  const mapa = new Map([['44500256129117', { nombre: 'Chaqueta Dragon Ball Z - CLASIC', imagen: 'https://cdn/x.jpg', color: 'Rojo' }]])
  const armado = armarPedido(items, mapa)
  assert.equal(armado[0].nombre, 'Chaqueta Dragon Ball Z - CLASIC')
  assert.equal(armado[0].imagen, 'https://cdn/x.jpg')
  assert.equal(armado[0].color, 'Rojo')
  assert.equal(armado[0].cant, 1)
})

// ☠️ Un producto que no se resuelve NO puede desaparecer. Siete ids de IND no
// tienen forma de resolverse (su catálogo no pertenece a "Mandarina Lab"): esas
// líneas tienen que seguir mostrando su id, no quedar en blanco. Es la misma
// regla que el filtro que escondía clientes: sin dato NO significa sin fila.
test('una linea que no resuelve conserva su id y NO se pierde', () => {
  const { items } = itemsDePedido(RAW)
  const armado = armarPedido(items, new Map())
  assert.equal(armado.length, 2, 'no se puede perder ninguna línea')
  assert.equal(armado[0].nombre, '')
  assert.equal(armado[0].retailerId, '44500256129117')
})

test('armarPedido calcula el total de cada linea', () => {
  const { items } = itemsDePedido(RAW)
  const armado = armarPedido(items, new Map())
  assert.equal(armado[0].total, 35)
  assert.equal(armado[1].total, 80)  // 2 × 40
})
