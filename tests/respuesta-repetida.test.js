// Que una respuesta rápida no salga DOS veces por un clic de más.
//
// Medido el 23-sep-2026: en MANDI, 2 veces en 30 días. En IND, con el mismo
// código: 17 veces salió el mismo texto dos
// veces seguidas al mismo cliente en menos de un minuto — 6 de ellas en menos
// de 10 s (doble clic antes de que la pantalla reaccione) y varias con 20
// fotos alrededor (una respuesta de 10 fotos mandada dos veces).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claveRespuesta, decidirRespuestaRapida, haceTexto, VENTANA_REPETIDA_MS } from '../lib/respuesta-repetida.js'

const AHORA = Date.parse('2026-09-23T21:10:00Z')
const hace = (ms) => new Date(AHORA - ms).toISOString()
const FOTO_A = 'https://x.supabase.co/storage/v1/object/public/inbox-media/respuestas/IND/a.jpg'
const FOTO_B = 'https://x.supabase.co/storage/v1/object/public/inbox-media/respuestas/IND/b.jpg'
const FOTO_C = 'https://x.supabase.co/storage/v1/object/public/inbox-media/respuestas/IND/c.jpg'

const bienvenida = { id: 'r1', text: 'Somos especialistas en personalizados ✨', adjuntos: [{ tipo: 'imagen', url: FOTO_A }, { tipo: 'imagen', url: FOTO_B }] }
const soloFotos  = { id: 'r2', text: '', adjuntos: [{ tipo: 'imagen', url: FOTO_A }, { tipo: 'imagen', url: FOTO_C }] }

const saliente = (mensaje, ms, mediaUrl = '') => ({ direccion: 'SALIENTE', mensaje, mediaUrl, timestamp: hace(ms) })

test('la primera vez se manda', () => {
  const d = decidirRespuestaRapida({ registro: undefined, msgs: [], reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'enviar')
})

test('☠️ doble clic: si ya está saliendo, el segundo clic NO manda nada', () => {
  // Este es el caso de 0,0 s: el candado viejo vivía en el estado de React y el
  // segundo clic llegaba antes de que se actualizara.
  const d = decidirRespuestaRapida({ registro: { estado: 'enviando', at: AHORA - 300 }, msgs: [], reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'en_vuelo')
})

test('recién mandada desde esta pantalla → pide confirmación', () => {
  const d = decidirRespuestaRapida({ registro: { estado: 'enviada', at: AHORA - 25_000 }, msgs: [], reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'confirmar')
  assert.equal(d.haceMs, 25_000)
})

test('mandada desde OTRA pantalla o antes de recargar: se ve en el hilo → pide confirmación', () => {
  const msgs = [saliente('Somos especialistas en personalizados ✨', 40_000)]
  const d = decidirRespuestaRapida({ registro: undefined, msgs, reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'confirmar')
  assert.equal(d.haceMs, 40_000)
})

test('el texto se compara sin espacios de sobra en los bordes', () => {
  const msgs = [saliente('  Somos especialistas en personalizados ✨\n', 40_000)]
  assert.equal(decidirRespuestaRapida({ msgs, reply: bienvenida, ahora: AHORA }).accion, 'confirmar')
})

test('fuera de la ventana ya no pregunta: el cliente puede necesitarla otra vez', () => {
  const msgs = [saliente('Somos especialistas en personalizados ✨', VENTANA_REPETIDA_MS + 1_000)]
  const d = decidirRespuestaRapida({ registro: { estado: 'enviada', at: AHORA - VENTANA_REPETIDA_MS - 1_000 }, msgs, reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'enviar')
})

test('si el CLIENTE escribió ese mismo texto, no cuenta como enviado', () => {
  const msgs = [{ direccion: 'ENTRANTE', mensaje: 'Somos especialistas en personalizados ✨', timestamp: hace(5_000) }]
  assert.equal(decidirRespuestaRapida({ msgs, reply: bienvenida, ahora: AHORA }).accion, 'enviar')
})

test('respuesta de solo fotos: pregunta si TODAS sus fotos ya salieron', () => {
  const msgs = [saliente('', 30_000, FOTO_A), saliente('', 29_000, FOTO_C)]
  assert.equal(decidirRespuestaRapida({ msgs, reply: soloFotos, ahora: AHORA }).accion, 'confirmar')
})

test('dos respuestas DISTINTAS que comparten fotos NO se frenan entre sí', () => {
  // Caso real 23-sep, 21:09: "+54 colores…" y "Somos especialistas…" comparten 2
  // fotos. Mandar la segunda después de la primera es trabajo normal, no un error.
  const msgs = [saliente('+54 colores, tallas de XS a 5XL', 20_000), saliente('', 19_000, FOTO_A), saliente('', 18_000, FOTO_B)]
  assert.equal(decidirRespuestaRapida({ msgs, reply: bienvenida, ahora: AHORA }).accion, 'enviar')
  // Y una de solo fotos con UNA foto repetida tampoco: faltan las demás.
  assert.equal(decidirRespuestaRapida({ msgs, reply: soloFotos, ahora: AHORA }).accion, 'enviar')
})

test('una respuesta sin texto ni adjuntos no se frena por el hilo', () => {
  assert.equal(decidirRespuestaRapida({ msgs: [saliente('', 1_000)], reply: { id: 'r3' }, ahora: AHORA }).accion, 'enviar')
})

test('la clave separa por cliente y por respuesta', () => {
  assert.notEqual(claveRespuesta('593991', bienvenida), claveRespuesta('593992', bienvenida))
  assert.notEqual(claveRespuesta('593991', bienvenida), claveRespuesta('593991', soloFotos))
  assert.equal(claveRespuesta('593991', bienvenida), claveRespuesta('593991', { ...bienvenida }))
})

test('una respuesta sin id se identifica por su texto', () => {
  assert.equal(claveRespuesta('593991', { text: 'Hola' }), claveRespuesta('593991', { text: 'Hola' }))
  assert.notEqual(claveRespuesta('593991', { text: 'Hola' }), claveRespuesta('593991', { text: 'Chao' }))
})

test('el hace-cuánto se lee en humano', () => {
  assert.equal(haceTexto(4_000), 'unos segundos')
  assert.equal(haceTexto(25_000), '25 segundos')
  assert.equal(haceTexto(60_000), '1 minuto')
  assert.equal(haceTexto(7 * 60_000 + 10_000), '7 minutos')
})

test('si la última vez salió A MEDIAS, se vuelve a mandar sin preguntar', () => {
  // El texto sí salió (está en el hilo) pero una foto no: reenviar es justo lo
  // que tiene que hacer el vendedor, no un error que haya que confirmar.
  const msgs = [saliente('Somos especialistas en personalizados ✨', 20_000)]
  const d = decidirRespuestaRapida({ registro: { estado: 'fallida', at: AHORA - 15_000 }, msgs, reply: bienvenida, ahora: AHORA })
  assert.equal(d.accion, 'enviar')
})
