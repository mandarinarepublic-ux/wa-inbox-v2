import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traducirEstadoLegado, necesitaConfirmarAtendido, alertaVentanaCierra, deudaVieja, esperaCliente, chipsDeChat, esEtapa } from '../lib/gestion.js'
import { HORA_MS } from '../lib/temperatura.js'

const AHORA = Date.parse('2026-09-22T15:00:00Z')
const hace = (h) => new Date(AHORA - h * HORA_MS).toISOString()

test('traducirEstadoLegado: la IA pide SOPORTE → 🔴 + 📌 🎧', () => {
  assert.deepEqual(traducirEstadoLegado('SOPORTE'), { estado: 'PENDIENTE', deuda: { nota: 'Soporte', por: 'ia' } })
  assert.deepEqual(traducirEstadoLegado('soporte '), { estado: 'PENDIENTE', deuda: { nota: 'Soporte', por: 'ia' } })
})

test('traducirEstadoLegado: pestañas viejas (💰 venta, 📋 encuesta) nunca esconden el chat', () => {
  assert.deepEqual(traducirEstadoLegado('venta'), { etapa: 'falta_pedido' })
  assert.deepEqual(traducirEstadoLegado('encuesta'), { estado: 'ATENDIDO' })
  assert.deepEqual(traducirEstadoLegado('pendiente'), { estado: 'PENDIENTE' })
  assert.deepEqual(traducirEstadoLegado('Archivado'), { estado: 'ARCHIVADO' })
  assert.deepEqual(traducirEstadoLegado('inventado'), {})
  assert.deepEqual(traducirEstadoLegado(null), {})
})

test('necesitaConfirmarAtendido solo si lo último es del cliente', () => {
  assert.equal(necesitaConfirmarAtendido('ENTRANTE'), true)
  assert.equal(necesitaConfirmarAtendido('entrante'), true)
  assert.equal(necesitaConfirmarAtendido('SALIENTE'), false)
  assert.equal(necesitaConfirmarAtendido(undefined), false)
})

test('⏰ ventana: 20–24 h de silencio y algo en juego', () => {
  const base = { estado: 'atendido', ultimoEntranteAt: hace(21), etapa: 'esperando_pago' }
  assert.equal(alertaVentanaCierra(base, AHORA), true)
  assert.equal(alertaVentanaCierra({ ...base, ultimoEntranteAt: hace(19) }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, ultimoEntranteAt: hace(24) }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, etapa: '' }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, etapa: '', deudaAt: hace(1) }, AHORA), true)
  assert.equal(alertaVentanaCierra({ ...base, etapa: 'falta_pedido' }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, estado: 'archivado' }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, tipoContacto: 'interno' }, AHORA), false)
  assert.equal(alertaVentanaCierra({ ...base, ultimoEntranteAt: null }, AHORA), false)
})

test('📌 viejo a las 12 h', () => {
  assert.equal(deudaVieja({ deudaAt: hace(12) }, AHORA), true)
  assert.equal(deudaVieja({ deudaAt: hace(11.9) }, AHORA), false)
  assert.equal(deudaVieja({ deudaAt: null }, AHORA), false)
})

test('esperaCliente: solo en 🔴 y para clientes', () => {
  assert.equal(esperaCliente({ estado: 'pendiente', ultimoEntranteAt: hace(0.5) }, AHORA), 30)
  assert.equal(esperaCliente({ estado: 'atendido', ultimoEntranteAt: hace(0.5) }, AHORA), 0)
  assert.equal(esperaCliente({ estado: 'pendiente', ultimoEntranteAt: hace(0.5), tipoContacto: 'interno' }, AHORA), 0)
  assert.equal(esperaCliente({ estado: 'pendiente', ultimoEntranteAt: null }, AHORA), 0)
})

test('chipsDeChat: el ejemplo del manual (🔴 ❄️ 🛒 📌 🤖)', () => {
  const chips = chipsDeChat({
    estado: 'pendiente', ultimoEntranteAt: hace(8), etapa: 'falta_pedido', etapaPor: 'humano',
    deudaAt: hace(1), deudaNota: 'ya le mando el boceto', deudaPor: 'auto',
  }, AHORA)
  assert.deepEqual(chips.map(c => c.key), ['espera', 'temp', 'etapa', 'deuda'])
  assert.equal(chips[1].texto, '❄️ 8 h')
  assert.equal(chips[2].texto, '🛒 Falta pedido')
  assert.match(chips[3].texto, /^📌 ya le mando el boceto · 🤖$/)
})

test('chipsDeChat: derivación de la IA se ve como 📌 🎧', () => {
  const chips = chipsDeChat({ estado: 'pendiente', ultimoEntranteAt: hace(0.01), deudaAt: hace(0.01), deudaNota: 'Soporte', deudaPor: 'ia' }, AHORA)
  assert.ok(chips.find(c => c.key === 'deuda').texto.startsWith('📌 🎧 Soporte'))
})

test('chipsDeChat: chat sin entrantes no revienta ni pinta temperatura', () => {
  assert.deepEqual(chipsDeChat({ estado: 'atendido' }, AHORA), [])
  assert.deepEqual(chipsDeChat(null, AHORA), [])
})

test('esEtapa', () => {
  assert.equal(esEtapa('cotizando'), true)
  assert.equal(esEtapa('caliente'), false)
  assert.equal(esEtapa(''), false)
})
