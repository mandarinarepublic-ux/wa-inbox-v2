// "debe respetar el orden en el que cargué los adjuntos" — Rodrigo, 21-ago.
//
// WhatsApp entrega cada adjunto como un mensaje aparte, así que el orden en que
// salen es el orden en que el cliente los ve. Reordenar por tipo —todas las fotos
// y después los audios— sería decidir por el vendedor cómo se cuenta lo que
// quiere contar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adjuntosDeRespuesta, guardarAdjuntos, urlEsAudio, tipoDeUrl, TOPE_ADJUNTOS } from '../lib/adjuntos-respuesta.js'

const FOTO1 = 'https://x.supabase.co/storage/v1/object/public/inbox-media/fotos/MANDI/a.jpg'
const FOTO2 = 'https://x.supabase.co/storage/v1/object/public/inbox-media/fotos/MANDI/b.jpg'
const AUDIO = 'https://x.supabase.co/storage/v1/object/public/inbox-media/audios/MANDI/c.ogg'

test('reconoce un audio por su extensión y por su carpeta', () => {
  assert.ok(urlEsAudio(AUDIO))
  assert.ok(urlEsAudio('https://x/algo.mp3'))
  assert.ok(urlEsAudio('https://x/audios/MANDI/sin-extension'))
  assert.ok(!urlEsAudio(FOTO1))
})

test('el orden se respeta tal cual: foto, audio, foto', () => {
  // El caso que pidió Rodrigo. Si esto se ordenara por tipo, la voz que él puso
  // en medio saldría al final y la respuesta contaría otra historia.
  const r = { adjuntos: [
    { tipo: 'imagen', url: FOTO1 },
    { tipo: 'audio',  url: AUDIO },
    { tipo: 'imagen', url: FOTO2 },
  ]}
  assert.deepEqual(adjuntosDeRespuesta(r).map(a => a.tipo), ['imagen', 'audio', 'imagen'])
  assert.deepEqual(adjuntosDeRespuesta(r).map(a => a.url),  [FOTO1, AUDIO, FOTO2])
})

test('el audio puede ir PRIMERO si así se cargó', () => {
  const r = { adjuntos: [{ tipo: 'audio', url: AUDIO }, { tipo: 'imagen', url: FOTO1 }] }
  assert.equal(adjuntosDeRespuesta(r)[0].tipo, 'audio')
})

test('las respuestas VIEJAS siguen funcionando', () => {
  // Sin este respaldo, todas las respuestas rápidas que ya existen se habrían
  // quedado sin fotos el día del despliegue. Una migración que borra lo que ya
  // funciona no es una migración.
  const vieja = { imageUrl: FOTO1, imageUrl2: FOTO2 }
  const r = adjuntosDeRespuesta(vieja)
  assert.equal(r.length, 2)
  assert.ok(r.every(a => a.tipo === 'imagen'))
})

test('un audio guardado por error en la lista vieja NO se manda como foto', () => {
  // Una versión intermedia pudo dejar un .ogg en `imagenes`. Mandarlo como foto
  // es un mensaje muerto; se detecta por la url.
  const r = adjuntosDeRespuesta({ imagenes: [FOTO1, AUDIO] })
  assert.deepEqual(r.map(a => a.tipo), ['imagen', 'audio'])
})

test('al guardar, las fotos quedan TAMBIÉN en la lista vieja — IND las lee', () => {
  const g = guardarAdjuntos([
    { tipo: 'imagen', url: FOTO1 },
    { tipo: 'audio',  url: AUDIO },
    { tipo: 'imagen', url: FOTO2 },
  ])
  assert.equal(g.adjuntos.length, 3, 'la lista ordenada lleva todo')
  assert.deepEqual(g.imagenes, [FOTO1, FOTO2], 'la vieja lleva SOLO fotos')
  assert.ok(!g.imagenes.includes(AUDIO), 'un audio en `imagenes` haría que IND lo mande como foto')
})

test('no se guarda basura: urls vacías fuera', () => {
  const g = guardarAdjuntos([{ tipo: 'imagen', url: '' }, { tipo: 'audio', url: '  ' }, { tipo: 'imagen', url: FOTO1 }])
  assert.equal(g.adjuntos.length, 1)
})

