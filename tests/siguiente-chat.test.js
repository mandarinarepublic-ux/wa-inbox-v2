// lib/siguiente-chat.js — Atendido → siguiente pendiente, J/K y el "0 pendientes" (20-nov-2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vecinoEnLista, siguienteTrasAtender, hayLogroPendientes, posicionEnLista } from '../lib/siguiente-chat.js'

const L = [
  { telefono: '593911', phoneId: 'MANDI' },
  { telefono: '593922', phoneId: 'MANDI' },
  { telefono: '593922', phoneId: 'REPUBLIC' },   // mismo cliente, otro número (GENERAL)
  { telefono: '593933', phoneId: 'MANDI' },
]

test('la fila se reconoce por teléfono Y número', () => {
  assert.equal(posicionEnLista(L, { telefono: '593922', phoneId: 'REPUBLIC' }), 2)
  assert.equal(posicionEnLista(L, { telefono: '593922', phoneId: 'MANDI' }), 1)
  assert.equal(posicionEnLista(L, { telefono: '593999', phoneId: 'MANDI' }), -1)
})

test('Atendido salta al de abajo; si era el último, al de arriba; si era el único, a ninguno', () => {
  assert.deepEqual(siguienteTrasAtender(L, L[1]), L[2])
  assert.deepEqual(siguienteTrasAtender(L, L[3]), L[2])
  assert.equal(siguienteTrasAtender([L[0]], L[0]), null)
  assert.equal(siguienteTrasAtender(L, { telefono: 'x', phoneId: 'y' }), null)
})

test('☠️ con algo escrito en la caja NO salta (el borrador saldría a otro cliente)', () => {
  assert.equal(siguienteTrasAtender(L, L[1], { hayBorrador: true }), null)
})

test('J/K: abajo y arriba; sin chat abierto J empieza por el primero', () => {
  assert.deepEqual(vecinoEnLista(L, L[0], +1), L[1])
  assert.deepEqual(vecinoEnLista(L, L[1], -1), L[0])
  assert.equal(vecinoEnLista(L, L[3], +1), null)
  assert.equal(vecinoEnLista(L, L[0], -1), null)
  assert.deepEqual(vecinoEnLista(L, null, +1), L[0])
  assert.equal(vecinoEnLista([], null, +1), null)
})

test('☠️ el "0 pendientes" solo con la bandeja vacía DE VERDAD y una sincronización buena reciente', () => {
  const ahoraMs = Date.parse('2026-11-20T22:00:00Z')
  const ok = { bandeja: 'pendiente', buscando: false, totalPendientes: 0, lastSyncMs: ahoraMs - 10_000, ahoraMs }
  assert.equal(hayLogroPendientes(ok), true)
  assert.equal(hayLogroPendientes({ ...ok, totalPendientes: 3 }), false)
  assert.equal(hayLogroPendientes({ ...ok, bandeja: 'atendido' }), false)
  assert.equal(hayLogroPendientes({ ...ok, buscando: true }), false)
  // Sin sincronizar (falló la carga) o con la última hace rato: no se festeja.
  assert.equal(hayLogroPendientes({ ...ok, lastSyncMs: NaN }), false)
  assert.equal(hayLogroPendientes({ ...ok, lastSyncMs: ahoraMs - 5 * 60_000 }), false)
})
