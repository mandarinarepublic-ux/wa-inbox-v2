import test from 'node:test'
import assert from 'node:assert'
import { esHoraDeResumen, urgentesSinAvisar, textoUrgente, textoResumen } from '../lib/pendientes.js'

const MIN = 60 * 1000
// 15:00 UTC = 10:00 en Ecuador.
const AHORA = Date.parse('2026-08-11T15:00:00.000Z')
const haceMin = (m, base = AHORA) => new Date(base - m * MIN).toISOString()
const chat = (over = {}) => ({
  telefono: '593999111222', nombre: 'Karilu', estado: 'pendiente',
  ultimoEntranteAt: haceMin(40), ultimoAvisoTelegramAt: null, ...over,
})

test('el resumen cae en la corrida de los minutos 0 a 4, solo en horario', () => {
  assert.equal(esHoraDeResumen(AHORA), true)
  assert.equal(esHoraDeResumen(AHORA + 4 * MIN), true)
  assert.equal(esHoraDeResumen(AHORA + 5 * MIN), false)
  assert.equal(esHoraDeResumen(Date.parse('2026-08-11T06:00:00.000Z')), false) // 01:00
})

test('urgente: a partir de 30 min, una sola vez por espera', () => {
  assert.equal(urgentesSinAvisar([chat({ ultimoEntranteAt: haceMin(29) })], AHORA).length, 0)
  assert.equal(urgentesSinAvisar([chat()], AHORA).length, 1)
  // Ya avisado después del último mensaje → no repite.
  assert.equal(urgentesSinAvisar([chat({ ultimoAvisoTelegramAt: haceMin(5) })], AHORA).length, 0)
  // El aviso era de una espera anterior → vuelve a avisar.
  assert.equal(urgentesSinAvisar([chat({ ultimoAvisoTelegramAt: haceMin(90) })], AHORA).length, 1)
})

test('urgente: ni atendidos ni arrastre de más de un día', () => {
  assert.equal(urgentesSinAvisar([chat({ estado: 'atendido' })], AHORA).length, 0)
  assert.equal(urgentesSinAvisar([chat({ ultimoEntranteAt: haceMin(25 * 60) })], AHORA).length, 0)
})

test('textoUrgente enlaza cada nombre a su chat y escapa el HTML', () => {
  const t = textoUrgente([chat({ nombre: 'Ana <3' })], AHORA, 'https://inbox.test')
  assert.match(t, /href="https:\/\/inbox\.test\/inbox\?tel=593999111222"/)
  assert.match(t, /Ana &lt;3/)
  assert.match(t, /40 min/)
  assert.equal(textoUrgente([], AHORA, 'x'), '')
})

test('el resumen agrupa por urgencia y cuenta el arrastre', () => {
  const t = textoResumen([
    chat({ telefono: '1', nombre: 'Rojo', ultimoEntranteAt: haceMin(80) }),
    chat({ telefono: '2', nombre: 'Naranja', ultimoEntranteAt: haceMin(40) }),
    chat({ telefono: '3', nombre: 'Verde', ultimoEntranteAt: haceMin(5) }),
    chat({ telefono: '4', nombre: 'Viejo', ultimoEntranteAt: haceMin(30 * 60) }),
    chat({ telefono: '5', nombre: 'Listo', estado: 'atendido' }),
  ], AHORA, 'https://inbox.test')
  assert.match(t, /Pendientes 10:00 · 3 esperando/)
  assert.match(t, /🔴 <a[^>]*>Rojo<\/a> · 1 h 20 min/)
  assert.match(t, /🟠 <a[^>]*>Naranja<\/a> · 40 min/)
  assert.match(t, /🟢 1 de menos de 30 min/)
  assert.doesNotMatch(t, /Verde|Listo/)
  assert.match(t, /\+1 de más de un día/)
})

test('más de 5 nombres en un color se resumen como "+N más"', () => {
  const lista = Array.from({ length: 7 }, (_, i) => chat({ telefono: String(i), nombre: `C${i}`, ultimoEntranteAt: haceMin(90 + i) }))
  assert.match(textoResumen(lista, AHORA, 'x'), /🔴 \+2 más/)
})

test('sin pendientes de hoy no hay resumen; el arrastre solo se menciona a las 8', () => {
  const viejo = [chat({ ultimoEntranteAt: haceMin(30 * 60) })]
  assert.equal(textoResumen([], AHORA, 'x'), '')
  assert.equal(textoResumen(viejo, AHORA, 'x'), '')
  const ocho = Date.parse('2026-08-11T13:00:00.000Z')
  assert.match(textoResumen([chat({ ultimoEntranteAt: haceMin(30 * 60, ocho) })], ocho, 'x'), /\+1 de más de un día/)
})