test('el tope de 10 lo comparten fotos y audios', () => {
  const muchos = Array.from({ length: 14 }, (_, i) => ({ tipo: 'imagen', url: `${FOTO1}?${i}` }))
  assert.equal(guardarAdjuntos(muchos).adjuntos.length, TOPE_ADJUNTOS)
  assert.equal(adjuntosDeRespuesta({ adjuntos: muchos }).length, TOPE_ADJUNTOS)
})

test('una respuesta sin adjuntos no revienta', () => {
  assert.deepEqual(adjuntosDeRespuesta({}), [])
  assert.deepEqual(adjuntosDeRespuesta(), [])
  assert.deepEqual(guardarAdjuntos().adjuntos, [])
})

// ── DOCUMENTOS en una respuesta rapida ────────────────────────────
const DOC = 'https://x.supabase.co/storage/v1/object/public/inbox-media/documentos/MANDI/uuid-1.pdf'

test('un documento sobrevive guardar y volver a leer, CON su nombre', () => {
  const g = guardarAdjuntos([{ tipo: 'documento', url: DOC, nombre: 'Catálogo 2026.pdf' }])
  assert.strictEqual(g.adjuntos.length, 1)
  assert.strictEqual(g.adjuntos[0].tipo, 'documento')
  assert.strictEqual(g.adjuntos[0].nombre, 'Catálogo 2026.pdf')

  const leido = adjuntosDeRespuesta({ adjuntos: g.adjuntos })
  assert.strictEqual(leido[0].tipo, 'documento')
  assert.strictEqual(leido[0].nombre, 'Catálogo 2026.pdf')
})

// ☠️ LA prueba de este cambio. `imagenes` la lee el OTRO inbox: si un documento
// entra ahi, lo mandaria como FOTO y Meta lo rechazaria. Mismo motivo por el que
// los audios tampoco entran.
test('un documento NO entra en la columna imagenes', () => {
  const g = guardarAdjuntos([
    { tipo: 'imagen', url: FOTO1 },
    { tipo: 'documento', url: DOC, nombre: 'lista.pdf' },
    { tipo: 'audio', url: AUDIO },
  ])
  assert.deepEqual(g.imagenes, [FOTO1])
  assert.strictEqual(g.adjuntos.length, 3)
})

test('el ORDEN se respeta con los tres tipos mezclados', () => {
  const g = guardarAdjuntos([
    { tipo: 'documento', url: DOC, nombre: 'a.pdf' },
    { tipo: 'imagen', url: FOTO1 },
    { tipo: 'audio', url: AUDIO },
  ])
  assert.deepEqual(g.adjuntos.map(a => a.tipo), ['documento', 'imagen', 'audio'])
})

// Un tipo que no se reconoce cae a imagen (es lo que habia antes de que
// existieran los otros dos), pero NUNCA al reves: un documento no puede
// terminar tratado como foto.
test('un tipo desconocido cae a imagen, y documento nunca se pierde', () => {
  const g = guardarAdjuntos([{ tipo: 'vaya-a-saber', url: FOTO1 }, { tipo: 'documento', url: DOC }])
  assert.strictEqual(g.adjuntos[0].tipo, 'imagen')
  assert.strictEqual(g.adjuntos[1].tipo, 'documento')
})

test('un documento sin nombre guardado no revienta al leerlo', () => {
  const leido = adjuntosDeRespuesta({ adjuntos: [{ tipo: 'documento', url: DOC }] })
  assert.strictEqual(leido[0].tipo, 'documento')
  assert.strictEqual(typeof leido[0].nombre, 'string')
})

// ── tipoDeUrl: el respaldo de las respuestas VIEJAS ───────────────
test('tipoDeUrl reconoce los tres por carpeta y extension', () => {
  assert.strictEqual(tipoDeUrl(AUDIO), 'audio')
  assert.strictEqual(tipoDeUrl(DOC), 'documento')
  assert.strictEqual(tipoDeUrl(FOTO1), 'imagen')
})

test('una respuesta VIEJA con un pdf colado en imagenes no se manda como foto', () => {
  const leido = adjuntosDeRespuesta({ imagenes: [FOTO1, DOC] })
  assert.deepEqual(leido.map(a => a.tipo), ['imagen', 'documento'])
})
