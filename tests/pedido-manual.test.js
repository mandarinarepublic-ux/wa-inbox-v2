// El inbox guarda los teléfonos como 593999989663 y el CRM exige 0999989663.
// Si la conversión falla, la precarga traba el formulario en vez de ayudar.
import test from 'node:test'
import assert from 'node:assert'
import { celularEcuador, urlPedidoManual, leerAvisoPedido } from '../lib/pedido-manual.js'

test('convierte el formato de WhatsApp al del CRM', () => {
  assert.strictEqual(celularEcuador('593999989663'), '0999989663')
  assert.strictEqual(celularEcuador('593987654321'), '0987654321')
})

test('aguanta el + y los espacios', () => {
  assert.strictEqual(celularEcuador('+593 99 998 9663'), '0999989663')
})

test('si ya viene en formato local lo deja igual', () => {
  assert.strictEqual(celularEcuador('0999989663'), '0999989663')
})

test('un número que no es de Ecuador devuelve vacío', () => {
  // Vacío = "no precargues". Mejor que meter algo que el CRM va a rechazar.
  assert.strictEqual(celularEcuador('12025550143'), '')
  assert.strictEqual(celularEcuador(''), '')
  assert.strictEqual(celularEcuador(null), '')
})

test('la URL lleva embed, celular y nombre, escapados', () => {
  const url = new URL(urlPedidoManual('593999989663', 'Ana & Cía'))
  assert.strictEqual(url.origin, 'https://crm.apps.mandarinaec.com')
  assert.strictEqual(url.pathname, '/dashboard/nuevo-pedido')
  assert.strictEqual(url.searchParams.get('embed'), '1')
  assert.strictEqual(url.searchParams.get('celular'), '0999989663')
  assert.strictEqual(url.searchParams.get('nombre'), 'Ana & Cía')
})

test('si el celular no convierte, no se manda el parámetro', () => {
  const url = new URL(urlPedidoManual('12025550143', 'Bob'))
  assert.strictEqual(url.searchParams.get('celular'), null)
  assert.strictEqual(url.searchParams.get('nombre'), 'Bob')
})

test('acepta el aviso del CRM', () => {
  const aviso = leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' },
  })
  assert.deepStrictEqual(aviso, { pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' })
})

test('RECHAZA un mensaje de otro origen', () => {
  // Lo esencial: un iframe recibe mensajes de cualquiera. Sin este filtro,
  // cualquier página podría hacernos marcar ventas falsas.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://evil.com',
    data: { tipo: 'pedido-creado', pedidoId: 'FALSO', montoTotal: 1, url: 'x' },
  }), null)
})

test('RECHAZA otro tipo de mensaje', () => {
  // Las extensiones del navegador y las herramientas de React mandan mensajes
  // al mismo tiempo; hay que ignorarlos sin romperse.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'otra-cosa', pedidoId: 'X' },
  }), null)
})

test('RECHAZA un aviso sin número de pedido', () => {
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', montoTotal: 5 },
  }), null)
})

test('no lanza con basura', () => {
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: 'hola' }), null)
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: null }), null)
  assert.strictEqual(leerAvisoPedido({}), null)
  assert.strictEqual(leerAvisoPedido(null), null)
})
