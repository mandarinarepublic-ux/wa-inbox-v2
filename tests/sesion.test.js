// El CRM firma la cookie y este inbox la verifica. Si estas pruebas fallan,
// nadie puede entrar al inbox aunque el login del CRM funcione.
import test from 'node:test'
import assert from 'node:assert'
import { firmarSesion, verificarSesion, COOKIE_SESION } from '../lib/sesion.js'

const SECRETO = 'secreto-de-prueba-no-es-el-de-produccion'

test('un token firmado con el mismo secreto se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO)
  const datos = await verificarSesion(token, SECRETO)
  assert.strictEqual(datos.id, 'U1')
  assert.strictEqual(datos.rol, 'ADMIN')
})

test('con OTRO secreto no se verifica', async () => {
  // Es el caso real de tener SESSION_SECRET distinto en los dos proyectos de Vercel.
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO)
  assert.strictEqual(await verificarSesion(token, 'otro-secreto'), null)
})

test('un token alterado no se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'VENDEDOR' }, SECRETO)
  const [cuerpo, firma] = token.split('.')
  const falso = Buffer.from(JSON.stringify({ id: 'U1', rol: 'ADMIN', exp: Date.now() + 1e6 }))
    .toString('base64url')
  assert.strictEqual(await verificarSesion(`${falso}.${firma}`, SECRETO), null)
})

test('un token caducado no se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO, -1)
  assert.strictEqual(await verificarSesion(token, SECRETO), null)
})

test('basura y vacío devuelven null, sin lanzar', async () => {
  assert.strictEqual(await verificarSesion('', SECRETO), null)
  assert.strictEqual(await verificarSesion('no-es-un-token', SECRETO), null)
  assert.strictEqual(await verificarSesion(null, SECRETO), null)
})

test('el nombre de la cookie es el mismo que emite el CRM', () => {
  // Si esto cambia, el inbox busca una cookie que nadie pone.
  assert.strictEqual(COOKIE_SESION, 'mp_sesion')
})
