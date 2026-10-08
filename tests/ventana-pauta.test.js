// La ventana de PAUTA (free entry point): a un cliente que llegó de un anuncio
// se le puede escribir TEXTO LIBRE hasta que vence la ventana que informa Meta
// (hasta 7 días), aunque la de 24 h ya se haya cerrado.
//
// Probado el 7-oct-2026 con una clienta real de MANDI: texto libre a las 52 h,
// entregado como `free_entry_point`, `expiration_timestamp` = 7 días exactos
// desde el anuncio. El inbox lo bloqueaba a las 24 h.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pautaAbierta, puedeTextoLibre, MARGEN_PAUTA_MS, VENTANA_MS } from '../lib/bandeja.js'

// El caso real: escribió desde el anuncio el 5-oct 18:16 (Ecuador) y Meta dio
// la ventana hasta el 12-oct 18:17. La prueba salió el 7-oct a las 22:51.
const ESCRIBIO = '2026-10-05T23:16:04Z'
const VENCE    = '2026-10-12T23:17:00Z'
const PRUEBA   = Date.parse('2026-10-08T03:51:00Z')

test('el caso de Josita: fuera de 24 h pero dentro de la pauta → se puede escribir', () => {
  assert.equal(puedeTextoLibre(ESCRIBIO, null, PRUEBA), false)   // así estaba: bloqueado
  assert.equal(puedeTextoLibre(ESCRIBIO, VENCE, PRUEBA), true)   // así queda
})

test('sin ventana de pauta todo sigue como antes (24 h)', () => {
  const ahora = Date.parse('2026-10-08T12:00:00Z')
  assert.equal(puedeTextoLibre(new Date(ahora - VENTANA_MS + 1000).toISOString(), null, ahora), true)
  assert.equal(puedeTextoLibre(new Date(ahora - VENTANA_MS - 1000).toISOString(), null, ahora), false)
})

test('la pauta vencida no abre nada', () => {
  assert.equal(pautaAbierta(VENCE, Date.parse('2026-10-13T00:00:00Z')), false)
  assert.equal(puedeTextoLibre(ESCRIBIO, VENCE, Date.parse('2026-10-13T00:00:00Z')), false)
})

test('cierra con margen: a 5 min del vencimiento ya no se escribe', () => {
  const vence = Date.parse(VENCE)
  assert.equal(pautaAbierta(VENCE, vence - MARGEN_PAUTA_MS - 1000), true)
  assert.equal(pautaAbierta(VENCE, vence - MARGEN_PAUTA_MS + 1000), false)
})

test('ante la duda, CERRADA: sin fecha o fecha corrupta', () => {
  assert.equal(pautaAbierta(null, PRUEBA), false)
  assert.equal(pautaAbierta('', PRUEBA), false)
  assert.equal(pautaAbierta('no-es-fecha', PRUEBA), false)
  assert.equal(puedeTextoLibre(null, 'no-es-fecha', PRUEBA), false)
})

test('el aviso dice el vencimiento en hora de Ecuador', async () => {
  const { etiquetaVencePauta } = await import('../lib/bandeja.js')
  assert.equal(etiquetaVencePauta(VENCE), 'lun 12-oct 18:17')
  assert.equal(etiquetaVencePauta(null), '')
  assert.equal(etiquetaVencePauta('basura'), '')
})
