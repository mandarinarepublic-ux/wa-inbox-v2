import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tramoDelCitado, estaCargado, claveSalto } from '../lib/ir-a-cita.js'
import { tramosPorMes } from '../lib/meses-chat.js'

// Mismo mensaje, dos envoltorios distintos (como los manda Meta): comparten el hash.
const hex = '3EB0C431D5A1B2C3D4E5F6A7'
const envolver = (prefijo) => 'wamid.' + Buffer.from(prefijo + hex).toString('base64')
const porNumero = envolver('HBgMNTkzOTg3NjU0MzIxFQIAERgS')
const porUsuario = envolver('HBgLRUMuMTIzNDU2Nzg5FQIAERgS')

test('la cita y el original con distinto envoltorio dan la misma clave', () => {
  assert.notEqual(porNumero, porUsuario)
  assert.equal(claveSalto(porNumero), claveSalto(porUsuario))
})

test('encuentra el mes plegado donde está el original', () => {
  const msgs = [
    { id: porNumero, t: new Date(2026, 7, 5) },
    { id: 'wamid.otro', t: new Date(2026, 8, 1) },
    { id: 'wamid.hoy', t: new Date(2026, 9, 20) },
  ]
  const tramos = tramosPorMes(msgs, m => m.t, new Date(2026, 9, 25))
  assert.deepEqual(tramoDelCitado(tramos, porUsuario), { clave: '2026-08', siempreAbierto: false })
  assert.deepEqual(tramoDelCitado(tramos, 'wamid.hoy'), { clave: '2026-10', siempreAbierto: true })
})

test('si el original no está cargado, lo dice (hay que traer historial)', () => {
  const msgs = [{ id: 'wamid.hoy', t: new Date() }]
  assert.equal(tramoDelCitado(tramosPorMes(msgs, m => m.t), porNumero), null)
  assert.equal(estaCargado(msgs, porNumero), false)
  assert.equal(estaCargado([{ id: porUsuario }], porNumero), true)
  assert.equal(estaCargado(msgs, ''), false)
})
