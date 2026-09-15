import test from 'node:test'
import assert from 'node:assert'
import { normalizarTexto, nodoDisparador, puertosDe, validarFlujo, choquesDeDisparador, elegirFlujo, caminoLineal, piezasDeNodos, temperaturaAlPasar, recetaAFlujo, nuevoGrafo, avanzarDesde, evaluarCondicion, puertoDeEntrante, paradaDeCamino, citaDeTanda, ventanaAbierta, horaEcuador, decidirEntranteEnFlujo, decidirVencido } from '../lib/flujo.js'
import { MAX_PIEZAS } from '../lib/recetas.js'

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
test('validarFlujo: una palabra vacía (o solo espacios) es un error, no "ninguna palabra"', () => {
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'palabra', palabras: [''] }), F], lineas: [L('d', 'f')] }).some(e => /palabra/i.test(e.texto)))
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'palabra', palabras: ['   '] }), F], lineas: [L('d', 'f')] }).some(e => /palabra/i.test(e.texto)))
})
test('validarFlujo: un ciclo que pasa por una línea con espera de verdad es válido', () => {
  const conCicloEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {})], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'a', 'siguiente', 60)] }
  assert.deepEqual(validarFlujo(conCicloEspera), [])
})
test('validarFlujo: esperaMin que no es un número es un error (no se vuelve 0 en silencio)', () => {
  const roto = { nodos: [D({ tipo: 'organico' }), M('a', {}), F], lineas: [L('d', 'a'), { id: 'a-siguiente-f', de: 'a', puerto: 'siguiente', a: 'f', esperaMin: 'dos horas' }] }
  assert.ok(validarFlujo(roto).some(e => e.lineaId === 'a-siguiente-f'))
})
test('validarFlujo: un botón sin título es un error; un tipo de nodo desconocido tambien', () => {
  assert.ok(validarFlujo({ nodos: [D({ tipo: 'organico' }), M('b', { botones: [{ title: '  ' }] }), F], lineas: [L('d', 'b'), L('b', 'f', 'btn_1')] }).some(e => e.nodoId === 'b'))
  const raro = { nodos: [D({ tipo: 'organico' }), { id: 'x', tipo: 'mago', pos: { x: 0, y: 0 }, datos: {} }, F], lineas: [L('d', 'x'), L('x', 'f')] }
  assert.ok(validarFlujo(raro).some(e => e.nodoId === 'x'))
})
test('validarFlujo y caminoLineal: un null dentro de nodos o lineas no revienta', () => {
  const conNulos = { nodos: [D({ tipo: 'organico' }), null, M('a', {}), F], lineas: [null, L('d', 'a'), L('a', 'f')] }
  assert.doesNotThrow(() => validarFlujo(conNulos))
  assert.doesNotThrow(() => caminoLineal(conNulos))
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
  // Un sourceId que no tiene flujo asignado NO cae a una palabra ni al orgánico:
  // el orgánico es "sin anuncio" (spec §2), y un anuncio sin dueño no es orgánico.
  assert.equal(elegirFlujo({ flujos, sourceId: '999', esNuevo: true, texto: 'hola' }), null)
  assert.equal(elegirFlujo({ flujos, sourceId: '999', esNuevo: false, texto: 'quiero la chaqueta' }), null)
})
test('elegirFlujo: una palabra vacía no matchea cualquier texto', () => {
  const fVacia = { flujo_id: 'v', publicado: true, grafo_vivo: { ...lineal, nodos: [D({ tipo: 'palabra', palabras: [''] }), ...lineal.nodos.slice(1)] } }
  assert.equal(elegirFlujo({ flujos: [fVacia], sourceId: '', esNuevo: false, texto: 'cualquier cosa' }), null)
})
test('caminoLineal: recorre hasta Fin', () => {
  const c = caminoLineal(lineal)
  assert.deepEqual(c.mensajes.map(n => n.id), ['m1', 'm2']); assert.equal(c.motivo, 'fin')
})
test('caminoLineal: se detiene en botones / espera en la línea / esperar respuesta / condición', () => {
  const conBotones = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', { botones: [{ title: 'Sí' }] }), M('c', {}), F], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'c', 'btn_1'), L('c', 'f')] }
  let c = caminoLineal(conBotones); assert.deepEqual(c.mensajes.map(n => n.id), ['a', 'b']); assert.equal(c.motivo, 'botones'); assert.equal(c.detenidoEn, 'b')
  const conEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 60), L('b', 'f')] }
  c = caminoLineal(conEspera); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'espera'); assert.equal(c.detenidoEn, 'a'); assert.equal(c.lineaEspera, 'a-siguiente-b')
  const esperando = { nodos: [D({ tipo: 'organico' }), M('a', { esperarRespuesta: true }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'respuesta'), L('b', 'f')] }
  c = caminoLineal(esperando); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'esperar_respuesta')
  const conCond = { nodos: [D({ tipo: 'organico' }), M('a', {}), { id: 'c', tipo: 'condicion', pos: { x: 0, y: 0 }, datos: { campo: 'temperatura', valor: 'caliente' } }, F], lineas: [L('d', 'a'), L('a', 'c'), L('c', 'f', 'si')] }
  c = caminoLineal(conCond); assert.deepEqual(c.mensajes.map(n => n.id), ['a']); assert.equal(c.motivo, 'condicion')
})
test('caminoLineal: la línea del puerto "otra" nunca se sigue (se detiene en botones igual)', () => {
  const conOtra = { nodos: [D({ tipo: 'organico' }), M('a', { botones: [{ title: 'Sí' }] }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'otra'), L('a', 'f', 'btn_1')] }
  const c = caminoLineal(conOtra)
  assert.deepEqual(c.mensajes.map(n => n.id), ['a'])
  assert.equal(c.motivo, 'botones')
  assert.equal(c.detenidoEn, 'a')
})
test('puertosDe: con botones Y esperarRespuesta a la vez, ganan los botones', () => {
  assert.deepEqual(puertosDe(M('a', { botones: [{ title: 'Sí' }], esperarRespuesta: true })), ['btn_1', 'otra'])
})
test('caminoLineal: una línea a un nodo que no existe → huerfano, parado en el último nodo válido', () => {
  const roto = { nodos: [D({ tipo: 'organico' }), M('a', {})], lineas: [L('d', 'a'), { id: 'a-siguiente-x', de: 'a', puerto: 'siguiente', a: 'no-existe', esperaMin: 0 }] }
  const c = caminoLineal(roto)
  assert.deepEqual(c.mensajes.map(n => n.id), ['a'])
  assert.equal(c.motivo, 'huerfano')
  assert.equal(c.detenidoEn, 'a')
})
test('caminoLineal: esperaMin que no es número se trata como huérfano, no como inmediato', () => {
  const roto = { nodos: [D({ tipo: 'organico' }), M('a', {}), F], lineas: [L('d', 'a'), { id: 'a-siguiente-f', de: 'a', puerto: 'siguiente', a: 'f', esperaMin: 'dos horas' }] }
  const c = caminoLineal(roto)
  assert.deepEqual(c.mensajes.map(n => n.id), ['a'])
  assert.equal(c.motivo, 'huerfano')
  assert.equal(c.detenidoEn, 'a')
})
test('nodoDisparador: null si el grafo no tiene ninguno', () => {
  assert.equal(nodoDisparador({ nodos: [F], lineas: [] }), null)
})
test('piezasDeNodos: respuesta rápida con adjuntos + texto con botones; la 1.ª cita', () => {
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
test(`piezasDeNodos: tope de ${MAX_PIEZAS} piezas, la 1.ª con la cita`, () => {
  const nodos = Array.from({ length: 20 }, (_, i) => M(`m${i}`, { origen: 'texto', texto: `paso ${i}` }))
  const p = piezasDeNodos({ nodos, respuestas, contacto, citaId: 'wamid.X' })
  assert.equal(p.length, MAX_PIEZAS)
  assert.equal(p[0].ContextoId, 'wamid.X')
})
test('piezasDeNodos: los adjuntos de un nodo texto se normalizan (null y url vacía se filtran)', () => {
  const nodos = [M('z', { origen: 'texto', texto: '', adjuntos: [null, { tipo: 'imagen', url: '' }, { tipo: 'audio', url: 'https://x/v.ogg' }] })]
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

// ── Fase B ────────────────────────────────────────────────────────────────────
const C = (id, datos) => ({ id, tipo: 'condicion', pos: { x: 0, y: 0 }, datos })
// d → pregunta(btn Sí/No) → [Sí] m_si → f · [No] m_no → f · [otra] m_otra → f
const conBotones = {
  nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }, { title: 'No' }] }), M('m_si', {}), M('m_no', {}), M('m_otra', {}), F],
  lineas: [L('d', 'preg'), L('preg', 'm_si', 'btn_1'), L('preg', 'm_no', 'btn_2'), L('preg', 'm_otra', 'otra'), L('m_si', 'f'), L('m_no', 'f'), L('m_otra', 'f')],
}
// d → a ─(espera 30 min)→ b → f
const conEspera = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 30), L('b', 'f')] }
// d → cond(temperatura=caliente) → [si] m_si → f · [no] m_no → f
const conCondicion = {
  nodos: [D({ tipo: 'organico' }), C('cond', { campo: 'temperatura', valor: 'caliente' }), M('m_si', {}), M('m_no', {}), F],
  lineas: [L('d', 'cond'), L('cond', 'm_si', 'si'), L('cond', 'm_no', 'no'), L('m_si', 'f'), L('m_no', 'f')],
}

