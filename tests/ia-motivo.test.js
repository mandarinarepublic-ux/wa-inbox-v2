import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motivoIASinResponder } from '../lib/ia-motivo.js'
import { CANALES } from '../lib/canales.js'

const pid = CANALES[0].phoneId
const id = CANALES[0].id

test('chat APAGADO: no hay nada que explicar', () => {
  assert.equal(motivoIASinResponder({ iaChat: false, config: { ia: { [id]: false } }, phoneId: pid }), null)
})
test('chat PRENDIDO y número apagado en AUTOS: avisa', () => {
  const m = motivoIASinResponder({ iaChat: true, config: { ia: { [id]: false } }, phoneId: pid, etiquetaCanal: 'MANDI' })
  assert.ok(m)
  assert.match(m.corto, /número MANDI/)
  assert.match(m.largo, /AUTOS/)
})
test('chat PRENDIDO y número prendido: sin aviso', () => {
  assert.equal(motivoIASinResponder({ iaChat: true, config: { ia: { [id]: true } }, phoneId: pid }), null)
})
test('config sin cargar: NO avisa (un aviso falso enseña a ignorarlo)', () => {
  assert.equal(motivoIASinResponder({ iaChat: true, config: null, phoneId: pid }), null)
})
