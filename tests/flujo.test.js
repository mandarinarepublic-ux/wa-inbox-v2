import test from 'node:test'
import assert from 'node:assert'
import { normalizarTexto, puertosDe, validarFlujo, choquesDeDisparador, elegirFlujo, caminoLineal, piezasDeNodos, temperaturaAlPasar, recetaAFlujo, nuevoGrafo } from '../lib/flujo.js'

const D = (datos) => ({ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos })
const M = (id, datos) => ({ id, tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'hola ' + id, adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '', ...datos } })
const F = { id: 'f', tipo: 'fin', pos: { x: 0, y: 0 }, datos: {} }
const L = (de, a, puerto = 'siguiente', esperaMin = 0) => ({ id: `${de}-${puerto}-${a}`, de, puerto, a, esperaMin })
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372' }
const respuestas = [{ id: 'r1', text: 'Saludo', botones: [], adjuntos: [{ tipo: 'imagen', url: 'https://x/1.jpg', nombre: '' }] }]

const lineal = { nodos: [D({ tipo: 'anuncio', sourceIds: ['111'], palabras: [] }), M('m1', { origen: 'respuesta', respuestaId: 'r1' }), M('m2', { temperatura: 'caliente' }), F], lineas: [L('d', 'm1'), L('m1', 'm2'), L('m2', 'f')] }