test('avanzarDesde: desde un botón sigue la rama de ese botón y llega a Fin', () => {
  const r = avanzarDesde(conBotones, { nodoId: 'preg', puerto: 'btn_2' })
  assert.deepEqual(r.mensajes.map(n => n.id), ['m_no'])
  assert.equal(r.motivo, 'fin')
  assert.deepEqual(r.visitados, ['m_no', 'f'])
})
test('avanzarDesde: una línea con espera se detiene ANTES de seguirla y dice por dónde seguir', () => {
  const r = avanzarDesde(conEspera, { nodoId: 'd', puerto: 'siguiente' })
  assert.deepEqual(r.mensajes.map(n => n.id), ['a'])
  assert.equal(r.motivo, 'espera')
  assert.equal(r.detenidoEn, 'a')
  assert.equal(r.puertoEspera, 'siguiente')
  assert.equal(r.esperaMin, 30)
})
test('avanzarDesde: con saltarEsperaInicial la primera línea se sigue aunque tenga espera (así reanuda el cron)', () => {
  const r = avanzarDesde(conEspera, { nodoId: 'a', puerto: 'siguiente', saltarEsperaInicial: true })
  assert.deepEqual(r.mensajes.map(n => n.id), ['b'])
  assert.equal(r.motivo, 'fin')
})
test('avanzarDesde: nodo de arranque que no existe → huérfano sin mandar nada', () => {
  const r = avanzarDesde(conEspera, { nodoId: 'zzz', puerto: 'siguiente' })
  assert.equal(r.motivo, 'huerfano')
  assert.deepEqual(r.mensajes, [])
})
test('avanzarDesde: sin evaluar, una Condición detiene; con evaluar, sigue por si/no y la cuenta como visitada', () => {
  const sinEval = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente' })
  assert.equal(sinEval.motivo, 'condicion')
  assert.equal(sinEval.detenidoEn, 'cond')
  const si = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente', evaluar: () => true })
  assert.deepEqual(si.mensajes.map(n => n.id), ['m_si'])
  assert.deepEqual(si.visitados, ['cond', 'm_si', 'f'])
  const no = avanzarDesde(conCondicion, { nodoId: 'd', puerto: 'siguiente', evaluar: () => false })
  assert.deepEqual(no.mensajes.map(n => n.id), ['m_no'])
})
test('caminoLineal sigue dando lo mismo que antes (contrato de la Fase A)', () => {
  const r = caminoLineal(lineal)
  assert.deepEqual(r.mensajes.map(n => n.id), ['m1', 'm2'])
  assert.equal(r.motivo, 'fin')
  assert.equal(caminoLineal(conBotones).motivo, 'botones')
  assert.equal(caminoLineal(conEspera).motivo, 'espera')
  assert.equal(caminoLineal(conCondicion).motivo, 'condicion')
})

