import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filaRegistroLink } from '../lib/registro-link-pago.js'

// El reporte de pagos del CRM depende de esta fila: sin client_tx_id, a
// Payphone ya no se le puede preguntar si el link se pagó.
test('Payphone: fila con su clientTransactionId, tienda y vendedor', () => {
  const f = filaRegistroLink({
    proveedor: 'payphone', monto: '35.5', link: 'https://ppls.me/x', clientTxId: '0abc1234-xyz123',
    telefono: '+593 98 765 4321', usuarioId: 7,
  })
  assert.equal(f.proveedor, 'PAYPHONE')
  assert.equal(f.origen, 'INBOX_MANDI')
  assert.equal(f.tienda, 'MANDARINA')
  assert.equal(f.client_tx_id, '0abc1234-xyz123')
  assert.equal(f.vendedor_id, '7')
  assert.equal(f.celular, '593987654321')
  assert.equal(f.valor, 35.5)
})

test('dLocal: client_tx_id = order_id y externo_id = id del pago; sin vendedor queda null', () => {
  const f = filaRegistroLink({
    proveedor: 'dlocal', monto: 20, link: 'https://checkout.dlocalgo.com/validate/x',
    clientTxId: '593987654321-1762700000000', externoId: 'DP-9', telefono: '593987654321',
  })
  assert.equal(f.proveedor, 'DLOCAL')
  assert.equal(f.client_tx_id, '593987654321-1762700000000')
  assert.equal(f.externo_id, 'DP-9')
  assert.equal(f.vendedor_id, null)
})
