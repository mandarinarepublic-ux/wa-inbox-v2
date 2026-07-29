import test from 'node:test'
import assert from 'node:assert'
import { extraerEchoes } from '../lib/echoes.js'

// Payload REAL de Meta (inbox.webhook_eventos, 29-jul 10:50), recortado.
const REAL = {
  metadata: { phone_number_id: '118582961194601', display_phone_number: '593979104167' },
  contacts: [{ wa_id: '593987047531', user_id: 'EC.1716732149501584' }],
  message_echoes: [{
    id: 'wamid.HBgMNTkzOTg3MDQ3NTMx',
    to: '593987047531',
    from: '593979104167',
    text: { body: 'Test' },
    type: 'text',
    timestamp: '1785340249',
  }],
}

test('el telefono es el DESTINATARIO, nunca el remitente', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.telefono, '593987047531')
  assert.notEqual(e.telefono, '593979104167') // 'from' somos nosotros
})

test('el canal sale del metadata, no del from', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.phoneId, '118582961194601')
})

test('traduce el contenido y la fecha', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.tipo, 'texto')
  assert.equal(e.contenido, 'Test')
  assert.equal(e.wamid, 'wamid.HBgMNTkzOTg3MDQ3NTMx')
  assert.equal(e.fecha, new Date(1785340249 * 1000).toISOString())
})

test('una foto mandada desde el celular trae su media id', () => {
  const r = extraerEchoes({
    metadata: { phone_number_id: '118582961194601' },
    message_echoes: [{ id: 'W1', to: '593999', type: 'image', image: { id: 'MID9', caption: 'mira' } }],
  })
  assert.equal(r[0].tipo, 'imagen')
  assert.equal(r[0].mediaId, 'MID9')
  assert.equal(r[0].contenido, 'mira')
})

test('un echo sin destinatario o sin id se descarta, los demas siguen', () => {
  const r = extraerEchoes({
    metadata: { phone_number_id: 'P1' },
    message_echoes: [
      { id: 'W1', type: 'text', text: { body: 'sin to' } },
      { to: '593999', type: 'text', text: { body: 'sin id' } },
      { id: 'W3', to: '593888', type: 'text', text: { body: 'bueno' } },
    ],
  })
  assert.equal(r.length, 1)
  assert.equal(r[0].wamid, 'W3')
})

test('un value vacio o sin echoes devuelve lista vacia, sin lanzar', () => {
  assert.deepEqual(extraerEchoes({}), [])
  assert.deepEqual(extraerEchoes(null), [])
  assert.deepEqual(extraerEchoes({ metadata: {}, messages: [{ id: 'X' }] }), [])
})
