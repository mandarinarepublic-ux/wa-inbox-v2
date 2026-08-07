// El detector de sesión caída. Si estas pruebas fallan, o el aviso no sale
// cuando toca (y se pierden mensajes en silencio, como el 7-ago), o sale cuando
// no toca (y manda al login a alguien que estaba trabajando bien).
import test from 'node:test'
import assert from 'node:assert'

// Monta un `window` de mentira con un fetch que responde el código que le pidas,
// y devuelve el módulo recién cargado (import con cache-buster para que cada
// prueba arranque con su propio estado interno).
async function montar(respuestas) {
  const llamadas = []
  globalThis.window = {
    location: { href: 'https://inbox.apps.mandarinaec.com/inbox', origin: 'https://inbox.apps.mandarinaec.com' },
    fetch: async (input) => {
      llamadas.push(input)
      const url = typeof input === 'string' ? input : input.url
      return { status: respuestas[url] ?? 200 }
    },
  }
  window.fetch.bind = function (o) { const f = this; return (...a) => f.apply(o, a) }
  const mod = await import(`../lib/sesion-caida.js?v=${Math.random()}`)
  mod.vigilarSesion()
  return { mod, llamadas }
}

test('un 401 en una ruta nuestra levanta el aviso', async () => {
  const { mod } = await montar({ '/api/saliente': 401 })
  let avisado = false
  mod.alCaerLaSesion(() => { avisado = true })
  await window.fetch('/api/saliente', { method: 'POST' })
  assert.strictEqual(avisado, true)
  assert.strictEqual(mod.sesionCaida(), true)
})

test('un 403 (sesión sin permiso) también lo levanta', async () => {
  const { mod } = await montar({ '/api/lista': 403 })
  await window.fetch('/api/lista')
  assert.strictEqual(mod.sesionCaida(), true)
})

test('una respuesta buena NO lo levanta', async () => {
  const { mod } = await montar({ '/api/saliente': 200 })
  await window.fetch('/api/saliente', { method: 'POST' })
  assert.strictEqual(mod.sesionCaida(), false)
})

test('un 500 no es problema de sesión', async () => {
  // Un error del servidor no significa que tengas que volver a entrar; mandar al
  // login por un 500 sería peor que no avisar nada.
  const { mod } = await montar({ '/api/saliente': 500 })
  await window.fetch('/api/saliente', { method: 'POST' })
  assert.strictEqual(mod.sesionCaida(), false)
})

test('un 401 de una URL EXTERNA no lo levanta', async () => {
  // La subida firmada a Supabase Storage es de otro origen y puede dar 401 por
  // sus propios motivos. Eso no dice nada de nuestra sesión.
  const externa = 'https://piingkecjgoisnxccvaa.supabase.co/storage/v1/object/inbox-media/x.jpg'
  const { mod } = await montar({ [externa]: 401 })
  await window.fetch(externa, { method: 'PUT' })
  assert.strictEqual(mod.sesionCaida(), false)
})

test('un 401 fuera de /api tampoco', async () => {
  const { mod } = await montar({ '/inbox': 401 })
  await window.fetch('/inbox')
  assert.strictEqual(mod.sesionCaida(), false)
})

test('avisa UNA sola vez aunque fallen 30 peticiones', async () => {
  // El inbox dispara decenas de llamadas por minuto; 30 avisos serían inusables.
  const { mod } = await montar({ '/api/inbox-sync': 401 })
  let veces = 0
  mod.alCaerLaSesion(() => { veces++ })
  for (let i = 0; i < 30; i++) await window.fetch('/api/inbox-sync')
  assert.strictEqual(veces, 1)
})

test('quien se suscribe DESPUÉS de la caída igual se entera', async () => {
  // El aviso se monta con la pantalla; si la sesión se cayó en el primer
  // sondeo, antes de montarse, no puede perderse el mensaje.
  const { mod } = await montar({ '/api/lista': 401 })
  await window.fetch('/api/lista')
  let avisado = false
  mod.alCaerLaSesion(() => { avisado = true })
  assert.strictEqual(avisado, true)
})

test('la respuesta se devuelve intacta', async () => {
  // El interceptor NO puede alterar lo que recibe quien llamó.
  const { mod } = await montar({ '/api/hilo': 401 })
  const res = await window.fetch('/api/hilo')
  assert.strictEqual(res.status, 401)
})

test('enganchar dos veces no encadena dos parches', async () => {
  const { mod } = await montar({ '/api/lista': 401 })
  const tras1 = window.fetch
  mod.vigilarSesion()
  assert.strictEqual(window.fetch, tras1, 'vigilarSesion() tiene que ser idempotente')
})
