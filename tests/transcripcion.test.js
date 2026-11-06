import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizarTranscripcion, TRANSCRIPCION_MAX } from '../lib/transcripcion.js'
import { esComputadora } from '../lib/transcribir-navegador.js'

test('normalizarTranscripcion limpia los espacios que deja Whisper', () => {
  assert.equal(normalizarTranscripcion('  hola, ¿tienen talla M?  '), 'hola, ¿tienen talla M?')
})

test('normalizarTranscripcion quita las marcas de cambio de voz', () => {
  assert.equal(normalizarTranscripcion(' >> Joven, buenas tardes. >> Hola'), 'Joven, buenas tardes. Hola')
  assert.equal(normalizarTranscripcion(' -Cámbiame, por favor.'), 'Cámbiame, por favor.')
})

test('normalizarTranscripcion: silencio o basura no se guardan', () => {
  assert.equal(normalizarTranscripcion('   '), '')
  assert.equal(normalizarTranscripcion(null), '')
  assert.equal(normalizarTranscripcion({ text: 'x' }), '')
})

test('normalizarTranscripcion respeta el tope', () => {
  assert.equal(normalizarTranscripcion('a'.repeat(TRANSCRIPCION_MAX + 5)).length, TRANSCRIPCION_MAX)
})

test('transcribir solo se ofrece en compu', () => {
  const windows = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', maxTouchPoints: 0 }
  const laptopTactil = { ...windows, maxTouchPoints: 10 }
  const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', maxTouchPoints: 0 }
  assert.equal(esComputadora(windows), true)
  assert.equal(esComputadora(laptopTactil), true)
  assert.equal(esComputadora(mac), true)

  assert.equal(esComputadora({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A155M) Chrome/130.0 Mobile Safari/537.36' }), false)
  assert.equal(esComputadora({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1' }), false)
  assert.equal(esComputadora({ ...mac, maxTouchPoints: 5 }), false) // iPad que se hace pasar por Mac
  assert.equal(esComputadora({ ...windows, userAgentData: { mobile: true } }), false)
})

// Un Worker que recibe el HTML del login en vez del JS falla con un error que no se
// parece en nada a "te falta sesión" (mismo trato que opus/).
test('el Worker de transcripción queda fuera del candado', () => {
  assert.match(readFileSync(new URL('../middleware.js', import.meta.url), 'utf8'), /\|transcribir\/\|/)
})

// El poll lee COLS_MSG: sin la columna ahí, el texto guardado no le llega a nadie más.
test('la lectura de mensajes trae y entrega la transcripción', () => {
  const src = readFileSync(new URL('../lib/inbox-supabase.js', import.meta.url), 'utf8')
  assert.match(src, /const COLS_MSG = '[^']*\btranscripcion\b/)
  assert.match(src, /transcripcion:\s+m\.transcripcion/)
})
