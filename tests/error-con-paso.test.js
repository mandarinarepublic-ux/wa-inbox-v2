// lib/error-con-paso.js — un error de envío dice qué pasó y qué hacer (22-nov-2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explicarError } from '../lib/error-con-paso.js'

test('ventana cerrada (131047): el paso es la plantilla, por código o por el texto de Meta', () => {
  assert.match(explicarError({ ok: false, error: 'Re-engagement message', codigo: 131047 }).texto, /24 h.*→.*plantilla/)
  assert.match(explicarError({ ok: false, error: 'Re-engagement message' }).texto, /plantilla/)
})

test('☠️ sin respuesta del servidor NUNCA dice «vuelve a enviar»: puede haber salido', () => {
  for (const r of [null, { ok: false }, { ok: false, error: 'Failed to fetch' }, { ok: false, error: 'HTTP 504' }]) {
    const t = explicarError(r).texto
    assert.match(t, /mira el chat/, JSON.stringify(r))
    assert.doesNotMatch(t, /vuelve a enviar|reintenta/, JSON.stringify(r))
  }
})

test('pago pendiente y token vencido dicen a quién acudir', () => {
  assert.match(explicarError({ error: 'x', codigo: 131042 }).texto, /Facturación/)
  assert.match(explicarError({ error: 'Error validating access token' }).texto, /administrador/)
})

test('un error desconocido se muestra tal cual, con un paso genérico', () => {
  const t = explicarError({ ok: false, error: 'Algo raro (132001)' }, 'la foto').texto
  assert.equal(t, '✗ No se pudo enviar la foto: Algo raro (132001) → reintenta; si se repite, avisa al administrador')
})

test('un mensaje nuestro que ya trae su paso no recibe otro', () => {
  const t = explicarError({ ok: false, error: 'No se pudo enviar la foto: pesa 9 MB. Súbela más liviana.' }).texto
  assert.doesNotMatch(t, /→/)
  assert.match(t, /Súbela más liviana/)
})

test('un código que no conocemos no se inventa motivo: cae al texto', () => {
  assert.match(explicarError({ error: 'Rate limit hit', codigo: 999 }).texto, /Rate limit hit/)
})
