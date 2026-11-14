import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queBuscar, indexarPorTelefono } from '../lib/buscar-pedido.js'

test('el número solo busca por unique_id', () => {
  assert.deepEqual(queBuscar('6558'), { tipo: 'numero', numero: 6558 })
  assert.deepEqual(queBuscar(' #6558 '), { tipo: 'numero', numero: 6558 })
})

test('el ID completo o parcial busca por pedido_id en mayúsculas', () => {
  assert.deepEqual(queBuscar('man-xav-6558'), { tipo: 'id', id: 'MAN-XAV-6558' })
  assert.deepEqual(queBuscar('XAV-65'), { tipo: 'id', id: 'XAV-65' })
})

test('lo que no sirve para encontrar UN pedido no busca', () => {
  for (const q of ['', '  ', '65', 'hoodie', 'MAN', 'a b c']) assert.equal(queBuscar(q), null, q)
})

test('indexa por el celular del cliente Y por el teléfono de origen; gana el más reciente', () => {
  const idx = indexarPorTelefono([
    { pedido_id: 'MAN-XAV-1', estado_pedido: 'COMPLETADO', fecha_pedido: '2026-10-01', origen_telefono: null, clientes: { nombre: 'C A', celular: '0984669993' } },
    { pedido_id: 'MAN-XAV-6558', estado_pedido: 'EN_FABRICA', fecha_pedido: '2026-11-05', origen_telefono: '593911111111', clientes: { nombre: 'C A ', celular: '0984669993' } },
  ])
  assert.equal(idx['984669993'].pedido_id, 'MAN-XAV-6558')
  assert.equal(idx['984669993'].cliente, 'C A')
  assert.equal(idx['911111111'].pedido_id, 'MAN-XAV-6558')
})

test('sin celular legible no inventa claves', () => {
  assert.deepEqual(indexarPorTelefono([{ pedido_id: 'X-1', clientes: { celular: '123' } }]), {})
})
