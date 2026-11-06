import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizarTranscripcion, TRANSCRIPCION_MAX } from '../lib/transcripcion.js'

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
