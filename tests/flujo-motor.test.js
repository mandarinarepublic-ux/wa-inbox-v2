import test from 'node:test'
import assert from 'node:assert'
import { correrTanda, filaDeEstado } from '../lib/flujo-motor.js'

const D = (datos) => ({ id: 'd', tipo: 'disparador', pos: { x: 0, y: 0 }, datos })
const M = (id, datos) => ({ id, tipo: 'mensaje', pos: { x: 0, y: 0 }, datos: { origen: 'texto', texto: 'hola ' + id, adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, etapa: '', ...datos } })
const F = { id: 'f', tipo: 'fin', pos: { x: 0, y: 0 }, datos: {} }
const L = (de, a, puerto = 'siguiente', esperaMin = 0) => ({ id: `${de}-${puerto}-${a}`, de, puerto, a, esperaMin })
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372', etapa: '', tieneVenta: false, estado: 'pendiente', ultimoEntranteAt: '2026-09-15T09:00:00Z' }
const flujo = (grafo) => ({ flujo_id: 'f1', nombre: 'X', grafo_vivo: grafo })
const desdeD = { nodoId: 'd', puerto: 'siguiente' }

function depsFalsas() {
  const reg = { enviadas: [], estado: null, borrados: 0, pasos: [], temps: [], avisos: [], orden: [] }
  const deps = {
    enviar: async (p) => { reg.orden.push('enviar'); reg.enviadas.push(p); return { ok: true } },
    guardarEstado: async (f) => { reg.orden.push('estado'); reg.estado = f },
    borrarEstado: async () => { reg.orden.push('borrar'); reg.borrados++ },
    registrarPasos: async (a) => { reg.pasos.push(a) },
    setEtapa: async (_t, etapa) => { reg.temps.push(etapa) },
    avisar: async (t) => { reg.avisos.push(t) },
    ahora: () => new Date('2026-09-15T10:00:00Z'),
    cuenta: 'MANDI',
    log: () => {},
  }
  return { deps, reg }
}

test('filaDeEstado: la parada del motor puro → fila de inbox.flujo_estado', () => {
  const parada = { esperando: 'tiempo', nodoId: 'a', puertoTiempo: 'siguiente', venceAt: '2026-09-15T10:30:00.000Z' }
  assert.deepEqual(filaDeEstado('0999000111', parada, { flujo_id: 'f-1', ultimoWamid: 'w1' }), {
    telefono: '0999000111', flujo_id: 'f-1', nodo_id: 'a', esperando: 'tiempo', puerto_tiempo: 'siguiente',
    vence_at: '2026-09-15T10:30:00.000Z', ultimo_wamid: 'w1',
  })
  assert.equal(filaDeEstado('1', { esperando: 'boton', nodoId: 'p', puertoTiempo: null, venceAt: 'x' }, { flujo_id: 'f' }).puerto_tiempo, null)
})

test('correrTanda: disparo lineal → manda citando el entrante, registra pasos, temperatura, borra estado', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', { etapa: 'cotizando' }), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b'), L('b', 'f')] }
  const r = await correrTanda(deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(r.salieron, 2)
  assert.equal(reg.enviadas[0].ContextoId, 'w-in')
  assert.equal(reg.enviadas[1].ContextoId, undefined)
  assert.deepEqual(reg.pasos[0].nodoIds, ['a', 'b', 'f'])
  assert.deepEqual(reg.temps, ['cotizando'])
  assert.equal(reg.estado, null)
  assert.equal(reg.borrados, 1)
})

test('correrTanda: se detiene en botones → guarda el estado ANTES de mandar, hasta el fin de la ventana', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }, { title: 'No' }] }), F], lineas: [L('d', 'preg')] }
  await correrTanda(deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(reg.orden[0], 'estado')
  assert.deepEqual(reg.estado, { telefono: '593999000111', flujo_id: 'f1', nodo_id: 'preg', esperando: 'boton', puerto_tiempo: null, vence_at: '2026-09-16T09:00:00.000Z', ultimo_wamid: 'w-in' })
  assert.equal(reg.enviadas[0].TipoMensaje, 'interactive_buttons')
})