test('normalizarTexto: minúsculas, sin acentos, espacios simples', () => {
  assert.equal(normalizarTexto('  Hóla   CHAQUETA dragón '), 'hola chaqueta dragon')
})
test('puertosDe: mensaje simple, con botones, esperando, condición', () => {
  assert.deepEqual(puertosDe(M('a', {})), ['siguiente'])
  assert.deepEqual(puertosDe(M('a', { botones: [{ title: 'Sí' }, { title: 'No' }] })), ['btn_1', 'btn_2', 'otra'])
  assert.deepEqual(puertosDe(M('a', { esperarRespuesta: true })), ['respuesta'])
  assert.deepEqual(puertosDe({ id: 'c', tipo: 'condicion', datos: { campo: 'temperatura', valor: 'caliente' } }), ['si', 'no'])
})
test('validarFlujo: válido → []', () => { assert.deepEqual(validarFlujo(lineal, { respuestas }), []) })
test('validarFlujo: sin disparador / dos disparadores / nodo inalcanzable / respuesta borrada / botones de más / espera > 23h / ciclo sin espera', () => {
  assert.ok(validarFlujo({ nodos: [F], lineas: [] }).length >= 1)
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), { ...D({ tipo: 'organico' }), id: 'd2' }, F], lineas: [] }).some(e => /disparador/i.test(e.texto)))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('solo', {}), F], lineas: [L('d', 'f')] }).some(e => e.nodoId === 'solo'))
  assert.ok(validarFlujo({ ...lineal }, { respuestas: [] }).some(e => e.nodoId === 'm1'))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('b', { botones: [{ title: '1' }, { title: '2' }, { title: '3' }, { title: '4' }] }), F], lineas: [L('d', 'b'), L('b', 'f', 'btn_1')] }).some(e => e.nodoId === 'b'))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('a', {}), F], lineas: [L('d', 'a'), L('a', 'f', 'siguiente', 24 * 60)] }).some(e => e.lineaId))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {})], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'a')] }).some(e => /ciclo/i.test(e.texto)))
})
test('choquesDeDisparador: mismo anuncio, misma palabra u orgánico repetido en otro publicado', () => {
  const otro = { flujo_id: 'x', nombre: 'Otro', publicado: true, grafo_vivo: lineal }
  assert.equal(choquesDeDisparador(lineal, [otro]).length, 1)
  assert.equal(choquesDeDisparador({ ...lineal, nodos: [D({ tipo: 'anuncio', sourceIds: ['999'], palabras: [] }), ...lineal.nodos.slice(1)] }, [otro]).length, 0)
})
test('elegirFlujo: anuncio > palabra > orgánico; solo publicados con grafo_vivo', () => {
  const fA = { flujo_id: 'a', publicado: true, grafo_vivo: lineal }
  const fP = { flujo_id: 'p', publicado: true, grafo_vivo: { ...lineal, nodos: [D({ tipo: 'palabra', palabras: ['Chaqueta'] }), ...lineal.nodos.slice(1)] } }
  const fO = { flujo_id: 'o', publicado: true, grafo_vivo: { ...lineal, nodos: [D({ tipo: 'organico' }), ...lineal.nodos.slice(1)] } }
  const fB = { flujo_id: 'b', publicado: false, grafo_vivo: lineal }
  const flujos = [fB, fO, fP, fA]
  assert.equal(elegirFlujo({ flujos, sourceId: '111', esNuevo: true, texto: 'quiero la chaqueta' })?.flujo_id, 'a')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: false, texto: 'la CHAQUETA dragón' })?.flujo_id, 'p')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: true, texto: 'hola' })?.flujo_id, 'o')
  assert.equal(elegirFlujo({ flujos, sourceId: '', esNuevo: false, texto: 'hola' }), null)
  assert.equal(elegirFlujo({ flujos: [fB], sourceId: '111', esNuevo: true, texto: '' }), null)
})
test('caminoLineal: recorre hasta Fin', () => {
  const c = caminoLineal(lineal)
  assert.deepEqual(c.mensajes.map(n => n.id), ['m1', 'm2']); assert.equal(c.motivo, 'fin')
})
test('caminoLineal: se detiene en botones / espera en la línea / esperar respuesta / condición', () => {
  const conBotones = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', { botones: [{ title: 'Sí' }] }), M('c', {}), F], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'c', 'btn_1'), L('c', 'f')] }
  let c = caminoLineal(conBotones); assert.deepEqual(c.mensajes.map(n => n.id), ['a', 'b']); assert.equal(c.motivo, 'botones'); assert.equal(c.detenidoEn, 'b')
  const conEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 60), L('b', 'f')] }
  c = caminoLineal(conEspera); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'espera')
  const esperando = { nodos: [D({ tipo: 'organico' }), M('a', { esperarRespuesta: true }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'respuesta'), L('b', 'f')] }
  c = caminoLineal(esperando); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'esperar_respuesta')
  const conCond = { nodos: [D({ tipo: 'organico' }), M('a', {}), { id: 'c', tipo: 'condicion', pos: { x: 0, y: 0 }, datos: { campo: 'temperatura', valor: 'caliente' } }, F], lineas: [L('d', 'a'), L('a', 'c'), L('c', 'f', 'si')] }
  c = caminoLineal(conCond); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'condicion')
})
test('piezasDeNodos: respuesta rápida con adjuntos + texto con botones; la 1.ª cita; tope', () => {
  const nodos = [M('m1', { origen: 'respuesta', respuestaId: 'r1' }), M('m2', { origen: 'texto', texto: '¿Cuál?', botones: [{ title: '1' }, { title: '2' }] })]
  const p = piezasDeNodos({ nodos, respuestas, contacto, citaId: 'wamid.X' })
  assert.deepEqual(p.map(x => x.Mensaje || x.ImagenURL || x.Cuerpo), ['Saludo', 'https://x/1.jpg', '¿Cuál?'])
  assert.equal(p[0].ContextoId, 'wamid.X'); assert.ok(!p[1].ContextoId)
  assert.equal(p[2].TipoMensaje, 'interactive_buttons')
  assert.ok(p.every(x => x.Canal === contacto.phoneId))
})
test('piezasDeNodos: respuesta borrada se salta; texto vacío no sale; adjuntos por url en un nodo texto', () => {
  const nodos = [M('x', { origen: 'respuesta', respuestaId: 'no' }), M('y', { origen: 'texto', texto: '', adjuntos: [{ tipo: 'audio', url: 'https://x/v.ogg', nombre: '' }] })]
  const p = piezasDeNodos({ nodos, respuestas, contacto })
  assert.deepEqual(p.map(x => x.AudioURL), ['https://x/v.ogg'])
})
test('temperaturaAlPasar: la última no vacía', () => {
  assert.equal(temperaturaAlPasar([M('a', { temperatura: 'tibio' }), M('b', {}), M('c', { temperatura: 'caliente' })]), 'caliente')
  assert.equal(temperaturaAlPasar([M('a', {})]), '')
})
test('recetaAFlujo: disparador con los anuncios, un mensaje por paso, la pregunta con botones, fin; válido', () => {
  const receta = { id: 'r_1', nombre: 'DBZ', activa: true, pasos: [{ tipo: 'respuesta', respuestaId: 'r1' }], pregunta: { texto: '¿Cuál?', botones: [{ title: '1' }] } }
  const f = recetaAFlujo(receta, { sourceIds: ['111', '222'], publicado: true })
  assert.equal(f.nombre, 'DBZ'); assert.equal(f.publicado, true)
  assert.deepEqual(validarFlujo(f.grafo, { respuestas }), [])
  const c = caminoLineal(f.grafo); assert.equal(c.mensajes.length, 2); assert.equal(c.motivo, 'botones')
  assert.deepEqual(f.grafo.nodos[0].datos.sourceIds, ['111', '222'])
  const o = recetaAFlujo({ ...receta, pregunta: null }, { organico: true }); assert.equal(o.grafo.nodos[0].datos.tipo, 'organico'); assert.equal(caminoLineal(o.grafo).motivo, 'fin')
})
test('nuevoGrafo: un disparador orgánico y un fin, válido', () => {
  assert.deepEqual(validarFlujo(nuevoGrafo()), [])
})
