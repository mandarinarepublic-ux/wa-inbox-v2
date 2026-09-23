// Disparador "Botón tocado" (22-sep-2026): el vendedor manda una respuesta rápida
// con botones (p. ej. "¿Cómo prefieres pagar?" → Pichincha · Guayaquil · Produbanco)
// y cada toque se contesta solo con el flujo cuyo Disparador tiene ese título.
import test from 'node:test'
import assert from 'node:assert'
import { validarFlujo, choquesDeDisparador, elegirFlujo, elegirFlujoPorBoton, tituloBotonTocado, decidirEntranteEnFlujo } from '../lib/flujo.js'
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

// ── Un flujo que termina en botones SIN conectar no se traga el toque ─────────
// Caso real (22-sep-2026): el flujo de Dragon Ball termina mandando "¿Cómo
// prefieres pagar?" con [Deuna] [Transferencia] [Tarjeta]. Ese nodo guarda el
// estado "esperando botón"; si el toque se decidía como `seguir` por un puerto
// sin línea, el flujo en curso terminaba sin mandar nada y ya no corría el
// flujo del botón (Deuna…): el cliente tocaba y no pasaba nada.
const terminaEnPago = {
  flujo_id: 'dbz', nombre: 'DBZ', publicado: true,
  grafo_vivo: {
    nodos: [D({ tipo: 'boton', boton: 'Naranja con Azul' }),
      { id: 'pago', tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: '¿Cómo prefieres pagar?', adjuntos: [], botones: [{ title: 'Deuna' }, { title: 'Transferencia' }, { title: 'Tarjeta de crédito' }] } }],
    lineas: [{ id: 'l1', de: 'd', puerto: 'siguiente', a: 'pago' }],
  },
}
const ahora = new Date('2026-09-22T20:00:00Z')
const esperandoPago = { flujo_id: 'dbz', nodo_id: 'pago', esperando: 'boton', vence_at: '2026-09-23T19:00:00Z' }

test('decidirEntranteEnFlujo: botón tocado cuyo puerto no tiene línea → borrar (el toque sigue su camino)', () => {
  const d = decidirEntranteEnFlujo({ estado: esperandoPago, flujo: terminaEnPago, entrante: { botonId: 'rc_1', texto: 'Deuna' }, ahora })
  assert.equal(d.accion, 'borrar')
})
test('decidirEntranteEnFlujo: texto libre con "otra" sin línea → borrar', () => {
  const d = decidirEntranteEnFlujo({ estado: esperandoPago, flujo: terminaEnPago, entrante: { botonId: '', texto: '¿cuánto es el envío?' }, ahora })
  assert.equal(d.accion, 'borrar')
})
test('decidirEntranteEnFlujo: esperando respuesta sin línea de salida → borrar', () => {
  const flujo = { ...terminaEnPago, grafo_vivo: { nodos: [D({ tipo: 'boton', boton: 'X' }), { id: 'talla', tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: '¿Qué talla?', adjuntos: [], botones: [], esperarRespuesta: true } }], lineas: [{ id: 'l1', de: 'd', puerto: 'siguiente', a: 'talla' }] } }
  const d = decidirEntranteEnFlujo({ estado: { ...esperandoPago, nodo_id: 'talla', esperando: 'respuesta' }, flujo, entrante: { botonId: '', texto: 'M' }, ahora })
  assert.equal(d.accion, 'borrar')
})
test('decidirEntranteEnFlujo: botón tocado con su línea conectada → seguir, como siempre', () => {
  const flujo = { ...terminaEnPago, grafo_vivo: { ...terminaEnPago.grafo_vivo, nodos: [...terminaEnPago.grafo_vivo.nodos, F], lineas: [...terminaEnPago.grafo_vivo.lineas, { id: 'l2', de: 'pago', puerto: 'btn_2', a: 'f' }] } }
  assert.deepEqual(decidirEntranteEnFlujo({ estado: esperandoPago, flujo, entrante: { botonId: 'rc_2', texto: 'Transferencia' }, ahora }), { accion: 'seguir', desde: { nodoId: 'pago', puerto: 'btn_2' } })
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
