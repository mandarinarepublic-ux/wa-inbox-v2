import test from 'node:test'
import assert from 'node:assert'
import {
  patronSinTildes, puntuarCliente, puedeRecibirGuia, ordenarResultados, tipoDeBusqueda, palabrasDireccionParaBuscar, pareceNumeroDeGuia,
} from '../lib/guias-servientrega.js'

// El caso real que la búsqueda vieja no encontraba (guía 9036835780, 26-oct-2026).
const AMBAR = { cliente_id: 'a', nombre: 'Ámbar Rosado Espinoza ', celular: '0986979499', cedula: '0942115593',
  direccion: 'Milagro-Guayas: * P.Macias 810\n* Carlos Brito' }
const GUIA = { celulares: ['0986970499'], nombre: 'ROSADO ESPINOZA AMBAR ELIZABETH',
  direccion: 'P. MACIAS 810 Y AV CARLOS BRITO CASA DE PORTON CAFE' }

// Postgres usa \m \M para el borde de palabra; JS usa \b (vale para estas pruebas sin tildes en el borde).
const comoJs = (p) => new RegExp(p.replace(/\\[mM]/g, '\\b'), 'i')

test('el patrón ignora tildes: "ambar" encuentra "Ámbar"', () => {
  assert.equal(patronSinTildes('AMBAR'), '[aáàäâ]mb[aáàäâ]r')
  assert.ok(comoJs(patronSinTildes('AMBAR')).test('Ámbar Rosado'))
})

test('la ñ: "Muñoz" y "MUNOZ" encuentran a "Muñoz" (y a "Munoz")', () => {
  for (const q of ['Muñoz', 'MUNOZ']) {
    const re = comoJs(patronSinTildes(q))
    assert.ok(re.test('Carla Muñoz'), q)
    assert.ok(re.test('Carla Munoz'), q)
  }
})

test('una palabra corta es palabra ENTERA: "Ana" no trae a "Mariana" ni a cualquiera con "_n_"', () => {
  const re = comoJs(patronSinTildes('Ana', { palabraEntera: true }))
  assert.ok(re.test('Ana Paz'))
  assert.ok(!re.test('Mariana Paz'))
  assert.ok(!re.test('Luis Encalada'))
})

test('Ámbar: celular a un dígito + 3 de 4 palabras del nombre + dirección', () => {
  const r = puntuarCliente(AMBAR, GUIA)
  assert.deepEqual(r.razones, ['📱 celular a 1 dígito', '👤 nombre 3/4', '📍 dirección'])
  assert.ok(r.puntos > 60)
})

test('un cliente que solo comparte un apellido queda muy por debajo', () => {
  const otro = { nombre: 'Carlos Rosado', celular: '0991111111', direccion: 'Quito centro' }
  assert.ok(puntuarCliente(otro, GUIA).puntos < puntuarCliente(AMBAR, GUIA).puntos / 3)
})

test('celular igual y cédula suman más que un parecido', () => {
  assert.deepEqual(puntuarCliente(AMBAR, { celulares: ['593986979499'] }).razones, ['📱 celular igual'])
  assert.deepEqual(puntuarCliente(AMBAR, { cedula: '0942115593' }).razones, ['🪪 cédula'])
  assert.equal(puntuarCliente(AMBAR, { celulares: ['0991234567'] }).puntos, 0)
})

test('la dirección ignora las palabras que salen en cualquier dirección', () => {
  assert.deepEqual(palabrasDireccionParaBuscar('CALLE PRINCIPAL ENTRE 810 Y LAGO SOL URBANIZACION'), ['URBANIZACION', 'LAGO'])
})

test('qué escribió: pedido, número o texto', () => {
  assert.equal(tipoDeBusqueda('MAN-AND-6314').tipo, 'pedido')
  assert.deepEqual(tipoDeBusqueda('098 697 9499'), { tipo: 'numero', valor: '0986979499' })
  assert.equal(tipoDeBusqueda('lago sol').tipo, 'texto')
  assert.equal(tipoDeBusqueda('ind-xav-452').tipo, 'pedido')
  assert.equal(tipoDeBusqueda('AND-6314').tipo, 'pedido')
  // Una dirección con guion NO es un pedido (31 del CRM son así).
  assert.equal(tipoDeBusqueda('Milagro-Guayas P. Macias').tipo, 'texto')
})

test('primero los que pueden recibir guía, a igual puntaje', () => {
  const ahora = Date.parse('2026-10-26T15:00:00Z')
  const conGuia = new Set(['P3'])
  const fab = { pedido_id: 'P1', estado_pedido: 'EN_FABRICA', fecha_pedido: '2026-10-01' }
  const viejo = { pedido_id: 'P2', estado_pedido: 'COMPLETADO', fecha_pedido: '2026-05-01' }
  const yaTiene = { pedido_id: 'P3', estado_pedido: 'DESPACHO', fecha_pedido: '2026-10-20' }
  assert.equal(puedeRecibirGuia(fab, conGuia, ahora), true)
  assert.equal(puedeRecibirGuia(viejo, conGuia, ahora), false)
  assert.equal(puedeRecibirGuia(yaTiene, conGuia, ahora), false)
  const orden = ordenarResultados([
    { ...yaTiene, puntos: 50, puede: false }, { ...fab, puntos: 50, puede: true }, { ...viejo, puntos: 80, puede: false },
  ]).map(x => x.pedido_id)
  assert.deepEqual(orden, ['P2', 'P1', 'P3'])
})

test('solo un número de guía ofrece buscar la guía en todo el CRM', () => {
  for (const q of ['9036835780', '90368', '9036 8357 80']) assert.equal(pareceNumeroDeGuia(q), true, q)
  for (const q of ['MAN-AND-6314', '0986979499', '986979499', '593986979499', 'Ana 9036', '903']) {
    assert.equal(pareceNumeroDeGuia(q), false, q)
  }
})