test('evaluarCondicion: temperatura, tiene_venta, bandeja, hora (rango normal y rango que cruza medianoche)', () => {
  const base = { temperatura: 'caliente', tieneVenta: false, estado: 'pendiente', ahora: new Date('2026-09-15T15:30:00-05:00') }
  assert.equal(evaluarCondicion(C('c', { campo: 'temperatura', valor: 'Caliente' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'temperatura', valor: 'frio' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'temperatura', valor: '' }), { ...base, temperatura: '' }), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'tiene_venta', valor: 'no' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'tiene_venta', valor: 'sí' }), { ...base, tieneVenta: true }), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'bandeja', valor: 'PENDIENTE' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '09:00-18:00' }), base), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '18:00-09:00' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: '22:00 - 06:00' }), { ...base, ahora: new Date('2026-09-15T23:10:00-05:00') }), true)
  assert.equal(evaluarCondicion(C('c', { campo: 'hora', valor: 'cualquier cosa' }), base), false)
  assert.equal(evaluarCondicion(C('c', { campo: 'mago', valor: 'x' }), base), false)
})
test('horaEcuador: convierte a America/Guayaquil (también la medianoche)', () => {
  assert.equal(horaEcuador(new Date('2026-09-15T20:05:00Z')), '15:05')
  assert.equal(horaEcuador(new Date('2026-09-16T05:00:00Z')), '00:00')
})

