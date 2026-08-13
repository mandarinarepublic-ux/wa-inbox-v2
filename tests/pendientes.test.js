import test from 'node:test'
import assert from 'node:assert'
import {
  horaEcuador, enHorarioLaboral, chatsQueAvisar, textoAviso, escaparHtml,
  ESPERA_MINIMA_MS, REPETIR_CADA_MS, ESPERA_MAXIMA_MS,
} from '../lib/pendientes.js'

const MIN = 60 * 1000
// Un martes cualquiera, 15:00 UTC = 10:00 en Ecuador (UTC-5 fijo, sin verano).
const AHORA = Date.parse('2026-08-11T15:00:00.000Z')
const haceMin = (m) => new Date(AHORA - m * MIN).toISOString()

const chat = (over = {}) => ({
  telefono: '593999111222', nombre: 'Karilu', estado: 'pendiente',
  ultimoEntranteAt: haceMin(30), ultimoAvisoTelegramAt: null, ...over,
})

test('horaEcuador no depende de la zona de la maquina', () => {
  assert.equal(horaEcuador(Date.parse('2026-08-11T15:00:00.000Z')), 10)
  assert.equal(horaEcuador(Date.parse('2026-08-11T03:00:00.000Z')), 22)
  // 04:00 UTC = 23:00 del dia ANTERIOR en Ecuador. El caso que se equivoca solo.
  assert.equal(horaEcuador(Date.parse('2026-08-11T04:00:00.000Z')), 23)
})

test('el horario laboral es de 8 a 21 hora Ecuador', () => {
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T15:00:00.000Z')), true)  // 10:00
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T12:00:00.000Z')), false) // 07:00 → no
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T13:00:00.000Z')), true)  // 08:00 → sí
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T06:00:00.000Z')), false) // 01:00
})

test('avisa de un pendiente que espera mas del minimo', () => {
  assert.equal(chatsQueAvisar([chat()], AHORA).length, 1)
})

test('NO avisa de un pendiente recien llegado', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: haceMin(2) })], AHORA).length, 0)
})

test('NO avisa de un chat que ya no esta pendiente', () => {
  assert.equal(chatsQueAvisar([chat({ estado: 'atendido' })], AHORA).length, 0)
  assert.equal(chatsQueAvisar([chat({ estado: 'venta' })], AHORA).length, 0)
})

test('NO repite el aviso antes de la ventana de repeticion', () => {
  const yaAvisado = chat({ ultimoAvisoTelegramAt: haceMin(5) })
  assert.equal(chatsQueAvisar([yaAvisado], AHORA).length, 0)
})

test('SI vuelve a insistir pasada la ventana — es un recordatorio, no un evento', () => {
  const viejo = chat({ ultimoAvisoTelegramAt: haceMin(31) })
  assert.equal(chatsQueAvisar([viejo], AHORA).length, 1)
})

test('fuera de horario no avisa de nada', () => {
  const madrugada = Date.parse('2026-08-11T06:00:00.000Z') // 01:00 Ecuador
  assert.equal(chatsQueAvisar([chat()], madrugada).length, 0)
})

test('sin ultimoEntranteAt no avisa: no se puede medir la espera', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: null })], AHORA).length, 0)
})

test('el mas viejo va primero', () => {
  const lista = [
    chat({ telefono: '1', ultimoEntranteAt: haceMin(20) }),
    chat({ telefono: '2', ultimoEntranteAt: haceMin(90) }),
  ]
  assert.equal(chatsQueAvisar(lista, AHORA)[0].telefono, '2')
})

test('el texto dice cuantos son y cuanto lleva esperando el peor', () => {
  const lista = chatsQueAvisar([
    chat({ telefono: '1', nombre: 'Ana',  ultimoEntranteAt: haceMin(20) }),
    chat({ telefono: '2', nombre: 'Bea',  ultimoEntranteAt: haceMin(90) }),
  ], AHORA)
  const t = textoAviso(lista, AHORA, 'https://inbox.test')
  assert.ok(t.includes('2'), 'debe decir cuantos son')
  assert.ok(t.includes('Bea'), 'debe nombrar al que mas espera')
  assert.ok(t.includes('1 h 30 min'), `debe decir la espera legible, salio: ${t}`)
  assert.ok(t.includes('https://inbox.test/inbox?tel=2'), 'debe traer el link al chat')
})

test('con un solo chat el texto va en singular', () => {
  const t = textoAviso(chatsQueAvisar([chat({ nombre: 'Ana' })], AHORA), AHORA, 'https://inbox.test')
  assert.ok(!t.includes('chats pendientes'), `no debe pluralizar, salio: ${t}`)
})

