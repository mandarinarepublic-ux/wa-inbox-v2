import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { archivoRechazadoDeEstado, megasDelDetalle, textoArchivoRechazado } from '../lib/archivo-rechazado.js'

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// El estado REAL que mandó Meta el 20-oct-2026 (PDF de 221 MB desde el celular de Rodrigo).
const real = {
  id: 'wamid.HBgMNTkzOTg3NDk4NDg5FQIAEhggQUNBRkE4NjczNkMwMzkyNzMyMzQ2NTcyRTQyNTc2MjUA',
  errors: [{ code: 131052, title: 'Media download error', message: 'Media download error',
    error_data: { details: 'Media file size too big 221.3007MB. Max file size we currently support: 100MB. Please communicate with your customer to send a media file that is smaller than 100MB' } }],
  status: 'failed', timestamp: '1792545626', recipient_id: '593987498489',
}

test('el 131052 real se vuelve un aviso entrante con el tamaño', () => {
  const m = archivoRechazadoDeEstado(real, '1024077200794372')
  assert.equal(m.wamid, real.id)
  assert.equal(m.telefono, '593987498489')
  assert.equal(m.phoneId, '1024077200794372')
  assert.match(m.contenido, /archivo de 221 MB que supera la capacidad de WhatsApp/)
  assert.equal(m.raw.type, 'archivo_rechazado')
})

test('otros estados no son este caso', () => {
  assert.equal(archivoRechazadoDeEstado({ ...real, status: 'delivered' }), null)
  assert.equal(archivoRechazadoDeEstado({ ...real, errors: [{ code: 131047 }] }), null)
  assert.equal(archivoRechazadoDeEstado({ status: 'failed', errors: [{ code: 131052 }] }), null)
})

test('sin tamaño en el detalle, igual avisa', () => {
  assert.equal(megasDelDetalle('otra cosa'), null)
  assert.match(textoArchivoRechazado(''), /WhatsApp no pudo entregarlo/)
})

test('el webhook engancha el aviso', () => {
  const s = readFileSync(`${raiz}app/api/webhook/route.js`, 'utf8')
  assert.match(s, /archivoRechazadoDeEstado\(st, phoneId\)/)
  assert.match(s, /procesarArchivosRechazados\(/)
})
