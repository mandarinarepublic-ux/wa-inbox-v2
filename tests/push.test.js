import test from 'node:test'
import assert from 'node:assert'
import { recortar, cuerpoDeMensaje, debeSonar, VENTANA_SONIDO_MS } from '../lib/push.js'

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

// ── LA PRUEBA QUE DISTINGUE ESTE ARREGLO DE UN CAMBIO DE NOMBRE ──────────────
// Antes, dentro del enfriamiento NO se mandaba nada y el mensaje se perdía.
// Ahora se manda igual, callado. `debeSonar` solo puede apagar el sonido; no
// existe ningún camino donde su `false` impida el envío.
test('dentro de la ventana el aviso IGUAL se manda, solo que callado', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  assert.equal(debeSonar(hace10seg, ahora), false, 'no debe sonar')
  // El webhook no consulta nada más para decidir el envío: manda SIEMPRE y usa
  // este booleano solo como `renotify`. Si algún día alguien lo vuelve a usar
  // como guarda de envío, la alarma es este comentario más el grep del Step 7.
})