test('las constantes son las acordadas', () => {
  assert.equal(ESPERA_MINIMA_MS, 10 * MIN)
  assert.equal(REPETIR_CADA_MS, 30 * MIN)
})

test('el borde de la espera: exactamente 10 min YA avisa', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: haceMin(10) })], AHORA).length, 1)
})

test('el borde de la espera: un pelo menos de 10 min NO avisa', () => {
  const casi = new Date(AHORA - (10 * MIN - 1000)).toISOString()
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: casi })], AHORA).length, 0)
})

test('el borde de la repeticion: exactamente 30 min SI vuelve a insistir', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoAvisoTelegramAt: haceMin(30) })], AHORA).length, 1)
})

test('el borde de la repeticion: un pelo menos de 30 min todavia calla', () => {
  const casi = new Date(AHORA - (30 * MIN - 1000)).toISOString()
  assert.equal(chatsQueAvisar([chat({ ultimoAvisoTelegramAt: casi })], AHORA).length, 0)
})

test('el borde del horario: 20:00 Ecuador todavia es laboral', () => {
  assert.equal(enHorarioLaboral(Date.parse('2026-08-12T01:00:00.000Z')), true)
})

test('el borde del horario: 21:00 Ecuador ya NO', () => {
  assert.equal(enHorarioLaboral(Date.parse('2026-08-12T02:00:00.000Z')), false)
})

test('el nombre se escapa: un < en el nombre no rompe el mensaje', () => {
  const t = textoAviso(chatsQueAvisar([chat({ nombre: 'Ana <3 & Co' })], AHORA), AHORA, 'https://inbox.test')
  assert.ok(t.includes('Ana &lt;3 &amp; Co'), `el nombre tiene que ir escapado, salio: ${t}`)
  assert.ok(!t.includes('Ana <3'), 'no puede quedar el < crudo')
})

test('escaparHtml pone el & primero, sin doble escape', () => {
  assert.equal(escaparHtml('a & b < c'), 'a &amp; b &lt; c')
})

test('una espera NUEVA no la tapa el aviso viejo: contestaste y volvio a escribir', () => {
  // Aviso a las 10:00, ella escribe a las 10:02, ahora son las 10:12.
  // La marca tiene 12 min (< 30) pero es ANTERIOR al mensaje: toca avisar igual.
  const c = chat({
    ultimoAvisoTelegramAt: haceMin(12),
    ultimoEntranteAt:      haceMin(10),
  })
  assert.equal(chatsQueAvisar([c], AHORA).length, 1)
})

test('pero si el aviso es POSTERIOR al entrante, la ventana de 30 min manda', () => {
  // Mismo mensaje, ya avisado despues: es la misma espera, no repetir todavia.
  const c = chat({
    ultimoEntranteAt:      haceMin(40),
    ultimoAvisoTelegramAt: haceMin(5),
  })
  assert.equal(chatsQueAvisar([c], AHORA).length, 0)
})

test('el borde del techo: exactamente 24h todavia avisa', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: haceMin(24 * 60) })], AHORA).length, 1)
})

test('el borde del techo: un pelo mas de 24h ya NO avisa', () => {
  const viejo = new Date(AHORA - (24 * 60 * MIN + 1000)).toISOString()
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: viejo })], AHORA).length, 0)
})

test('un chat abandonado no se roba el aviso del reciente', () => {
  // El caso real del 12-ago: el de 45 dias tapaba al de 20 minutos.
  const lista = [
    chat({ telefono: '1', nombre: 'Vieja',   ultimoEntranteAt: new Date(AHORA - 45 * 24 * 60 * MIN).toISOString() }),
    chat({ telefono: '2', nombre: 'Reciente', ultimoEntranteAt: haceMin(20) }),
  ]
  const r = chatsQueAvisar(lista, AHORA)
  assert.equal(r.length, 1, 'solo entra el reciente')
  assert.equal(r[0].telefono, '2')
  assert.ok(textoAviso(r, AHORA, 'https://inbox.test').includes('Reciente'))
})

test('la constante del techo es de 24 horas', () => {
  assert.equal(ESPERA_MAXIMA_MS, 24 * 60 * 60 * 1000)
})

test('el texto plural dice "esperando respuesta hoy", no un total de pendientes', () => {
  const lista = chatsQueAvisar([
    chat({ telefono: '1', nombre: 'Ana', ultimoEntranteAt: haceMin(20) }),
    chat({ telefono: '2', nombre: 'Bea', ultimoEntranteAt: haceMin(90) }),
  ], AHORA)
  const t = textoAviso(lista, AHORA, 'https://inbox.test')
  assert.ok(t.includes('esperando respuesta hoy'), `debe decir la frase nueva, salio: ${t}`)
  assert.ok(!t.includes('chats pendientes'), `no debe decir el total de pendientes, salio: ${t}`)
})
