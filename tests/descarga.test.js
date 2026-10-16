// Documentos del cliente (.ai, .psd, .eps…) que bajaban como `wamid….bin`.
import test from 'node:test'
import assert from 'node:assert'
import { extensionDeArchivo, nombreDeDescarga, urlDeDescarga } from '../lib/descarga.js'

const SB = 'https://piingkecjgoisnxccvaa.supabase.co/storage/v1/object/public/inbox-media/MANDI/wamid.HBgM.bin'

test('la extensión sale del nombre que puso el cliente', () => {
  assert.strictEqual(extensionDeArchivo('Conejo.ai'), 'ai')
  assert.strictEqual(extensionDeArchivo('Diseño HAMC Nomads002_2026_TRAMA.PSD'), 'psd')
  assert.strictEqual(extensionDeArchivo('LOGO VECTOR .ps'), 'ps')
  assert.strictEqual(extensionDeArchivo('sin extension'), '')
  assert.strictEqual(extensionDeArchivo(''), '')
  assert.strictEqual(extensionDeArchivo(null), '')
})

test('el nombre de descarga no deja pasar rutas ni caracteres prohibidos', () => {
  assert.strictEqual(nombreDeDescarga('../../etc/passwd'), '_.._etc_passwd')
  assert.strictEqual(nombreDeDescarga('a:b*c?.ai'), 'a_b_c_.ai')
  assert.strictEqual(nombreDeDescarga('Diseño final.ai'), 'Diseño final.ai')
})

test('un .bin archivado en Supabase baja con el nombre original', () => {
  assert.strictEqual(urlDeDescarga(SB, 'Conejo.ai'), `${SB}?download=Conejo.ai`)
  assert.strictEqual(urlDeDescarga(SB, 'Diseño 1.ai'), `${SB}?download=Dise%C3%B1o%201.ai`)
})

test('sin nombre o fuera de Supabase, la URL queda igual', () => {
  assert.strictEqual(urlDeDescarga(SB, ''), SB)
  assert.strictEqual(urlDeDescarga('/api/media?id=123', 'Conejo.ai'), '/api/media?id=123')
  assert.strictEqual(urlDeDescarga('', 'Conejo.ai'), '')
})
