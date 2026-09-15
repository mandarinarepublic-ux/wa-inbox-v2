import test from 'node:test'
import assert from 'node:assert'
import { DEFAULTS, merge } from '../lib/automatizaciones.js'

test('la IA arranca PRENDIDA en los dos canales (el deploy no cambia nada)', () => {
  assert.equal(DEFAULTS.ia.MANDI, true)
  assert.equal(DEFAULTS.ia.REPUBLIC, true)
})

test('apagar un canal NO borra el otro (merge de un solo nivel)', () => {
  const base  = { ia: { MANDI: true, REPUBLIC: true } }
  const nueva = merge(base, { ia: { REPUBLIC: false } })
  assert.equal(nueva.ia.MANDI, true)
  assert.equal(nueva.ia.REPUBLIC, false)
})

test('tocar la IA no pisa los saludos ni los seguimientos', () => {
  const nueva = merge(DEFAULTS, { ia: { MANDI: false } })
  assert.equal(nueva.seguimientos.caliente.horas, 23)
  assert.ok(nueva.saludo_nuevo.texto.length > 0)
})

test('las recetas de bienvenida arrancan APAGADAS y vacías', () => {
  assert.equal(DEFAULTS.recetas.activo, false)
  assert.deepEqual(DEFAULTS.recetas.lista, [])
  assert.deepEqual(DEFAULTS.recetas.por_anuncio, {})
})

test('por_anuncio se reemplaza ENTERO (merge de un nivel): la pantalla lo manda completo', () => {
  const base  = merge(DEFAULTS, { recetas: { por_anuncio: { '111': 'r_a' } } })
  const nueva = merge(base,     { recetas: { por_anuncio: { '222': 'r_b' } } })
  assert.equal(nueva.recetas.por_anuncio['111'], undefined)
  assert.equal(nueva.recetas.por_anuncio['222'], 'r_b')
  assert.equal(nueva.recetas.activo, false) // lo que no se manda se conserva
})