test('puertoDeEntrante: id rc_N → btn_N; texto igual al título → ese botón; otro texto → otra; esperando respuesta → respuesta; nodo simple → null', () => {
  const preg = conBotones.nodos.find(n => n.id === 'preg')
  assert.equal(puertoDeEntrante(preg, { botonId: 'rc_2', texto: 'No' }), 'btn_2')
  assert.equal(puertoDeEntrante(preg, { botonId: '', texto: '  sí ' }), 'btn_1')
  assert.equal(puertoDeEntrante(preg, { botonId: '', texto: 'quiero ver fotos' }), 'otra')
  assert.equal(puertoDeEntrante(preg, { botonId: 'rc_9', texto: 'x' }), 'otra')
  assert.equal(puertoDeEntrante(M('e', { esperarRespuesta: true }), { botonId: '', texto: 'lo que sea' }), 'respuesta')
  assert.equal(puertoDeEntrante(M('s', {}), { botonId: '', texto: 'hola' }), null)
})

test('paradaDeCamino: botones/respuesta esperan hasta el fin de la ventana; espera en la línea espera esperaMin; fin → null', () => {
  const ahora = new Date('2026-09-15T10:00:00Z')
  const ultimoEntranteAt = '2026-09-15T09:00:00Z'
  assert.deepEqual(paradaDeCamino(caminoLineal(conBotones), { ahora, ultimoEntranteAt }), { esperando: 'boton', nodoId: 'preg', puertoTiempo: null, venceAt: '2026-09-16T09:00:00.000Z' })
  const pr = paradaDeCamino(caminoLineal({ nodos: [D({ tipo: 'organico' }), M('e', { esperarRespuesta: true }), F], lineas: [L('d', 'e'), L('e', 'f', 'respuesta')] }), { ahora, ultimoEntranteAt })
  assert.equal(pr.esperando, 'respuesta')
  assert.deepEqual(paradaDeCamino(caminoLineal(conEspera), { ahora, ultimoEntranteAt }), { esperando: 'tiempo', nodoId: 'a', puertoTiempo: 'siguiente', venceAt: '2026-09-15T10:30:00.000Z' })
  assert.equal(paradaDeCamino(caminoLineal(lineal), { ahora, ultimoEntranteAt }), null)
  assert.equal(paradaDeCamino(caminoLineal(conBotones), { ahora, ultimoEntranteAt: null }).venceAt, '2026-09-16T10:00:00.000Z')
})

