import test from 'node:test'
import assert from 'node:assert'
import { extensionDeMime } from '../lib/media-archive.js'

test('mapea los tipos de imagen de siempre', () => {
  assert.equal(extensionDeMime('image/jpeg'), 'jpg')
  assert.equal(extensionDeMime('image/png'), 'png')
})

test('mapea las notas de voz de WhatsApp', () => {
  assert.equal(extensionDeMime('audio/ogg'), 'ogg')
  assert.equal(extensionDeMime('audio/ogg; codecs=opus'), 'ogg')
  assert.equal(extensionDeMime('audio/mpeg'), 'mp3')
})

test('mapea video y documentos', () => {
  assert.equal(extensionDeMime('video/mp4'), 'mp4')
  assert.equal(extensionDeMime('video/3gpp'), '3gp')
  assert.equal(extensionDeMime('application/pdf'), 'pdf')
})

test('un tipo desconocido saca la extension del propio mime', () => {
  assert.equal(extensionDeMime('audio/x-wav'), 'wav')
  assert.equal(extensionDeMime('image/heic'), 'heic')
})

test('sin tipo devuelve bin, nunca jpg', () => {
  assert.equal(extensionDeMime(''), 'bin')
  assert.equal(extensionDeMime(null), 'bin')
  assert.equal(extensionDeMime('application/octet-stream'), 'bin')
})

test('no distingue mayusculas', () => {
  assert.equal(extensionDeMime('IMAGE/JPEG'), 'jpg')
})
