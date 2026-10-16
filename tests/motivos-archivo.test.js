// El rescate decía "no estaban en Meta" para CUALQUIER fallo. El 16-oct-2026 tres
// .psd que Meta sí tenía se dieron por perdidos: era el tope de 25 MB del bucket.
import test from 'node:test'
import assert from 'node:assert'
import { motivoDeSubida, motivoDeLookup } from '../lib/media-archive.js'

test('solo un 400/404 de Meta cuenta como borrado', () => {
  assert.strictEqual(motivoDeLookup(400), 'meta_ya_lo_borro')
  assert.strictEqual(motivoDeLookup(404), 'meta_ya_lo_borro')
  assert.strictEqual(motivoDeLookup(401), 'meta_respondio_401')
  assert.strictEqual(motivoDeLookup(500), 'meta_respondio_500')
})

test('los rechazos del bucket se nombran (mensajes reales de Supabase)', () => {
  assert.strictEqual(motivoDeSubida('The object exceeded the maximum allowed size'), 'muy_grande_para_el_bucket')
  assert.strictEqual(motivoDeSubida('mime type image/vnd.adobe.photoshop is not supported'), 'tipo_rechazado_por_el_bucket')
  assert.match(motivoDeSubida('algo raro'), /^bucket: algo raro/)
})
