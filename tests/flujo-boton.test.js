// Disparador "Botón tocado" (22-sep-2026): el vendedor manda una respuesta rápida
// con botones (p. ej. "¿Cómo prefieres pagar?" → Pichincha · Guayaquil · Produbanco)
// y cada toque se contesta solo con el flujo cuyo Disparador tiene ese título.
import test from 'node:test'
import assert from 'node:assert'
import { validarFlujo, choquesDeDisparador, elegirFlujo, elegirFlujoPorBoton, tituloBotonTocado } from '../lib/flujo.js'
import { MAX_TITULO } from '../lib/recetas.js'

const D = (datos) => ({ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos })
const M = { id: 'm', tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'Banco Pichincha…', adjuntos: [], botones: [] } }
const F = { id: 'f', tipo: 'fin', pos: { x: 0, y: 0 }, datos: {} }
const grafoBoton = (boton) => ({
  nodos: [D({ tipo: 'boton', boton }), M, F],
  lineas: [{ id: 'l1', de: 'd', puerto: 'siguiente', a: 'm' }, { id: 'l2', de: 'm', puerto: 'siguiente', a: 'f' }],
})
const flujo = (flujo_id, boton, publicado = true) => ({ flujo_id, nombre: flujo_id, publicado, grafo_vivo: grafoBoton(boton) })

// ── El título del botón que el cliente TOCÓ, desde el crudo de Meta ──────────
test('tituloBotonTocado: botón de un mensaje interactivo (respuesta rápida o flujo)', () => {
  const raw = { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'btn_1', title: 'Banco Pichincha' } } }
  assert.equal(tituloBotonTocado(raw), 'Banco Pichincha')
})
test('tituloBotonTocado: botón de respuesta rápida de una PLANTILLA', () => {
  assert.equal(tituloBotonTocado({ type: 'button', button: { text: 'Sí, la quiero', payload: 'Sí, la quiero' } }), 'Sí, la quiero')
})
test('tituloBotonTocado: un texto ESCRITO no es un botón tocado, aunque diga lo mismo', () => {
  assert.equal(tituloBotonTocado({ type: 'text', text: { body: 'Banco Pichincha' } }), '')
})
test('tituloBotonTocado: sin crudo, foto o crudo raro → vacío, sin reventar', () => {
  assert.equal(tituloBotonTocado(undefined), '')
  assert.equal(tituloBotonTocado(null), '')
  assert.equal(tituloBotonTocado({ type: 'image', image: { id: 'x' } }), '')
  assert.equal(tituloBotonTocado({ type: 'interactive', interactive: null }), '')
})

// ── A qué flujo le toca el toque ──────────────────────────────────────────────
test('elegirFlujoPorBoton: título exacto, sin importar mayúsculas, tildes ni espacios', () => {
  const flujos = [flujo('pichincha', 'Banco Pichincha'), flujo('guayaquil', 'Banco Guayaquil')]
  assert.equal(elegirFlujoPorBoton({ flujos, titulo: 'Banco Pichincha' })?.flujo_id, 'pichincha')
  assert.equal(elegirFlujoPorBoton({ flujos, titulo: '  banco   GUAYAQUIL ' })?.flujo_id, 'guayaquil')
})
test('elegirFlujoPorBoton: contener el título no alcanza (no es palabra clave)', () => {
  const flujos = [flujo('pichincha', 'Pichincha')]
  assert.equal(elegirFlujoPorBoton({ flujos, titulo: 'Banco Pichincha' }), null)
})
test('elegirFlujoPorBoton: título vacío o sin flujos → null', () => {
  assert.equal(elegirFlujoPorBoton({ flujos: [flujo('p', 'Banco Pichincha')], titulo: '' }), null)
  assert.equal(elegirFlujoPorBoton({ flujos: undefined, titulo: 'Banco Pichincha' }), null)
})
test('elegirFlujoPorBoton: un borrador (sin publicar) nunca corre', () => {
  assert.equal(elegirFlujoPorBoton({ flujos: [flujo('p', 'Banco Pichincha', false)], titulo: 'Banco Pichincha' }), null)
})
test('elegirFlujoPorBoton: ignora los flujos de palabra, anuncio y orgánico', () => {
  const palabra = { flujo_id: 'w', publicado: true, grafo_vivo: { ...grafoBoton(''), nodos: [D({ tipo: 'palabra', palabras: ['banco pichincha'] }), M, F] } }
  assert.equal(elegirFlujoPorBoton({ flujos: [palabra], titulo: 'Banco Pichincha' }), null)
})
test('elegirFlujo: un flujo de botón NUNCA sale por palabra ni por orgánico', () => {
  const flujos = [flujo('p', 'Banco Pichincha')]
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: true, texto: 'banco pichincha' }), null)
})

// ── Validación y choques ──────────────────────────────────────────────────────
test('validarFlujo: Disparador de botón con título → válido', () => {
  assert.deepEqual(validarFlujo(grafoBoton('Banco Pichincha')), [])
})
test('validarFlujo: Disparador de botón sin título (o solo espacios) es un error', () => {
  assert.ok(validarFlujo(grafoBoton('')).some((e) => e.nodoId === 'd'))
  assert.ok(validarFlujo(grafoBoton('   ')).some((e) => e.nodoId === 'd'))
  assert.ok(validarFlujo(grafoBoton(undefined)).some((e) => e.nodoId === 'd'))
})
test(`validarFlujo: un título de más de ${MAX_TITULO} letras nunca podría ser un botón de WhatsApp`, () => {
  assert.ok(validarFlujo(grafoBoton('x'.repeat(MAX_TITULO + 1))).some((e) => e.nodoId === 'd'))
})
test('choquesDeDisparador: dos flujos publicados con el mismo botón chocan', () => {
  const choques = choquesDeDisparador(grafoBoton('banco pichincha'), [flujo('otro', 'Banco Pichincha')])
  assert.equal(choques.length, 1)
  assert.equal(choques[0].motivo, 'mismo botón')
  assert.deepEqual(choquesDeDisparador(grafoBoton('Produbanco'), [flujo('otro', 'Banco Pichincha')]), [])
})
