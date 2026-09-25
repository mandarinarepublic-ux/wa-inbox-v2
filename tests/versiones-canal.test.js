import test from 'node:test'
import assert from 'node:assert'
import { setCanalActivo, versionesGuardadas, _recordarVersion, getCanalActivo } from '../lib/api-client.js'

test('abrir un chat (sin olvidar) conserva las versiones: el próximo ciclo puede ser 304', () => {
  _recordarVersion('todos', 'v1')
  setCanalActivo('REPUBLIC', false)
  assert.equal(versionesGuardadas(), 1)
  assert.equal(getCanalActivo(), '1367772133078101')
})

test('cambiar de bandeja SÍ las olvida (si no, un 304 dejaría la pantalla vacía en blanco)', () => {
  _recordarVersion('todos', 'v1')
  setCanalActivo('MANDI')
  assert.equal(versionesGuardadas(), 0)
})
