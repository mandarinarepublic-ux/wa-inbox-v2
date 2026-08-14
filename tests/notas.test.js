// tipoNotaValido filtra el `tipo` que llega por POST /api/notas: es un campo que
// viene del navegador y maneja el color de la nota, así que cualquier valor que
// no sea uno de los dos conocidos se cae a null (neutral) en vez de colarse.
import test from 'node:test'
import assert from 'node:assert'
import { tipoNotaValido } from '../lib/notas.js'

test('acepta pago_ok', () => {
  assert.strictEqual(tipoNotaValido('pago_ok'), 'pago_ok')
})

test('acepta pago_error', () => {
  assert.strictEqual(tipoNotaValido('pago_error'), 'pago_error')
})

test('cualquier otro texto se cae a null', () => {
  assert.strictEqual(tipoNotaValido('lo-que-sea'), null)
  assert.strictEqual(tipoNotaValido('PAGO_OK'), null)
  assert.strictEqual(tipoNotaValido('<script>'), null)
})

test('undefined, null y vacio tambien caen a null', () => {
  assert.strictEqual(tipoNotaValido(undefined), null)
  assert.strictEqual(tipoNotaValido(null), null)
  assert.strictEqual(tipoNotaValido(''), null)
})
