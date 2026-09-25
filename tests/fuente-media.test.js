import test from 'node:test'
import assert from 'node:assert'
import { fuenteDeMedia, hostPermitidoParaProxy, llevaToken, esUrlDeMeta } from '../lib/fuente-media.js'

const SUPA = 'https://piingkecjgoisnxccvaa.supabase.co/storage/v1/object/public/inbox-media/a.jpg'

test('la copia archivada gana al media_id (el media_id caduca a los ~30 días)', () => {
  assert.equal(fuenteDeMedia({ mediaUrl: SUPA, mediaId: '123' }), SUPA)
})

test('sin copia pública, el media_id va por el proxy', () => {
  assert.equal(fuenteDeMedia({ mediaId: '123' }), '/api/media?id=123')
})

test('una URL de Meta nunca se pinta directa (exige token): va por el proxy', () => {
  const u = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'
  assert.equal(fuenteDeMedia({ mediaUrl: u }), `/api/media?url=${encodeURIComponent(u)}`)
  assert.equal(fuenteDeMedia({ mediaUrl: u, mediaId: '9' }), '/api/media?id=9')
})

test('Drive se muestra en vista, no en descarga', () => {
  assert.equal(fuenteDeMedia({ mediaUrl: 'https://drive.google.com/uc?export=download&id=x' }),
    'https://drive.google.com/uc?export=view&id=x')
})

test('nada que pintar = vacío', () => {
  assert.equal(fuenteDeMedia({}), '')
})

test('el proxy solo acepta hosts de Meta (si no, se lleva el token a cualquier lado)', () => {
  assert.equal(hostPermitidoParaProxy('https://lookaside.fbsbx.com/x'), true)
  assert.equal(hostPermitidoParaProxy('https://scontent.xx.fbcdn.net/v/x.jpg'), true)
  assert.equal(hostPermitidoParaProxy('https://evil.example.com/x'), false)
  assert.equal(hostPermitidoParaProxy('https://lookaside.fbsbx.com.evil.com/x'), false)
  assert.equal(hostPermitidoParaProxy('no es url'), false)
})

test('el token solo va a la API de Meta, no a su CDN', () => {
  assert.equal(llevaToken('https://graph.facebook.com/v19.0/1'), true)
  assert.equal(llevaToken('https://scontent.xx.fbcdn.net/v/x.jpg'), false)
  assert.equal(esUrlDeMeta('https://fbsbx.com.attacker.io'), false)
})
