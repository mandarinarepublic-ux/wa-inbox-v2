// El puente entre el grafo (la fuente de la verdad, lib/flujo.js) y lo que React
// Flow dibuja. Es la única pieza del lienzo que se puede probar sin navegador, y
// la que más duele si se rompe: si la ida y vuelta pierde algo —el puerto de una
// línea, la espera, la posición de una tarjeta— el vendedor guarda un flujo que
// NO es el que dibujó, y no hay forma de darse cuenta mirando la pantalla.
import test from 'node:test'
import assert from 'node:assert'
import { aReactFlow, deReactFlow } from '../components/flujos/grafo-reactflow.js'
import { nuevoGrafo } from '../lib/flujo.js'
test('ida y vuelta conserva nodos, datos, posiciones y líneas con su puerto y espera', () => {
  const g = nuevoGrafo()
  g.nodos.push({ id: 'm', tipo: 'mensaje', pos: { x: 10, y: 20 }, datos: { origen: 'texto', texto: 'hola', adjuntos: [], botones: [{ title: 'Sí' }], esperarRespuesta: false, citarUltimaRespuesta: true, temperatura: 'tibio' } })
  g.lineas = [{ id: 'l1', de: g.nodos[0].id, puerto: 'siguiente', a: 'm', esperaMin: 0 }, { id: 'l2', de: 'm', puerto: 'btn_1', a: g.nodos[1].id, esperaMin: 90 }]
  const { nodes, edges } = aReactFlow(g)
  assert.equal(nodes.find(n => n.id === 'm').type, 'mensaje')
  assert.equal(edges.find(e => e.id === 'l2').sourceHandle, 'btn_1')
  assert.deepEqual(deReactFlow(nodes, edges), g)
})
