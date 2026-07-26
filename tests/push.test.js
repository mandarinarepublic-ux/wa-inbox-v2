import test from 'node:test'
import assert from 'node:assert'
import { recortar, cuerpoDeMensaje, debeNotificar, ENFRIAMIENTO_MS } from '../lib/push.js'

test('recortar deja los textos cortos intactos', () => {
  assert.equal(recortar('hola'), 'hola')
})

test('recortar colapsa espacios y saltos de linea', () => {
  assert.equal(recortar('hola   \n  mundo'), 'hola mundo')
})

test('recortar corta y agrega puntos suspensivos', () => {
  const largo = 'a'.repeat(200)
  const r = recortar(largo, 10)
  assert.equal(r.length, 10)
  assert.ok(r.endsWith('…'))
})

test('recortar tolera null y undefined', () => {
  assert.equal(recortar(null), '')
  assert.equal(recortar(undefined), '')
})

test('cuerpoDeMensaje usa el texto cuando es un mensaje de texto', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: 'quiero el vestido' }), 'quiero el vestido')
})

test('cuerpoDeMensaje describe una foto sin caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: '' }), '📷 Foto')
})

test('cuerpoDeMensaje combina descriptor y caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: 'esta talla' }), '📷 Foto · esta talla')
})

test('cuerpoDeMensaje nunca queda vacio', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: '   ' }), 'Mensaje nuevo')
})

test('debeNotificar deja pasar la primera vez', () => {
  assert.equal(debeNotificar(null, Date.now()), true)
})

test('debeNotificar bloquea dentro del enfriamiento', () => {
  const ahora = Date.parse('2026-07-26T12:00:00Z')
  const hace1min = new Date(ahora - 60_000).toISOString()
  assert.equal(debeNotificar(hace1min, ahora), false)
})

test('debeNotificar deja pasar despues del enfriamiento', () => {
  const ahora = Date.parse('2026-07-26T12:00:00Z')
  const hace6min = new Date(ahora - 6 * 60_000).toISOString()
  assert.equal(debeNotificar(hace6min, ahora), true)
})

test('debeNotificar ignora una fecha corrupta y deja pasar', () => {
  assert.equal(debeNotificar('no-es-fecha', Date.now()), true)
})

test('el enfriamiento es de 5 minutos', () => {
  assert.equal(ENFRIAMIENTO_MS, 5 * 60 * 1000)
})
