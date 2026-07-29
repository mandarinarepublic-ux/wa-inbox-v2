import test from 'node:test'
import assert from 'node:assert'
import { DEFAULTS, merge } from '../lib/automatizaciones.js'

test('la IA arranca PRENDIDA en los dos canales (el deploy no cambia nada)', () => {
  assert.equal(DEFAULTS.ia.MANDI, true)
  assert.equal(DEFAULTS.ia.REPUBLIC, true)
})

test('apagar un canal NO borra el otro (merge de un solo nivel)', () => {
  const base  = { ia: { MANDI: true, REPUBLIC: true } }
  const nueva = merge(base, { ia: { REPUBLIC: false } })
  assert.equal(nueva.ia.MANDI, true)
  assert.equal(nueva.ia.REPUBLIC, false)
})

test('tocar la IA no pisa los saludos ni los seguimientos', () => {
  const nueva = merge(DEFAULTS, { ia: { MANDI: false } })
  assert.equal(nueva.seguimientos.caliente.horas, 23)
  assert.ok(nueva.saludo_nuevo.texto.length > 0)
})