test('correrTanda: espera en la línea → estado esperando tiempo con el puerto a seguir', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [L('d', 'a'), L('a', 'b', 'siguiente', 30), L('b', 'f')] }
  await correrTanda(deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w-in', ultimoWamid: 'w-in', respuestas: [] })
  assert.equal(reg.estado.esperando, 'tiempo')
  assert.equal(reg.estado.puerto_tiempo, 'siguiente')
  assert.equal(reg.estado.vence_at, '2026-09-15T10:30:00.000Z')
  assert.equal(reg.enviadas.length, 1)
})

test('correrTanda: la Condición se evalúa con el contacto y sigue por la rama que toca', async () => {
  const { deps, reg } = depsFalsas()
  const grafo = {
    nodos: [D({ tipo: 'organico' }), { id: 'c', tipo: 'condicion', pos: { x: 0, y: 0 }, datos: { campo: 'temperatura', valor: 'caliente' } }, M('si', {}), M('no', {}), F],
    lineas: [L('d', 'c'), L('c', 'si', 'si'), L('c', 'no', 'no'), L('si', 'f'), L('no', 'f')],
  }
  await correrTanda(deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto: { ...contacto, ultimoEntranteAt: '2026-09-15T09:45:00Z' }, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(reg.enviadas[0].Mensaje, 'hola si')
})

test('correrTanda: reanudar tras un botón cita solo si el nodo lo pide; 0/N piezas avisa por Telegram', async () => {
  const { deps, reg } = depsFalsas()
  deps.enviar = async () => ({ ok: false, status: 500 })
  const grafo = { nodos: [D({ tipo: 'organico' }), M('preg', { botones: [{ title: 'Sí' }] }), M('r', { citarUltimaRespuesta: true }), F], lineas: [L('d', 'preg'), L('preg', 'r', 'btn_1'), L('r', 'f')] }
  const r = await correrTanda(deps, { flujo: flujo(grafo), desde: { nodoId: 'preg', puerto: 'btn_1' }, esDisparo: false, contacto, wamidEntrante: 'w-tap', ultimoWamid: 'w-tap', respuestas: [] })
  assert.equal(r.piezas[0].ContextoId, 'w-tap')
  assert.equal(r.salieron, 0)
  assert.equal(reg.avisos.length, 1)
  assert.match(reg.avisos[0], /en MANDI/)
})

test('correrTanda: camino roto → no manda, borra estado; un fallo en pasos o temperatura no frena el envío', async () => {
  const { deps, reg } = depsFalsas()
  const roto = { nodos: [D({ tipo: 'organico' }), F], lineas: [L('d', 'zzz')] }
  const r = await correrTanda(deps, { flujo: flujo(roto), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(r.salieron, 0)
  assert.equal(reg.enviadas.length, 0)
  assert.equal(reg.borrados, 1)

  const dos = depsFalsas()
  dos.deps.registrarPasos = () => { throw new Error('base caída') }
  dos.deps.setEtapa = async () => { throw new Error('base caída') }
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', { etapa: 'esperando_pago' }), F], lineas: [L('d', 'a'), L('a', 'f')] }
  const r2 = await correrTanda(dos.deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(r2.salieron, 1)
})

test('correrTanda: espera las pausas en segundos ANTES de cada pieza y no manda el campo interno', async () => {
  const { deps, reg } = depsFalsas()
  const esperas = []
  deps.dormir = async (ms) => { esperas.push(ms); reg.orden.push(`dormir ${ms}`) }
  const grafo = { nodos: [D({ tipo: 'organico' }), M('a', {}), M('b', {}), F], lineas: [{ ...L('d', 'a'), esperaSeg: 5 }, { ...L('a', 'b'), esperaSeg: 3 }, L('b', 'f')] }
  const r = await correrTanda(deps, { flujo: flujo(grafo), desde: desdeD, esDisparo: true, contacto, wamidEntrante: 'w', ultimoWamid: 'w', respuestas: [] })
  assert.equal(r.salieron, 2)
  assert.deepEqual(esperas, [5000, 3000])
  assert.deepEqual(reg.orden.filter(x => x !== 'borrar'), ['dormir 5000', 'enviar', 'dormir 3000', 'enviar'])
  assert.ok(reg.enviadas.every(p => !('_esperaSeg' in p)))
  assert.equal(reg.enviadas[0].ContextoId, 'w')
})
