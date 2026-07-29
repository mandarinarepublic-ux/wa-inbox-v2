import test from 'node:test'
import assert from 'node:assert'
import { extraer, normalizarReferral } from '../lib/wa-mensaje.js'

test('extraer lee un texto', () => {
  const r = extraer({ type: 'text', text: { body: 'hola' } })
  assert.equal(r.tipo, 'texto')
  assert.equal(r.contenido, 'hola')
  assert.equal(r.mediaId, '')
})

test('extraer lee una imagen con caption y su media id', () => {
  const r = extraer({ type: 'image', image: { id: 'MID1', caption: 'esta talla' } })
  assert.equal(r.tipo, 'imagen')
  assert.equal(r.contenido, 'esta talla')
  assert.equal(r.mediaId, 'MID1')
})

test('extraer deja el audio sin texto pero con media id', () => {
  const r = extraer({ type: 'audio', audio: { id: 'AUD1' } })
  assert.equal(r.tipo, 'audio')
  assert.equal(r.contenido, '')
  assert.equal(r.mediaId, 'AUD1')
})

test('extraer usa el nombre del archivo como texto del documento', () => {
  const r = extraer({ type: 'document', document: { id: 'DOC1', filename: 'guia.pdf' } })
  assert.equal(r.tipo, 'documento')
  assert.equal(r.contenido, 'guia.pdf')
  assert.equal(r.mediaId, 'DOC1')
})

test('extraer arrastra el id del mensaje citado', () => {
  const r = extraer({ type: 'text', text: { body: 'si' }, context: { id: 'wamid.CITA' } })
  assert.equal(r.contextoId, 'wamid.CITA')
})

test('normalizarReferral devuelve null cuando no hay pauta', () => {
  assert.equal(normalizarReferral(null), null)
  assert.equal(normalizarReferral({}), null)
})
