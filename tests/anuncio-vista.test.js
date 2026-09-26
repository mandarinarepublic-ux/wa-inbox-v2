import test from 'node:test'
import assert from 'node:assert'
import { nombreDeAnuncio, extractoDeAnuncio, estadoDeAnuncio } from '../lib/anuncio-vista.js'

test('titular genérico ("Mandarina Republic") cede al nombre del Ads Manager', () => {
  assert.equal(nombreDeAnuncio({ etiqueta: 'Mandarina Republic', titular: 'Mandarina Republic', nombre_anuncio: 'SKELETOR - chat Mandi' }), 'SKELETOR - chat Mandi')
})

test('una etiqueta PROPIA manda sobre todo', () => {
  assert.equal(nombreDeAnuncio({ etiqueta: 'DBZ chaquetas', titular: 'Mandarina Republic', nombre_anuncio: 'DRAGONBALL' }), 'DBZ chaquetas')
})

test('sin nombre de Meta, un titular útil sirve; si no, la primera línea del texto', () => {
  assert.equal(nombreDeAnuncio({ titular: 'BEN10!' }), 'BEN10!')
  assert.equal(nombreDeAnuncio({ titular: 'Chatear con nosotros', texto: '\n⚠️ ALERTA DE DROP ⚠️\nLa Doom' }), '⚠️ ALERTA DE DROP ⚠️')
})

test('el extracto corta y el estado se traduce', () => {
  assert.equal(extractoDeAnuncio({ texto: 'a'.repeat(200) }, 10).length, 10)
  assert.equal(estadoDeAnuncio({ estado_anuncio: 'CAMPAIGN_PAUSED' }), 'pausado')
  assert.equal(estadoDeAnuncio({}), '')
})
