// Links de pago con Payphone: todo lo que se puede romper sin tocar la red.
// Lo delicado es que Payphone valida al CENTAVO (amount = base + IVA) y que el
// teléfono del cliente viaja dentro de un id de máximo 15 caracteres.
import test from 'node:test'
import assert from 'node:assert'
import {
  desglosarIva, idTransaccion, telefonoDeId, cuerpoLink, leerRespuestaLink, notaPagoPayphone,
} from '../lib/payphone.js'
import { normalizarProveedor, proveedorPorDefecto } from '../lib/linkpago.js'

// ── desglosarIva ─────────────────────────────────────────────────────────────
test('desglosarIva: $35 con IVA incluido', () => {
  assert.deepStrictEqual(desglosarIva(35), { amount: 3500, amountWithTax: 3043, tax: 457 })
})

test('desglosarIva: la suma cuadra al centavo en muchos montos', () => {
  for (const total of [0.01, 1, 9.99, 12.5, 35, 35.5, 99.99, 160, 1234.56]) {
    const d = desglosarIva(total)
    assert.strictEqual(d.amountWithTax + d.tax, d.amount, `no cuadra con ${total}`)
    assert.strictEqual(d.amount, Math.round(total * 100))
    assert.ok(Number.isInteger(d.amountWithTax) && Number.isInteger(d.tax))
  }
})

test('desglosarIva: rechaza cero, negativo y basura', () => {
  for (const malo of [0, -5, 'abc', NaN, Infinity, null]) assert.strictEqual(desglosarIva(malo), null)
})

// ── idTransaccion / telefonoDeId ─────────────────────────────────────────────
test('idTransaccion: 15 caracteres y el teléfono vuelve intacto', () => {
  for (const tel of ['593987654321', '593984159804', '+593 99 123 4567', '14155550123']) {
    const id = idTransaccion(tel)
    assert.ok(id.length <= 15, `${id} pasa de 15`)
    assert.match(id, /^[0-9a-z-]+$/)
    assert.strictEqual(telefonoDeId(id), tel.replace(/\D/g, ''))
  }
})

test('idTransaccion: sin teléfono o con uno enorme, id al azar sin teléfono', () => {
  for (const tel of ['', 'SOCIAL', '99999999999999999']) {
    const id = idTransaccion(tel)
    assert.strictEqual(id.length, 15)
    assert.strictEqual(telefonoDeId(id), '')
  }
})

test('idTransaccion: dos links al mismo cliente no chocan', () => {
  const ids = new Set(Array.from({ length: 500 }, () => idTransaccion('593987654321')))
  assert.strictEqual(ids.size, 500)
})

test('telefonoDeId: ids raros no inventan teléfonos', () => {
  for (const raro of ['', null, 'ID_UNICO_001', '593987654321-1731', 'abc']) {
    assert.strictEqual(telefonoDeId(raro), '')
  }
})

// ── cuerpoLink ───────────────────────────────────────────────────────────────
test('cuerpoLink: lo que pide la API Link, en centavos y con la suma exacta', () => {
  const b = cuerpoLink({ monto: 35, telefono: '593987654321', storeId: 'tienda-1', rnd: () => 0 })
  assert.strictEqual(b.amount, 3500)
  assert.strictEqual(b.amount, b.amountWithoutTax + b.amountWithTax + b.tax + b.service + b.tip)
  assert.strictEqual(b.currency, 'USD')
  assert.strictEqual(b.storeId, 'tienda-1')
  assert.strictEqual(b.oneTime, true)
  assert.strictEqual(b.expireIn, 48)
  assert.strictEqual(b.isAmountEditable, false)
  assert.ok(b.clientTransactionId.length <= 15)
  assert.strictEqual(telefonoDeId(b.clientTransactionId), '593987654321')
  assert.strictEqual(b.additionalData, '593987654321')
})

test('cuerpoLink: monto inválido corta antes de llamar a Payphone', () => {
  assert.throws(() => cuerpoLink({ monto: 0, telefono: '593987654321', storeId: 's' }), /mayor a cero/)
})

// ── leerRespuestaLink ────────────────────────────────────────────────────────
test('leerRespuestaLink: link pelado o como string JSON', () => {
  assert.strictEqual(leerRespuestaLink('https://payp.page.link/aYu55'), 'https://payp.page.link/aYu55')
  assert.strictEqual(leerRespuestaLink('"https://payp.page.link/aYu55"'), 'https://payp.page.link/aYu55')
})

test('leerRespuestaLink: un error de Payphone no pasa por link', () => {
  assert.strictEqual(leerRespuestaLink('{"message":"Validaciones fallidas","errorCode":800}'), null)
  assert.strictEqual(leerRespuestaLink(''), null)
  assert.strictEqual(leerRespuestaLink('http://inseguro.com'), null)
})

// ── notaPagoPayphone ─────────────────────────────────────────────────────────
test('notaPagoPayphone: aprobada → nota verde con monto, tarjeta y número', () => {
  const nota = notaPagoPayphone({ statusCode: 3, transactionStatus: 'Approved', amount: 3500, cardBrand: 'Visa Pichincha', transactionId: 32805807 })
  assert.deepStrictEqual(nota, { tipo: 'pago_ok', texto: 'PAGADO $35.00 — Visa Pichincha · Payphone #32805807' })
})

test('notaPagoPayphone: cancelada o pendiente no marca nada', () => {
  assert.strictEqual(notaPagoPayphone({ statusCode: 2, transactionStatus: 'Canceled' }), null)
  assert.strictEqual(notaPagoPayphone({ statusCode: 1 }), null)
  assert.strictEqual(notaPagoPayphone({}), null)
})

// ── proveedor ────────────────────────────────────────────────────────────────
test('normalizarProveedor: solo dlocal o payphone', () => {
  assert.strictEqual(normalizarProveedor('payphone'), 'payphone')
  assert.strictEqual(normalizarProveedor('PayPhone'), 'payphone')
  assert.strictEqual(normalizarProveedor('﻿dlocal'), 'dlocal') // BOM de PowerShell
  assert.strictEqual(normalizarProveedor('stripe'), null)
  assert.strictEqual(normalizarProveedor(undefined), null)
})

test('proveedorPorDefecto: sin variable sigue siendo dLocal', () => {
  const antes = process.env.LINKPAGO_PROVEEDOR
  delete process.env.LINKPAGO_PROVEEDOR
  assert.strictEqual(proveedorPorDefecto(), 'dlocal')
  process.env.LINKPAGO_PROVEEDOR = 'payphone'
  assert.strictEqual(proveedorPorDefecto(), 'payphone')
  process.env.LINKPAGO_PROVEEDOR = 'cualquiercosa'
  assert.strictEqual(proveedorPorDefecto(), 'dlocal')
  if (antes === undefined) delete process.env.LINKPAGO_PROVEEDOR
  else process.env.LINKPAGO_PROVEEDOR = antes
})
