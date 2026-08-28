// Responder CITANDO con una respuesta rápida.
//
// Una respuesta rápida puede ser varias cosas seguidas: un texto, cinco fotos, un
// audio. WhatsApp entrega cada una como un mensaje aparte, así que la cita tiene
// que ir en UNA sola — la primera— o el cliente vería la misma pregunta citada
// cinco veces.
//
// Y tiene que ir en la primera que SALGA, no en "el texto": hay respuestas
// rápidas que son solo fotos. Si la cita se atara al texto, usar una de esas la
// perdería EN SILENCIO, que es justo la familia de bugs que este inbox viene
// peleando.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citaUnaVez } from '../lib/cita.js'

test('la primera pieza se lleva la cita', () => {
  const cita = citaUnaVez('wamid.ABC')
  assert.equal(cita(), 'wamid.ABC')
})

test('las siguientes NO la repiten', () => {
  // Cinco fotos citando la misma pregunta serían cinco citas en el chat del
  // cliente. Se cita una vez y el resto va suelto, debajo.
  const cita = citaUnaVez('wamid.ABC')
  cita()
  assert.equal(cita(), '')
  assert.equal(cita(), '')
})

test('sin cita, todas van sueltas', () => {
  const cita = citaUnaVez('')
  assert.equal(cita(), '')
  assert.equal(cita(), '')
})

test('null o undefined se tratan como sin cita', () => {
  assert.equal(citaUnaVez(null)(), '')
  assert.equal(citaUnaVez(undefined)(), '')
})

test('la cita NO se gasta si la primera pieza no llegó a pedirla', () => {
  // Caso real: una respuesta rápida SIN texto. La primera que pide es la foto, y
  // le toca a ella. Si el texto la hubiera "gastado" sin mandarse, la foto saldría
  // suelta y la cita se perdería sin que nadie se entere.
  const cita = citaUnaVez('wamid.XYZ')
  assert.equal(cita(), 'wamid.XYZ', 'se la lleva la primera que efectivamente pide')
})

test('cada respuesta rápida arranca con su propia cita', () => {
  // El contador es por envío, no global: dos respuestas rápidas seguidas no pueden
  // compartir estado.
  const a = citaUnaVez('wamid.1'); a()
  const b = citaUnaVez('wamid.2')
  assert.equal(b(), 'wamid.2')
})
