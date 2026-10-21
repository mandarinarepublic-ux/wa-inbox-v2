import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claveMes, nombreMes, tramosPorMes } from '../lib/meses-chat.js'

const fecha = (m) => new Date(m.t)
const ahora = new Date(2026, 9, 20)   // 20-oct-2026

test('claveMes y nombreMes', () => {
  assert.equal(claveMes(new Date(2026, 8, 3)), '2026-09')
  assert.equal(claveMes(new Date('basura')), '')
  assert.equal(nombreMes('2026-09'), 'septiembre 2026')
  assert.equal(nombreMes(''), 'sin fecha')
})

test('parte por mes; solo el mes en curso queda abierto', () => {
  const msgs = [
    { id: 1, t: new Date(2026, 7, 5) }, { id: 2, t: new Date(2026, 7, 30) },
    { id: 3, t: new Date(2026, 8, 1) },
    { id: 4, t: new Date(2026, 9, 2) }, { id: 5, t: new Date(2026, 9, 20) },
  ]
  const t = tramosPorMes(msgs, fecha, ahora)
  assert.deepEqual(t.map(x => [x.clave, x.msgs.length, x.siempreAbierto]),
    [['2026-08', 2, false], ['2026-09', 1, false], ['2026-10', 2, true]])
})

test('sin mensajes este mes, el último mes con mensajes va abierto (el chat no se abre vacío)', () => {
  const msgs = [{ id: 1, t: new Date(2026, 6, 1) }, { id: 2, t: new Date(2026, 8, 9) }]
  const t = tramosPorMes(msgs, fecha, ahora)
  assert.deepEqual(t.map(x => x.siempreAbierto), [false, true])
})

test('un mensaje sin fecha no se pierde: va con el anterior', () => {
  const msgs = [{ id: 1, t: new Date(2026, 8, 1) }, { id: 2, t: 'basura' }, { id: 3, t: new Date(2026, 9, 1) }]
  const t = tramosPorMes(msgs, fecha, ahora)
  assert.deepEqual(t.map(x => x.msgs.map(m => m.id)), [[1, 2], [3]])
  assert.equal(tramosPorMes([], fecha, ahora).length, 0)
})
