// Plantillas nuevas desde el inbox (24-sep-2026). REPUBLIC tenía CERO: lo que se
// valida acá es lo que Meta rechaza con errores confusos, para frenarlo antes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarPlantilla, normalizarNombre, variablesDe } from '../lib/plantilla-nueva.js'

test('el nombre queda como Meta lo acepta', () => {
  assert.equal(normalizarNombre('Seguimiento Pedido!'), 'seguimiento_pedido')
  assert.equal(normalizarNombre('  Confirmación de envío  '), 'confirmacion_de_envio')
})

test('variables sin repetir y en orden', () => {
  assert.deepEqual(variablesDe('Hola {{1}}, tu {{2}} y {{ 1 }}'), [1, 2])
})

test('plantilla simple arma el payload de Meta', () => {
  const r = armarPlantilla({ nombre: 'Hola Cliente', categoria: 'utility', idioma: 'es', cuerpo: 'Hola, retomamos tu consulta.', pie: 'Mandarina Republic' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.payload, {
    name: 'hola_cliente', category: 'UTILITY', language: 'es',
    components: [{ type: 'BODY', text: 'Hola, retomamos tu consulta.' }, { type: 'FOOTER', text: 'Mandarina Republic' }],
  })
})

test('con variables lleva un ejemplo por cada una', () => {
  const r = armarPlantilla({ nombre: 'x', categoria: 'MARKETING', cuerpo: 'Hola {{1}}, tu pedido {{2}} está listo.', ejemplos: ['Ana', '#123'] })
  assert.equal(r.ok, true)
  assert.deepEqual(r.payload.components[0].example, { body_text: [['Ana', '#123']] })
})

test('frena lo que Meta rechaza', () => {
  const casos = [
    { cuerpo: 'Hola {{1}} y {{3}} ok.', ejemplos: ['a', 'b'] },   // salta el 2
    { cuerpo: '{{1}} hola ok', ejemplos: ['a'] },                 // empieza en variable
    { cuerpo: 'hola {{1}}.', ejemplos: ['a'] },                   // termina en variable
    { cuerpo: 'hola {{1}} ok', ejemplos: [] },                    // sin ejemplo
    { cuerpo: '' },                                               // vacío
  ]
  for (const c of casos) {
    const r = armarPlantilla({ nombre: 'n', categoria: 'UTILITY', ...c })
    assert.equal(r.ok, false, JSON.stringify(c))
  }
  assert.equal(armarPlantilla({ nombre: 'n', categoria: 'AUTHENTICATION', cuerpo: 'hola' }).ok, false)
})
