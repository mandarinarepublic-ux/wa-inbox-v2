// LINK PAGO en Ventas: el monto que valida /api/linkpago y la nota que deja el
// callback de dLocal según el resultado del pago. Ambas son lógica pura, sin
// red ni Supabase, así que se prueban directo.
import test from 'node:test'
import assert from 'node:assert'
import { validarMonto, notaResultadoPago } from '../lib/dlocal.js'

// ── validarMonto ──────────────────────────────────────────────────────────
test('validarMonto acepta un numero positivo', () => {
  assert.strictEqual(validarMonto(35), 35)
})

test('validarMonto acepta un numero decimal', () => {
  assert.strictEqual(validarMonto(35.5), 35.5)
})

test('validarMonto convierte un string numerico', () => {
  assert.strictEqual(validarMonto('35'), 35)
})

test('validarMonto rechaza cero', () => {
  assert.strictEqual(validarMonto(0), null)
})

test('validarMonto rechaza negativos', () => {
  assert.strictEqual(validarMonto(-10), null)
})

test('validarMonto rechaza texto que no es numero', () => {
  assert.strictEqual(validarMonto('abc'), null)
})

test('validarMonto rechaza Infinity', () => {
  assert.strictEqual(validarMonto(Infinity), null)
})

test('validarMonto rechaza null, undefined y vacio', () => {
  assert.strictEqual(validarMonto(null), null)
  assert.strictEqual(validarMonto(undefined), null)
  assert.strictEqual(validarMonto(''), null)
})

// ── notaResultadoPago ─────────────────────────────────────────────────────
test('PAID arma la nota verde con tarjeta y nombre', () => {
  const pago = {
    status: 'PAID', amount: 35,
    card: { issuer: 'Visa' },
    payer: { first_name: 'María', last_name: 'Pérez' },
  }
  assert.deepStrictEqual(notaResultadoPago(pago), {
    tipo: 'pago_ok',
    texto: 'PAGADO $35 — Visa · María Pérez',
  })
})

test('PAID sin tarjeta ni payer usa los valores por defecto', () => {
  const pago = { status: 'PAID', amount: 20 }
  assert.deepStrictEqual(notaResultadoPago(pago), {
    tipo: 'pago_ok',
    texto: 'PAGADO $20 — N/A · Cliente',
  })
})

test('EXPIRED arma la nota roja de link expirado', () => {
  assert.deepStrictEqual(notaResultadoPago({ status: 'EXPIRED', amount: 35 }), {
    tipo: 'pago_error',
    texto: 'Link expirado',
  })
})

test('PENDING no genera nota: un pago en curso no es un resultado', () => {
  assert.strictEqual(notaResultadoPago({ status: 'PENDING', amount: 35 }), null)
})

test('cualquier otro estado (rechazado, cancelado, etc) es pago no completado', () => {
  assert.deepStrictEqual(notaResultadoPago({ status: 'REJECTED', amount: 35 }), {
    tipo: 'pago_error',
    texto: 'Pago no completado',
  })
})

test('sin status tambien cae en pago no completado', () => {
  assert.deepStrictEqual(notaResultadoPago({ amount: 35 }), {
    tipo: 'pago_error',
    texto: 'Pago no completado',
  })
})