test('citaDeTanda: al disparar cita el entrante; después solo si el primer nodo pide citar la última respuesta', () => {
  assert.equal(citaDeTanda({ nodos: [M('a', {})], esDisparo: true, wamidEntrante: 'w1', ultimoWamid: '' }), 'w1')
  assert.equal(citaDeTanda({ nodos: [M('a', {})], esDisparo: false, wamidEntrante: 'w2', ultimoWamid: 'w2' }), '')
  assert.equal(citaDeTanda({ nodos: [M('a', { citarUltimaRespuesta: true })], esDisparo: false, wamidEntrante: '', ultimoWamid: 'w9' }), 'w9')
  assert.equal(citaDeTanda({ nodos: [], esDisparo: true, wamidEntrante: 'w1', ultimoWamid: '' }), '')
})

test('ventanaAbierta: 24 h desde el último entrante, con 5 min de margen; sin fecha → cerrada', () => {
  const ahora = new Date('2026-09-16T08:56:00Z')
  assert.equal(ventanaAbierta('2026-09-15T09:00:00Z', ahora), false)
  assert.equal(ventanaAbierta('2026-09-15T09:02:00Z', ahora), true)
  assert.equal(ventanaAbierta(null, ahora), false)
})

test('decidirEntranteEnFlujo: botón tocado → seguir por su puerto; texto libre → otra; esperando respuesta → respuesta', () => {
  const flujo = { flujo_id: 'f1', nombre: 'X', publicado: true, grafo_vivo: { nodos: [...conBotones.nodos, M('e', { esperarRespuesta: true })], lineas: conBotones.lineas } }
  const ahora = new Date('2026-09-15T10:00:00Z')
  const vivo = '2026-09-16T09:00:00Z'
  assert.deepEqual(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo, entrante: { botonId: 'rc_1', texto: 'Sí' }, ahora }), { accion: 'seguir', desde: { nodoId: 'preg', puerto: 'btn_1' } })
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo, entrante: { botonId: '', texto: 'fotos' }, ahora }).desde.puerto, 'otra')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'e', esperando: 'respuesta', vence_at: vivo }, flujo, entrante: { botonId: '', texto: 'Ana Pérez, Quito' }, ahora }).desde.puerto, 'respuesta')
})
test('decidirEntranteEnFlujo: esperando tiempo → ignorar (lo sigue el cron); vencido, despublicado o nodo perdido → borrar', () => {
  const flujo = { flujo_id: 'f1', nombre: 'X', publicado: true, grafo_vivo: conBotones }
  const ahora = new Date('2026-09-15T10:00:00Z')
  const vivo = '2026-09-16T09:00:00Z'
  const toque = { botonId: 'rc_1', texto: 'Sí' }
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'tiempo', vence_at: vivo }, flujo, entrante: toque, ahora }).accion, 'ignorar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: '2026-09-15T09:59:00Z' }, flujo, entrante: toque, ahora }).accion, 'borrar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', vence_at: vivo }, flujo: null, entrante: toque, ahora }).accion, 'borrar')
  assert.equal(decidirEntranteEnFlujo({ estado: { flujo_id: 'f1', nodo_id: 'nope', esperando: 'boton', vence_at: vivo }, flujo, entrante: toque, ahora }).accion, 'borrar')
})

test('decidirVencido: ventana abierta y flujo vivo → seguir saltando la espera; ventana cerrada / despublicado / nodo perdido → borrar', () => {
  const ahora = new Date('2026-09-15T12:00:00Z')
  const estado = { flujo_id: 'f1', nodo_id: 'a', esperando: 'tiempo', puerto_tiempo: 'siguiente', vence_at: '2026-09-15T11:59:00Z' }
  const flujo = { flujo_id: 'f1', nombre: 'X', publicado: true, grafo_vivo: conEspera }
  const abierta = { ultimoEntranteAt: '2026-09-15T09:00:00Z' }
  assert.deepEqual(decidirVencido({ estado, flujo, contacto: abierta, ahora }), { accion: 'seguir', desde: { nodoId: 'a', puerto: 'siguiente', saltarEsperaInicial: true } })
  assert.equal(decidirVencido({ estado, flujo, contacto: { ultimoEntranteAt: '2026-09-14T11:00:00Z' }, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado, flujo: null, contacto: abierta, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado: { ...estado, nodo_id: 'zzz' }, flujo, contacto: abierta, ahora }).accion, 'borrar')
  assert.equal(decidirVencido({ estado, flujo, contacto: null, ahora }).accion, 'borrar')
})
