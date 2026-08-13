import test from 'node:test'
import assert from 'node:assert'
import { recortar, cuerpoDeMensaje, debeSonar, VENTANA_SONIDO_MS, avisoDeEntrante } from '../lib/push.js'

test('recortar deja los textos cortos intactos', () => {
  assert.equal(recortar('hola'), 'hola')
})

test('recortar colapsa espacios y saltos de linea', () => {
  assert.equal(recortar('hola   \n  mundo'), 'hola mundo')
})

test('recortar corta y agrega puntos suspensivos', () => {
  const largo = 'a'.repeat(200)
  const r = recortar(largo, 10)
  assert.equal(r.length, 10)
  assert.ok(r.endsWith('…'))
})

test('recortar tolera null y undefined', () => {
  assert.equal(recortar(null), '')
  assert.equal(recortar(undefined), '')
})

test('cuerpoDeMensaje usa el texto cuando es un mensaje de texto', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: 'quiero el vestido' }), 'quiero el vestido')
})

test('cuerpoDeMensaje describe una foto sin caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: '' }), '📷 Foto')
})

test('cuerpoDeMensaje combina descriptor y caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: 'esta talla' }), '📷 Foto · esta talla')
})

test('cuerpoDeMensaje nunca queda vacio', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: '   ' }), 'Mensaje nuevo')
})

test('debeSonar suena la primera vez', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

test('debeSonar NO suena dentro de la ventana', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  assert.equal(debeSonar(hace10seg, ahora), false)
})

test('debeSonar vuelve a sonar pasada la ventana', () => {
  const ahora = Date.now()
  const hace2min = new Date(ahora - 2 * 60 * 1000).toISOString()
  assert.equal(debeSonar(hace2min, ahora), true)
})

test('debeSonar ignora una fecha corrupta y suena', () => {
  assert.equal(debeSonar('no-es-fecha', Date.now()), true)
})

test('la ventana de sonido es de 60 segundos, no de 5 minutos', () => {
  assert.equal(VENTANA_SONIDO_MS, 60 * 1000)
})

// Contestar borra ultimo_push_at (lo hace limpiarPush desde /api/saliente).
// Con el significado nuevo eso quiere decir: la próxima entrante suena sí o sí.
test('tras contestar, el siguiente mensaje vuelve a sonar', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

const ENTRANTE = { telefono: '593999111222', nombre: 'Karilu', tipo: 'texto', contenido: 'hola' }

// LA prueba de la garantía: dentro de la ventana el aviso EXISTE igual.
// Si alguien vuelve a usar debeSonar como guarda de envio, esto se cae.
test('avisoDeEntrante devuelve un aviso aunque NO toque sonar', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  const aviso = avisoDeEntrante(ENTRANTE, hace10seg, ahora)
  assert.ok(aviso, 'SIEMPRE tiene que haber aviso')
  assert.equal(aviso.renotify, false, 'pero callado')
  assert.equal(aviso.tel, '593999111222')
  assert.ok(aviso.cuerpo, 'con cuerpo, no vacio')
})

test('avisoDeEntrante suena cuando la ventana ya paso', () => {
  const ahora = Date.now()
  const hace2min = new Date(ahora - 2 * 60 * 1000).toISOString()
  assert.equal(avisoDeEntrante(ENTRANTE, hace2min, ahora).renotify, true)
})

test('avisoDeEntrante suena la primera vez (sin aviso previo)', () => {
  assert.equal(avisoDeEntrante(ENTRANTE, null, Date.now()).renotify, true)
})

// Lo unico que cambia entre sonar y no sonar es `renotify`. Si algun dia cambia
// algo mas, es que la ventana empezo a decidir cosas que no le tocan.
test('la ventana SOLO cambia renotify, nada mas del aviso', () => {
  const ahora = Date.now()
  const callado = avisoDeEntrante(ENTRANTE, new Date(ahora - 10 * 1000).toISOString(), ahora)
  const sonoro  = avisoDeEntrante(ENTRANTE, null, ahora)
  assert.deepEqual({ ...callado, renotify: null }, { ...sonoro, renotify: null })
})

test('avisoDeEntrante cae al telefono cuando no hay nombre', () => {
  const sinNombre = { ...ENTRANTE, nombre: '' }
  assert.ok(avisoDeEntrante(sinNombre, null, Date.now()).titulo.includes('593999111222'))
})
