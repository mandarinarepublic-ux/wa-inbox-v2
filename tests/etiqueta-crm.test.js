import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etiquetaPedido, etapaVigente, tail9 } from '../lib/etiqueta-crm.js'

const AHORA = Date.parse('2026-09-22T15:00:00Z')
const P = (x) => ({ pedido_id: 'IND-XAV-6044', estado_pago: 'PAGADO', monto_pendiente: 0, fecha_pedido: '2026-09-19T14:31:06Z', fecha_actualizacion: '2026-09-21T13:08:00Z', ...x })

test('EN_FABRICA → 🏭 (el caso del "ayer fue enviado")', () => {
  assert.equal(etiquetaPedido(P({ estado_pedido: 'EN_FABRICA' }), AHORA).texto, '🏭 En fábrica · IND-XAV-6044')
})

test('DESPACHO → 📦 por despachar; COMPLETADO → 🚚 despachado por 7 días', () => {
  assert.match(etiquetaPedido(P({ estado_pedido: 'DESPACHO' }), AHORA).texto, /^📦 Por despachar/)
  assert.match(etiquetaPedido(P({ estado_pedido: 'COMPLETADO' }), AHORA).texto, /^🚚 Despachado/)
  assert.equal(etiquetaPedido(P({ estado_pedido: 'COMPLETADO', fecha_actualizacion: '2026-09-10T00:00:00Z' }), AHORA), null)
})

test('ENTREGADO no se muestra; sin pedido tampoco', () => {
  assert.equal(etiquetaPedido(P({ estado_pedido: 'ENTREGADO' }), AHORA), null)
  assert.equal(etiquetaPedido(null, AHORA), null)
})

test('abono con saldo se suma a la etiqueta, aunque el pedido ya no se muestre', () => {
  assert.equal(etiquetaPedido(P({ estado_pedido: 'EN_FABRICA', estado_pago: 'ABONO', monto_pendiente: 12.5 }), AHORA).texto,
    '🏭 En fábrica · IND-XAV-6044 · 💳 Saldo $12,50')
  assert.equal(etiquetaPedido(P({ estado_pedido: 'ENTREGADO', estado_pago: 'ABONO', monto_pendiente: 5 }), AHORA).texto, '💳 Saldo $5,00')
})

test('etapaVigente: 💬💳🛒 se cumplen con un pedido posterior; 🔁 nunca', () => {
  const pedido = { fecha_pedido: '2026-09-21T02:00:00Z' }
  assert.equal(etapaVigente('falta_pedido', '2026-09-20T22:00:00Z', pedido), '')
  assert.equal(etapaVigente('cotizando', '2026-09-20T22:00:00Z', pedido), '')
  assert.equal(etapaVigente('falta_pedido', '2026-09-22T10:00:00Z', pedido), 'falta_pedido')   // marcado DESPUÉS: otra compra
  assert.equal(etapaVigente('postventa', '2026-09-20T22:00:00Z', pedido), 'postventa')
  assert.equal(etapaVigente('falta_pedido', '2026-09-20T22:00:00Z', null), 'falta_pedido')
  assert.equal(etapaVigente('', null, pedido), '')
})

test('tail9', () => {
  assert.equal(tail9('593991699942'), '991699942')
  assert.equal(tail9('0991699942'), '991699942')
})
