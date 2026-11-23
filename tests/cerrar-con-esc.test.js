// lib/cerrar-con-esc.js — Esc cierra SOLO la ventana de más arriba (22-nov-2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registrarEsc, manejarTeclaEsc } from '../lib/cerrar-con-esc.js'

test('sin ventanas abiertas, Esc no hace nada', () => {
  assert.equal(manejarTeclaEsc({ key: 'Escape' }), false)
})

test('con dos ventanas, Esc cierra solo la de arriba; el segundo Esc, la de abajo', () => {
  const cerradas = []
  const quitarAbajo = registrarEsc(() => cerradas.push('abajo'))
  const quitarArriba = registrarEsc(() => cerradas.push('arriba'))
  assert.equal(manejarTeclaEsc({ key: 'Escape' }), true)
  assert.deepEqual(cerradas, ['arriba'])
  quitarArriba()                                   // React la desmonta al cerrarse
  manejarTeclaEsc({ key: 'Escape' })
  assert.deepEqual(cerradas, ['arriba', 'abajo'])
  quitarAbajo()
  assert.equal(manejarTeclaEsc({ key: 'Escape' }), false)
})

test('otras teclas y Esc mientras se compone un acento no cierran nada', () => {
  let n = 0
  const quitar = registrarEsc(() => n++)
  assert.equal(manejarTeclaEsc({ key: 'Enter' }), false)
  assert.equal(manejarTeclaEsc({ key: 'Escape', isComposing: true }), false)
  assert.equal(n, 0)
  quitar()
})

test('desapilar dos veces no se lleva otra ventana', () => {
  const cerradas = []
  const quitarA = registrarEsc(() => cerradas.push('A'))
  const quitarB = registrarEsc(() => cerradas.push('B'))
  quitarB(); quitarB()
  manejarTeclaEsc({ key: 'Escape' })
  assert.deepEqual(cerradas, ['A'])
  quitarA()
})
