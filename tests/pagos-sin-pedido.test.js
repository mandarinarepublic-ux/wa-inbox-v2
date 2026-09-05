import test from 'node:test'
import assert from 'node:assert'
import { textoAvisoPagos } from '../lib/pagos-sin-pedido.js'

// ⚠️ POR QUÉ EXISTE, con números (auditoría del 4-sep-2026): dos clientes de IND
// pagaron y su pedido nunca se creó — Giovelly Achilie $160 y Jorge Díaz $40.
// Se encontraron a mano, revisando otra cosa. Nadie los habría visto.
const caso = (o = {}) => ({
  telefono: '593998627193', nombre: 'Giovelly Achilie',
  fecha: '2026-09-03T23:43:00.000Z', fotos: 1, ...o,
})

test('el aviso nombra al cliente y su telefono', () => {
  const t = textoAvisoPagos([caso()], { baseUrl: 'https://ind.app' })
  assert.match(t, /Giovelly Achilie/)
  assert.match(t, /593998627193/)
})

// ☠️ Tiene que decir POSIBLE. La regla es un indicio, no una certeza: una foto
// después de pedir el pago puede ser una talla o un diseño, no un comprobante.
// Si el aviso afirma "pago sin pedido" y a la tercera vez es falso, se apaga.
test('el aviso dice que es POSIBLE, no lo afirma', () => {
  assert.match(textoAvisoPagos([caso()], {}), /posible/i)
})

test('lleva el enlace para abrir el chat de una', () => {
  const t = textoAvisoPagos([caso()], { baseUrl: 'https://ind.app' })
  assert.match(t, /https:\/\/ind\.app\/inbox\?tel=593998627193/)
})

test('sin baseUrl no inventa un enlace roto', () => {
  const t = textoAvisoPagos([caso()], {})
  assert.ok(!t.includes('undefined') && !t.includes('null'), t)
})

test('agrupa varios en un solo aviso y los cuenta', () => {
  const t = textoAvisoPagos([caso(), caso({ telefono: '593939941359', nombre: 'Jorge Diaz' })], {})
  assert.match(t, /2/)
  assert.match(t, /Giovelly/)
  assert.match(t, /Jorge Diaz/)
})

// Sin casos NO se manda nada: un aviso diario que dice "0" entrena a ignorarlo.
test('sin casos devuelve vacio y no se manda nada', () => {
  assert.equal(textoAvisoPagos([], {}), '')
  assert.equal(textoAvisoPagos(null, {}), '')
})

// Un cliente sin nombre no puede salir como "undefined": se muestra su telefono.
test('un cliente sin nombre muestra su telefono', () => {
  const t = textoAvisoPagos([caso({ nombre: '' })], {})
  assert.ok(!/undefined/.test(t), t)
  assert.match(t, /593998627193/)
})
