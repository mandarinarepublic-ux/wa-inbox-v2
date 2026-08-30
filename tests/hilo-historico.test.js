// Traer más historial al subir en un chat, como WhatsApp Web.
//
// El hilo carga los últimos 800 mensajes y hasta hoy no había forma de pedir
// más: los anteriores quedaban en la base sin que nadie los mirara. Rodrigo lo
// notó en su propio chat de MANDI —1.793 mensajes— donde el inbox mostraba
// desde finales de julio y su primer mensaje era de mayo.
//
// ☠️ EL RIESGO DE UNIR TRAMOS. Al pedir "los 800 anteriores a esta fecha" hay
// que decidir qué pasa en el BORDE. Dos mensajes pueden compartir el mismo
// segundo (WhatsApp da la hora al segundo, y una persona manda tres seguidos):
//
//   · si se pide "estrictamente ANTERIOR a la fecha", los que empatan en ese
//     segundo se PIERDEN, y nadie se entera nunca;
//   · si se pide "anterior O IGUAL", algunos vienen dos veces.
//
// Se elige repetir y deduplicar acá. Un duplicado es invisible; un hueco es un
// mensaje de un cliente que desaparece — la familia de bugs más cara de este
// inbox.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fusionarHilo } from '../lib/hilo-historico.js'

const m = (id, ts) => ({ id, timestamp: ts, mensaje: 'x' })

test('los viejos van ANTES que los que ya estaban', () => {
  const r = fusionarHilo([m('a', '2026-05-01T10:00:00Z')], [m('b', '2026-07-01T10:00:00Z')])
  assert.deepEqual(r.map(x => x.id), ['a', 'b'])
})

test('☠️ un mensaje que viene en los DOS tramos aparece UNA vez', () => {
  // El solapamiento del borde: se pide "anterior o igual", así que el que está
  // justo en la frontera vuelve a venir.
  const borde = m('borde', '2026-07-01T10:00:00Z')
  const r = fusionarHilo([m('a', '2026-05-01T10:00:00Z'), borde], [borde, m('b', '2026-07-02T10:00:00Z')])
  assert.deepEqual(r.map(x => x.id), ['a', 'borde', 'b'])
})

test('queda en orden cronológico aunque el tramo venga desordenado', () => {
  const r = fusionarHilo(
    [m('c', '2026-06-03T10:00:00Z'), m('a', '2026-06-01T10:00:00Z')],
    [m('d', '2026-07-01T10:00:00Z')],
  )
  assert.deepEqual(r.map(x => x.id), ['a', 'c', 'd'])
})

test('varios mensajes en el MISMO segundo se conservan todos', () => {
  // Tres seguidos del mismo cliente. Ninguno se puede caer por empatar la hora.
  const r = fusionarHilo(
    [m('x1', '2026-06-01T10:00:00Z'), m('x2', '2026-06-01T10:00:00Z'), m('x3', '2026-06-01T10:00:00Z')],
    [m('b', '2026-07-01T10:00:00Z')],
  )
  assert.equal(r.length, 4)
})

test('sin nada nuevo que traer, el hilo queda igual', () => {
  const actual = [m('b', '2026-07-01T10:00:00Z')]
  assert.deepEqual(fusionarHilo([], actual).map(x => x.id), ['b'])
  assert.deepEqual(fusionarHilo(null, actual).map(x => x.id), ['b'])
})

test('nunca devuelve menos de lo que ya había', () => {
  // La garantía que importa: traer historial JAMÁS puede hacer desaparecer un
  // mensaje que ya estaba en pantalla.
  const actual = [m('a', '2026-07-01T10:00:00Z'), m('b', '2026-07-02T10:00:00Z')]
  const r = fusionarHilo([m('z', '2026-05-01T10:00:00Z')], actual)
  for (const prev of actual) assert.ok(r.some(x => x.id === prev.id), `se perdió ${prev.id}`)
})

test('un mensaje sin id no tumba la unión', () => {
  // Las burbujas optimistas y algún tipo raro pueden no traer id.
  const r = fusionarHilo([{ timestamp: '2026-06-01T10:00:00Z', mensaje: 'sin id' }],
                         [m('b', '2026-07-01T10:00:00Z')])
  assert.equal(r.length, 2)
})
