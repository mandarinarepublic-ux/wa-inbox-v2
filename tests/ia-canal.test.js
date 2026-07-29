import test from 'node:test'
import assert from 'node:assert'
import { iaActivaEnCanal, decidirIA } from '../lib/ia-canal.js'

// Los phone_id por defecto de lib/canales.js (sin env en las pruebas).
const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'

test('sin config, la IA esta activa en los dos canales', () => {
  assert.equal(iaActivaEnCanal(null, MANDI), true)
  assert.equal(iaActivaEnCanal({}, REPUBLIC), true)
})

test('apagar REPUBLIC no apaga MANDI', () => {
  const cfg = { ia: { MANDI: true, REPUBLIC: false } }
  assert.equal(iaActivaEnCanal(cfg, MANDI), true)
  assert.equal(iaActivaEnCanal(cfg, REPUBLIC), false)
})

test('un canal desconocido NO bloquea (spec 7)', () => {
  const cfg = { ia: { MANDI: false, REPUBLIC: false } }
  assert.equal(iaActivaEnCanal(cfg, '999999999999'), true)
  assert.equal(iaActivaEnCanal(cfg, ''), true)
})

test('el cortafuegos gana sobre el chat en modo IA', () => {
  const cfg = { ia: { REPUBLIC: false } }
  const contacto = { telefono: '593987047531', modoIA: true }
  assert.equal(decidirIA({ config: cfg, phoneId: REPUBLIC, contacto }), false)
})

test('con el canal prendido manda el interruptor del chat', () => {
  const cfg = { ia: { MANDI: true } }
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: { modoIA: true } }), true)
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: { modoIA: false } }), false)
})

test('contacto que no esta en la agenda: IA apagada', () => {
  const cfg = { ia: { MANDI: true } }
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: undefined }), false)
})
