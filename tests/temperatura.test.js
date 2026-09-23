import { test } from 'node:test'
import assert from 'node:assert/strict'
import { temperaturaDe, horasDesde, textoHoras, HORA_MS } from '../lib/temperatura.js'

const AHORA = Date.parse('2026-09-22T15:00:00Z')
const hace = (h) => new Date(AHORA - h * HORA_MS).toISOString()

test('los cortes: <1 h caliente, 1–6 tibio, 6–24 frío, ≥24 dormido', () => {
  assert.equal(temperaturaDe(hace(0), AHORA), 'caliente')
  assert.equal(temperaturaDe(hace(0.99), AHORA), 'caliente')
  assert.equal(temperaturaDe(hace(1), AHORA), 'tibio')
  assert.equal(temperaturaDe(hace(5.99), AHORA), 'tibio')
  assert.equal(temperaturaDe(hace(6), AHORA), 'frio')
  assert.equal(temperaturaDe(hace(23.99), AHORA), 'frio')
  assert.equal(temperaturaDe(hace(24), AHORA), 'dormido')
  assert.equal(temperaturaDe(hace(24 * 30), AHORA), 'dormido')
})

test('sin fecha o con basura no hay temperatura (chat que solo tiene salientes)', () => {
  assert.equal(temperaturaDe(null, AHORA), '')
  assert.equal(temperaturaDe(undefined, AHORA), '')
  assert.equal(temperaturaDe('', AHORA), '')
  assert.equal(temperaturaDe('no-es-fecha', AHORA), '')
  assert.equal(horasDesde('no-es-fecha', AHORA), null)
})

test('una fecha en el futuro (reloj corrido) cuenta como recién escrito, no como negativo', () => {
  assert.equal(temperaturaDe(hace(-2), AHORA), 'caliente')
  assert.equal(horasDesde(hace(-2), AHORA), 0)
})

test('textoHoras', () => {
  assert.equal(textoHoras(0.2), 'ahora')
  assert.equal(textoHoras(8.7), '8 h')
  assert.equal(textoHoras(24), '1 día')
  assert.equal(textoHoras(50), '2 días')
  assert.equal(textoHoras(null), '')
})
