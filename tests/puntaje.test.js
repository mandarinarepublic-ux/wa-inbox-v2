import test from 'node:test'
import assert from 'node:assert'
import { puntajeChat, motivoPuntaje, colorDePct, COLORES, valorOrden } from '../lib/puntaje.js'
import { ordenarBandeja } from '../lib/orden-bandeja.js'

const AHORA = Date.parse('2026-11-28T15:00:00Z')
const ficha = (extra = {}) => ({
  scorePct: 42, scoreN: 18, scoreMotivo: 'talla,envio,pago', scorePauta: true,
  scoreDesde: '2026-11-26T10:00:00Z', ultimoEntranteAt: '2026-11-28T14:00:00Z', ...extra,
})

test('los colores siguen las franjas de Rodrigo', () => {
  assert.equal(colorDePct(1), COLORES.gris)
  assert.equal(colorDePct(9), COLORES.gris)
  assert.equal(colorDePct(10), COLORES.amarillo)
  assert.equal(colorDePct(49), COLORES.amarillo)
  assert.equal(colorDePct(50), COLORES.verde)
  assert.equal(colorDePct(99), COLORES.verde)
  assert.equal(colorDePct(100), COLORES.dorado)
})

test('el porqué se lee como lo pidió: "habló de talla, envío y pago · 18 mensajes"', () => {
  assert.equal(motivoPuntaje({ motivo: 'talla,envio,pago', n: 18 }), 'habló de talla, envío y pago · 18 mensajes')
  assert.equal(motivoPuntaje({ motivo: 'talla,foto', n: 1, pauta: true }), 'habló de talla · mandó foto · 1 mensaje · vino de un anuncio')
  assert.equal(motivoPuntaje({ motivo: '', n: 2 }), 'todavía no habla de talla, envío ni pago · 2 mensajes')
})

test('sin pedido muestra el porcentaje de la base', () => {
  const p = puntajeChat(ficha(), null, AHORA)
  assert.equal(p.texto, '42%')
  assert.equal(p.estrella, false)
  assert.equal(p.color, COLORES.amarillo)
  assert.match(p.titulo, /habló de talla, envío y pago · 18 mensajes/)
})

test('un pedido POSTERIOR al inicio del episodio es ⭐ 100 % dorado', () => {
  const p = puntajeChat(ficha(), { pedido_id: 'MAN-123', fecha_pedido: '2026-11-27T20:00:00Z' }, AHORA)
  assert.equal(p.texto, '⭐ 100%')
  assert.equal(p.estrella, true)
  assert.equal(p.color, COLORES.dorado)
  assert.match(p.titulo, /MAN-123/)
})

test('el pedido de una compra ANTERIOR no da estrella', () => {
  const p = puntajeChat(ficha(), { pedido_id: 'MAN-9', fecha_pedido: '2026-09-01T10:00:00Z' }, AHORA)
  assert.equal(p.estrella, false)
})

test('un pedido del mismo día con la fecha corrida unas horas sigue dando estrella', () => {
  const p = puntajeChat(ficha({ scoreDesde: '2026-11-26T20:00:00Z' }), { pedido_id: 'MAN-1', fecha_pedido: '2026-11-26T12:00:00Z' }, AHORA)
  assert.equal(p.estrella, true)
})

test('0 % nunca se muestra: el mínimo es 1 %', () => {
  assert.equal(puntajeChat(ficha({ scorePct: 0 }), null, AHORA).texto, '1%')
})

test('sin calcular o con el cliente callado más de 30 días, no hay cajita', () => {
  assert.equal(puntajeChat(ficha({ scorePct: null }), null, AHORA), null)
  assert.equal(puntajeChat(ficha({ scoreDesde: null }), null, AHORA), null)
  assert.equal(puntajeChat(ficha({ ultimoEntranteAt: '2026-10-01T10:00:00Z' }), null, AHORA), null)
  assert.equal(puntajeChat(undefined, null, AHORA), null)
})

test('Pendientes por puntaje: ⭐ y el más alto arriba, el sin puntaje al fondo, empate por espera', () => {
  const conv = (telefono) => ({ telefono, last: { timestamp: '2026-11-28T10:00:00Z' } })
  const espera = { A: '2026-11-28T09:00:00Z', B: '2026-11-28T08:00:00Z', C: '2026-11-28T07:00:00Z', D: '2026-11-28T06:00:00Z' }
  const pts = { A: 71, B: 100, C: -1, D: 71 }
  const r = ordenarBandeja([conv('A'), conv('B'), conv('C'), conv('D')], 'pendiente', t => espera[t], {
    puntajeDe: c => pts[c.telefono],
  })
  // B ⭐, luego los dos de 71 % (D espera desde antes que A), y C sin puntaje al fondo.
  assert.deepEqual(r.map(c => c.telefono), ['B', 'D', 'A', 'C'])
})

test('valorOrden: sin cajita = -1', () => {
  assert.equal(valorOrden(null), -1)
  assert.equal(valorOrden({ pct: 30 }), 30)
})
