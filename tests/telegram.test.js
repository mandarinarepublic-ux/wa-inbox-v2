import test from 'node:test'
import assert from 'node:assert'
import { telegramConfigurado, enviarTelegram } from '../lib/telegram.js'

// Las pruebas corren sin TELEGRAM_BOT_TOKEN ni TELEGRAM_CHAT_ID, que es
// exactamente el estado en que esto se despliega: vivo y mudo.

test('sin variables, no esta configurado', () => {
  assert.equal(telegramConfigurado(), false)
})

test('sin variables, enviar es un no-op que NO lanza', async () => {
  const r = await enviarTelegram('hola')
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'sin-config')
})

test('un fallo de red no lanza nunca', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => { throw new Error('red caida') }
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, false)
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})

// `fetch` NO lanza con 4xx/5xx: devuelve una respuesta con ok=false. Si nadie
// mira `res.ok`, un token equivocado se ve exactamente igual que un envio bueno.
test('un 401 de Telegram se reporta como fallo, no como exito', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' })
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, false, 'un 401 NO puede reportarse como ok')
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})

test('con variables y 200, reporta exito', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, true)
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})
