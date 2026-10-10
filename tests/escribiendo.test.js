import test from 'node:test'
import assert from 'node:assert'
import { payloadEscribiendo, mandarEscribiendo } from '../lib/escribiendo.js'
import { CANALES } from '../lib/canales.js'

const PHONE = CANALES[0].phoneId

test('payloadEscribiendo: leído + typing_indicator sobre el mensaje del cliente', () => {
  assert.deepEqual(payloadEscribiendo('wamid.X'), {
    messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X', typing_indicator: { type: 'text' },
  })
  assert.equal(payloadEscribiendo(''), null)
  assert.equal(payloadEscribiendo(null), null)
})

test('mandarEscribiendo: va al número del cliente con el token y mira res.ok', async () => {
  const llamadas = []
  const fetchFn = async (url, init) => { llamadas.push({ url, init }); return { ok: true, status: 200 } }
  const r = await mandarEscribiendo({ phoneId: PHONE, wamid: 'wamid.X' }, { token: 'T', fetchFn })
  assert.deepEqual(r, { ok: true, status: 200 })
  assert.equal(llamadas[0].url, `https://graph.facebook.com/v22.0/${PHONE}/messages`)
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer T')
  assert.equal(JSON.parse(llamadas[0].init.body).typing_indicator.type, 'text')

  const malo = await mandarEscribiendo({ phoneId: PHONE, wamid: 'w' }, { token: 'T', fetchFn: async () => ({ ok: false, status: 400 }) })
  assert.deepEqual(malo, { ok: false, status: 400 })
  const roto = await mandarEscribiendo({ phoneId: PHONE, wamid: 'w' }, { token: 'T', fetchFn: async () => { throw new Error('red') } })
  assert.equal(roto.ok, false)
})

test('mandarEscribiendo: no llama a Meta sin wamid, sin token o con un número ajeno', async () => {
  let llamado = false
  const fetchFn = async () => { llamado = true; return { ok: true } }
  assert.equal((await mandarEscribiendo({ phoneId: PHONE, wamid: '' }, { token: 'T', fetchFn })).ok, false)
  assert.equal((await mandarEscribiendo({ phoneId: '999', wamid: 'w' }, { token: 'T', fetchFn })).ok, false)
  assert.equal((await mandarEscribiendo({ phoneId: PHONE, wamid: 'w' }, { token: '', fetchFn })).ok, false)
  assert.equal(llamado, false)
})
