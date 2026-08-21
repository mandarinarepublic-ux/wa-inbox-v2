// Quién se suscribió a los avisos push.
//
// La suscripción guardaba solo el APARATO, así que no se podía responder "¿está
// cubierto el equipo?" sin preguntarle a la gente. Ahora guarda el usuario.
//
// La regla que estas pruebas protegen: el cambio es de REGISTRO, no de reparto.
// Sin sesión la suscripción se guarda IGUAL. Un push perdido por endurecer esta
// ruta sería justo el daño que se quiere evitar.
import test from 'node:test'
import assert from 'node:assert'
import { firmarSesion, COOKIE_SESION } from '../lib/sesion.js'
import { usuarioDeCookie } from '../lib/acceso.js'
import { cuerpoDeSuscripcion } from '../lib/push.js'

const SECRETO = 'secreto-de-prueba-no-es-el-de-produccion'

test('usuarioDeCookie saca el id de una cookie firmada', async () => {
  const token = await firmarSesion({ id: 'uuid-002', rol: 'VENDEDOR' }, SECRETO)
  assert.strictEqual(await usuarioDeCookie(`${COOKIE_SESION}=${token}`, SECRETO), 'uuid-002')
})

test('usuarioDeCookie encuentra la cookie entre otras', async () => {
  const token = await firmarSesion({ id: 'uuid-002', rol: 'VENDEDOR' }, SECRETO)
  const header = `otra=1; ${COOKIE_SESION}=${token}; tercera=xyz`
  assert.strictEqual(await usuarioDeCookie(header, SECRETO), 'uuid-002')
})

// El camino `x-mp-usuario-id` se eliminó porque cualquiera que supiera un id de
// admin lo suplantaba. Un token que no valida NO es un usuario.
test('usuarioDeCookie devuelve null si la firma no valida', async () => {
  const token = await firmarSesion({ id: 'uuid-002', rol: 'ADMIN' }, SECRETO)
  assert.strictEqual(await usuarioDeCookie(`${COOKIE_SESION}=${token}`, 'otro-secreto'), null)
})

test('usuarioDeCookie tolera falta de cookie, de header y de secreto', async () => {
  const token = await firmarSesion({ id: 'uuid-002', rol: 'ADMIN' }, SECRETO)
  assert.strictEqual(await usuarioDeCookie('', SECRETO), null)
  assert.strictEqual(await usuarioDeCookie(null, SECRETO), null)
  assert.strictEqual(await usuarioDeCookie('otra=1; tercera=2', SECRETO), null)
  assert.strictEqual(await usuarioDeCookie(`${COOKIE_SESION}=${token}`, ''), null)
})

const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'PK', auth: 'AK' } }

test('cuerpoDeSuscripcion lleva el usuario cuando hay sesion', () => {
  const c = cuerpoDeSuscripcion({ subscription: SUB, cuenta: 'MANDI', userAgent: 'Chrome', usuarioId: 'uuid-002' })
  assert.strictEqual(c.usuario_id, 'uuid-002')
  assert.strictEqual(c.endpoint, 'https://push.example/abc')
  assert.strictEqual(c.p256dh, 'PK')
  assert.strictEqual(c.auth, 'AK')
  assert.strictEqual(c.cuenta, 'MANDI')
  assert.strictEqual(c.fallos, 0)
})

// ☠️ LA prueba de este cambio. Si alguien la hace fallar "endureciendo" la ruta,
// deja sin avisos a quien tenga la sesión vencida.
test('SIN sesion la suscripcion se guarda IGUAL, con usuario_id null', () => {
  const c = cuerpoDeSuscripcion({ subscription: SUB, cuenta: 'MANDI', userAgent: 'Chrome', usuarioId: null })
  assert.strictEqual(c.usuario_id, null)
  assert.strictEqual(c.endpoint, 'https://push.example/abc')
  assert.strictEqual(c.p256dh, 'PK')
  assert.strictEqual(c.auth, 'AK')
})

test('cuerpoDeSuscripcion recorta el user_agent y no revienta sin el', () => {
  const largo = cuerpoDeSuscripcion({ subscription: SUB, cuenta: 'IND', userAgent: 'x'.repeat(500), usuarioId: null })
  assert.strictEqual(largo.user_agent.length, 300)
  const vacio = cuerpoDeSuscripcion({ subscription: SUB, cuenta: 'IND' })
  assert.strictEqual(vacio.user_agent, '')
  assert.strictEqual(vacio.usuario_id, null)
})
