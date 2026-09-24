import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILTRO_INICIAL, prepararVista, alternar, pasaFiltro, conteos, ordenarPorEspera } from '../lib/filtro-chats.js'
import { HORA_MS } from '../lib/temperatura.js'

const AHORA = Date.parse('2026-09-22T15:00:00Z')
const hace = (h) => new Date(AHORA - h * HORA_MS).toISOString()
const v = (c) => prepararVista({ telefono: c.t || 'x', ...c }, AHORA)

const lista = [
  v({ t: 'a', estado: 'pendiente', ultimoEntranteAt: hace(0.2) }),
  v({ t: 'b', estado: 'pendiente', ultimoEntranteAt: hace(8), etapa: 'cotizando' }),
  v({ t: 'c', estado: 'atendido', ultimoEntranteAt: hace(3), etapa: 'esperando_pago', deudaAt: hace(1), deudaPor: 'humano' }),
  v({ t: 'd', estado: 'archivado', ultimoEntranteAt: hace(8), etapa: 'cotizando', deudaAt: hace(1) }),
  v({ t: 'e', estado: 'pendiente', ultimoEntranteAt: null }),
  v({ t: 'f', estado: 'pendiente', ultimoEntranteAt: hace(0.5), deudaAt: hace(0.5), deudaPor: 'ia' }),
]
const tels = (f) => lista.filter(x => pasaFiltro(x, f)).map(x => x.telefono)

test('inicial: pendientes, sin archivados', () => {
  assert.deepEqual(tels(FILTRO_INICIAL), ['a', 'b', 'e', 'f'])
})

test('archivados nunca se cuelan en etapa/📌/temperatura salvo con ⚫', () => {
  assert.deepEqual(tels({ ...FILTRO_INICIAL, bandeja: 'todas', etapa: 'cotizando' }), ['b'])
  assert.deepEqual(tels({ ...FILTRO_INICIAL, bandeja: 'todas', deuda: true }), ['c', 'f'])
  assert.deepEqual(tels({ ...FILTRO_INICIAL, bandeja: 'archivado', etapa: 'cotizando' }), ['d'])
})

test('combina dimensiones: 🔴 + ❄️', () => {
  assert.deepEqual(tels({ ...FILTRO_INICIAL, temp: 'frio' }), ['b'])
})

test('chat sin entrantes queda fuera de cualquier filtro de temperatura', () => {
  for (const t of ['caliente', 'tibio', 'frio', 'dormido']) {
    assert.ok(!tels({ ...FILTRO_INICIAL, bandeja: 'todas', temp: t }).includes('e'))
  }
})

test('🎧 solo lo que derivó la IA', () => {
  assert.deepEqual(tels({ ...FILTRO_INICIAL, bandeja: 'todas', ia: true }), ['f'])
})

test('alternar', () => {
  assert.equal(alternar(FILTRO_INICIAL, 'bandeja', 'pendiente').bandeja, 'todas')
  assert.equal(alternar(FILTRO_INICIAL, 'bandeja', 'atendido').bandeja, 'atendido')
  const f = alternar(FILTRO_INICIAL, 'etapa', 'cotizando')
  assert.equal(f.etapa, 'cotizando')
  assert.equal(alternar(f, 'etapa', 'cotizando').etapa, '')
  assert.equal(alternar(FILTRO_INICIAL, 'deuda').deuda, true)
  assert.equal(alternar(FILTRO_INICIAL, 'inventada', 1), FILTRO_INICIAL)
})

test('conteos facetados respetan las otras dimensiones', () => {
  const n = conteos(lista, FILTRO_INICIAL)
  assert.equal(n.bandeja.pendiente, 4)
  assert.equal(n.bandeja.atendido, 1)
  assert.equal(n.bandeja.archivado, 1)
  assert.equal(n.bandeja.todas, 5)
  assert.equal(n.etapa.cotizando, 1)
  assert.equal(n.ia, 1)
})

test('ordenarPorEspera: el que más espera primero', () => {
  const orden = ordenarPorEspera(lista.filter(x => pasaFiltro(x, FILTRO_INICIAL))).map(x => x.telefono)
  assert.deepEqual(orden, ['b', 'f', 'a', 'e'])
})

test('dentro de 24 h va primero (más espera arriba); lo viejo al final, lo más reciente primero', () => {
  const vs = [
    v({ t: 'viejo3sem', estado: 'pendiente', ultimoEntranteAt: hace(24 * 21) }),
    v({ t: 'min40', estado: 'pendiente', ultimoEntranteAt: hace(40 / 60) }),
    v({ t: 'h5', estado: 'pendiente', ultimoEntranteAt: hace(5) }),
    v({ t: 'dias2', estado: 'pendiente', ultimoEntranteAt: hace(48) }),
  ]
  assert.deepEqual(ordenarPorEspera(vs).map(x => x.telefono), ['h5', 'min40', 'dias2', 'viejo3sem'])
})

test('I6: un estado desconocido se trata como 🔴 (nunca desaparece de las bandejas)', () => {
  for (const raro of ['soporte', 'VENTA', 'encuesta', 'descartado', '', null]) {
    assert.equal(prepararVista({ telefono: 'z', estado: raro }, AHORA).estado, 'pendiente')
  }
  assert.equal(prepararVista({ telefono: 'z', estado: 'ATENDIDO' }, AHORA).estado, 'atendido')
})
