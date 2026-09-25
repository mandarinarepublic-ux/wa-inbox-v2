import test from 'node:test'
import assert from 'node:assert'
import { agregarOptimista, reconciliarPendientes, claveOptimista, partirClave } from '../lib/optimista.js'

const MANDI = '1024077200794372'
const REP = '1367772133078101'
const TEL = '593987498489'
const fila = (phoneId, msgs = []) => ({ telefono: TEL, phoneId, msgs, last: msgs[msgs.length - 1] || null })
const tmp = (texto, ts = Date.now()) => ({ id: 'tmp_' + ts, telefono: TEL, mensaje: texto, direccion: 'SALIENTE' })

test('GENERAL: contestar por REPUBLIC pinta la burbuja SOLO en la fila de REPUBLIC', () => {
  const convs = [fila(MANDI), fila(REP)]
  const out = agregarOptimista(convs, TEL, REP, tmp('hola'))
  assert.equal(out.find((c) => c.phoneId === REP).msgs.length, 1)
  assert.equal(out.find((c) => c.phoneId === MANDI).msgs.length, 0)
})

test('pestaña de un número (filas sin phoneId) sigue funcionando', () => {
  const out = agregarOptimista([{ telefono: TEL, msgs: [] }], TEL, REP, tmp('hola'))
  assert.equal(out[0].msgs.length, 1)
})

test('la confirmación se busca en la fila del MISMO número y ahí se descarta', () => {
  const t = tmp('hola')
  const pend = { [claveOptimista(TEL, REP)]: [t] }
  const confirmado = { id: 'x', direccion: 'SALIENTE', mensaje: 'hola' }
  const data = [fila(MANDI, [{ id: 'm', direccion: 'ENTRANTE', mensaje: 'hi' }]), fila(REP, [confirmado])]
  reconciliarPendientes(data, pend)
  assert.deepEqual(pend, {})
  assert.equal(data.find((c) => c.phoneId === MANDI).msgs.length, 1)   // MANDI intacta
})

test('sin confirmar, la burbuja se cuelga de su fila y no de la otra', () => {
  const pend = { [claveOptimista(TEL, REP)]: [tmp('hola')] }
  const data = [fila(MANDI), fila(REP)]
  reconciliarPendientes(data, pend)
  assert.equal(data.find((c) => c.phoneId === REP).msgs.length, 1)
  assert.equal(data.find((c) => c.phoneId === MANDI).msgs.length, 0)
})

test('a los 90 s se suelta aunque no llegue la confirmación', () => {
  const ahora = Date.now()
  const pend = { [claveOptimista(TEL, REP)]: [tmp('hola', ahora - 91000)] }
  reconciliarPendientes([fila(REP)], pend, ahora)
  assert.deepEqual(pend, {})
})

test('la clave se parte bien aunque no traiga canal', () => {
  assert.deepEqual(partirClave(claveOptimista(TEL, REP)), { telefono: TEL, canal: REP })
  assert.deepEqual(partirClave(claveOptimista(TEL)), { telefono: TEL, canal: '' })
})
