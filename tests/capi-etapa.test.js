// Port desde IND (23-sep-2026): 💳 Esperando pago y 🛒 Falta pedido cuentan como
// venta en proceso (InitiateCheckout). En MANDI se SUMAN a 🔥/SOPORTE hasta la
// etapa 2 del port, cuando se retira la temperatura manual.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoPorEtapa } from '../lib/capi.js'

test('💳 y 🛒 cuentan como venta en proceso; 💬, 🔁 y vacío no', () => {
  assert.equal(motivoPorEtapa('esperando_pago'), 'esperando_pago')
  assert.equal(motivoPorEtapa('falta_pedido'), 'falta_pedido')
  assert.equal(motivoPorEtapa('cotizando'), null)
  assert.equal(motivoPorEtapa('postventa'), null)
  assert.equal(motivoPorEtapa(''), null)
})
