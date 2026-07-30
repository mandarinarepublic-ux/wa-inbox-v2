import test from 'node:test'
import assert from 'node:assert'
import { caminoDeSeguimiento } from '../lib/camino-seguimiento.js'

const MANDI = '1024077200794372'
const cfgConBot    = { ia: { MANDI: true },  seguimientos: { solo_ia_apagada: false } }
const cfgSinBot    = { ia: { MANDI: false }, seguimientos: { solo_ia_apagada: false } }
const cfgViejo     = { ia: { MANDI: true },  seguimientos: { solo_ia_apagada: true } }
const chatConIA    = { phoneId: MANDI, modoIA: true }
const chatSinIA    = { phoneId: MANDI, modoIA: false }

test('bot activo y funcion encendida: se DESPIERTA al bot', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgConBot, contacto: chatConIA }), 'despertar')
})

test('bot apagado por el chat: sale el TEXTO automatico', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgConBot, contacto: chatSinIA }), 'texto')
})

test('bot apagado por el canal: sale el TEXTO, aunque el chat diga IA', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgSinBot, contacto: chatConIA }), 'texto')
})

test('con solo_ia_apagada en true se conserva lo de hoy: SALTAR', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgViejo, contacto: chatConIA }), 'saltar')
})

test('con solo_ia_apagada en true y el bot apagado, igual sale el TEXTO', () => {
  assert.equal(caminoDeSeguimiento({ config: { ia: { MANDI: false }, seguimientos: { solo_ia_apagada: true } }, contacto: chatSinIA }), 'texto')
})

test('sin config no lanza y trata al bot como activo', () => {
  assert.equal(caminoDeSeguimiento({ config: null, contacto: chatConIA }), 'saltar')
})
