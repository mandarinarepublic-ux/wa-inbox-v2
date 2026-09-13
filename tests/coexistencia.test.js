// Coexistencia: lo que dice Meta al terminar el diálogo, el historial del celular
// y los nombres de la agenda. Casos armados sobre los ejemplos de la
// documentación de Meta (history y smb_app_state_sync).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  datosDeSesionES, extraerHistorial, extraerContactosSync,
  EVENTO_FIN_COEXISTENCIA, TEXTO_PLACEHOLDER,
} from '../lib/coexistencia.js'

test('datosDeSesionES: solo acepta mensajes de facebook.com con type WA_EMBEDDED_SIGNUP', () => {
  const msg = JSON.stringify({
    type: 'WA_EMBEDDED_SIGNUP', event: EVENTO_FIN_COEXISTENCIA, version: 3,
    data: { waba_id: '110133805380815', phone_number_id: '118582961194601' },
  })
  assert.equal(datosDeSesionES('https://evil.example', msg), null)
  assert.equal(datosDeSesionES('https://www.facebook.com', '{"type":"otro"}'), null)
  assert.equal(datosDeSesionES('https://www.facebook.com', 'no es json'), null)
  const d = datosDeSesionES('https://www.facebook.com', msg)
  assert.equal(d.wabaId, '110133805380815')
  assert.equal(d.phoneId, '118582961194601')
  assert.equal(d.coexistencia, true)
  assert.equal(d.terminado, true)
})

test('datosDeSesionES: cancelar y error se distinguen', () => {
  const c = datosDeSesionES('https://business.facebook.com', {
    type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER' },
  })
  assert.equal(c.cancelado, true)
  assert.equal(c.paso, 'PHONE_NUMBER')
  const e = datosDeSesionES('https://www.facebook.com', {
    type: 'WA_EMBEDDED_SIGNUP', event: 'ERROR', data: { error_message: 'boom' },
  })
  assert.equal(e.error, 'boom')
})

const valorHistorial = {
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '593979104167', phone_number_id: '118582961194601' },
  history: [{
    metadata: { phase: 1, chunk_order: 3, progress: 40 },
    threads: [{
      id: '593987498489',
      messages: [
        { from: '593987498489', id: 'wamid.ENTRA', timestamp: '1757000000', type: 'text', text: { body: 'hola' }, history_context: { status: 'READ' } },
        { from: '593979104167', to: '593987498489', id: 'wamid.SALE', timestamp: '1757000060', type: 'text', text: { body: 'buenas' }, history_context: { status: 'DELIVERED' } },
        { from: '593987498489', id: 'wamid.VIEJA', timestamp: '1750000000', type: 'media_placeholder', history_context: { status: 'READ' } },
        { from: '593987498489', timestamp: '1750000001', type: 'text', text: { body: 'sin id' } },
      ],
    }],
  }],
}

test('extraerHistorial: dirección por número visible, placeholder visible, sin id se descarta', () => {
  const filas = extraerHistorial(valorHistorial)
  assert.equal(filas.length, 3)
  const [entra, sale, vieja] = filas
  assert.equal(entra.direccion, 'ENTRANTE')
  assert.equal(entra.telefono, '593987498489')
  assert.equal(entra.contenido, 'hola')
  assert.equal(sale.direccion, 'SALIENTE')
  assert.equal(sale.telefono, '593987498489')
  assert.equal(sale.contenido, 'buenas')
  assert.equal(vieja.direccion, 'ENTRANTE')
  assert.equal(vieja.tipo, 'media_placeholder')
  assert.equal(vieja.contenido, TEXTO_PLACEHOLDER)
  for (const f of filas) {
    assert.equal(f.phoneId, '118582961194601')
    assert.equal(f.raw._historial.fase, 1)
    assert.equal(f.raw._historial.orden, 3)
  }
  assert.equal(entra.fecha, new Date(1757000000 * 1000).toISOString())
  assert.equal(entra.estado, 'read')
})

test('extraerHistorial: sin history devuelve vacío y no revienta', () => {
  assert.deepEqual(extraerHistorial({}), [])
  assert.deepEqual(extraerHistorial(null), [])
})

test('extraerContactosSync: solo add con nombre; remove se ignora', () => {
  const v = { state_sync: [
    { type: 'contact', action: 'add', contact: { full_name: 'Pablo Morales', first_name: 'Pablo', phone_number: '+593 98 749 8489' } },
    { type: 'contact', action: 'remove', contact: { phone_number: '593999999999' } },
    { type: 'contact', action: 'add', contact: { phone_number: '593888888888' } },
  ] }
  assert.deepEqual(extraerContactosSync(v), [{ telefono: '593987498489', nombre: 'Pablo Morales' }])
})
