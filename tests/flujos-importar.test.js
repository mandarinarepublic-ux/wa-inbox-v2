import test from 'node:test'
import assert from 'node:assert'
import { planDeImportacion } from '../lib/flujos.js'

const config = { recetas: { activo: true, lista: [{ id: 'r_1', nombre: 'DBZ', activa: true, pasos: [], pregunta: null }, { id: 'r_2', nombre: 'Off', activa: false, pasos: [], pregunta: null }], por_anuncio: { '111': 'r_1', '222': 'r_1', organico: 'r_2' } } }

test('planDeImportacion: junta los anuncios por receta, marca orgánico y publicado', () => {
  const plan = planDeImportacion(config, [])
  const p1 = plan.find(p => p.receta.id === 'r_1'); assert.deepEqual(p1.sourceIds, ['111', '222']); assert.equal(p1.organico, false); assert.equal(p1.publicado, true); assert.equal(p1.yaExiste, false)
  const p2 = plan.find(p => p.receta.id === 'r_2'); assert.equal(p2.organico, true); assert.equal(p2.publicado, false)
})
test('planDeImportacion: una receta ya importada se marca yaExiste (idempotente)', () => {
  const plan = planDeImportacion(config, [{ nombre: '[receta] DBZ' }])
  assert.equal(plan.find(p => p.receta.id === 'r_1').yaExiste, true)
})
test('planDeImportacion: con recetas.activo=false nada queda publicado', () => {
  const plan = planDeImportacion({ recetas: { ...config.recetas, activo: false } }, [])
  assert.ok(plan.every(p => p.publicado === false))
})
