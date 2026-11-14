import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excluidoDeGuias } from '../lib/guias-servientrega.js'

test('Klever Cevallos queda excluido por nombre, en cualquier orden y sin importar tildes', () => {
  for (const nombre of ['KLEVER CEVALLOS', 'CEVALLOS ALMEIDA KLEVER GABRIEL', 'klever cevallos']) {
    assert.equal(excluidoDeGuias({ nombre }), 'Klever Cevallos', nombre)
  }
})

test('y por cualquiera de sus dos celulares, con o sin 593', () => {
  assert.equal(excluidoDeGuias({ celulares: ['0958848374'] }), 'Klever Cevallos')
  assert.equal(excluidoDeGuias({ celulares: ['593958846374'] }), 'Klever Cevallos')
})

test('otros clientes NO quedan excluidos (ni un Klever o un Cevallos suelto)', () => {
  assert.equal(excluidoDeGuias({ nombre: 'KLEVER MORALES', celulares: ['0991234567'] }), '')
  assert.equal(excluidoDeGuias({ nombre: 'MARIA CEVALLOS' }), '')
  assert.equal(excluidoDeGuias({}), '')
})
