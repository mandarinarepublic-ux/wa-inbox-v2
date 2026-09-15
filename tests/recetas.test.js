import test from 'node:test'
import assert from 'node:assert'
import { normalizarBotones, decidirReceta, piezasDeReceta, textoAvisoAnuncioNuevo, MAX_PIEZAS } from '../lib/recetas.js'

const H = 3600 * 1000
const AHORA = Date.parse('2026-09-14T15:00:00Z')
const hace = (h) => new Date(AHORA - h * H).toISOString()

const saludo = { id: 'r-saludo', text: '¡Hola! 🧡 Bienvenid@ a Mandarina.', botones: [], adjuntos: [{ tipo: 'imagen', url: 'https://x/logo.jpg', nombre: '' }] }
const pitch  = { id: 'r-dbz', text: '🐉 Chaquetas DBZ a $35', botones: [], adjuntos: [
  { tipo: 'imagen', url: 'https://x/1.jpg', nombre: '' }, { tipo: 'audio', url: 'https://x/voz.ogg', nombre: '' }, { tipo: 'documento', url: 'https://x/guia.pdf', nombre: 'guia.pdf' } ] }
const conBotones = { id: 'r-doom', text: '¿Negro o verde?', botones: ['Negro con verde', 'Verde completo'], adjuntos: [] }
const respuestas = [saludo, pitch, conBotones]

const receta = { id: 'r_1', nombre: 'DBZ', activa: true,
  pasos: [{ tipo: 'respuesta', respuestaId: 'r-saludo' }, { tipo: 'respuesta', respuestaId: 'r-dbz' }],
  pregunta: { texto: '¿Cuál te gustó?', botones: [{ title: '1' }, { title: '2' }, { title: '3' }] } }
const config = { recetas: { activo: true, lista: [receta], por_anuncio: { '120252247632190606': 'r_1', organico: 'r_1' } } }
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372', ultimaRecetaAt: null }
const base = { config, sourceId: '120252247632190606', esNuevo: true, contacto, botActivo: false, ahoraMs: AHORA }

test('anuncio con receta activa: sale la receta', () => {
  assert.equal(decidirReceta(base)?.id, 'r_1')
})
test('global apagado: nada', () => {
  assert.equal(decidirReceta({ ...base, config: { recetas: { ...config.recetas, activo: false } } }), null)
})
test('anuncio sin receta asignada: nada (decisión del dueño)', () => {
  assert.equal(decidirReceta({ ...base, sourceId: '999' }), null)
})
test('receta asignada pero inactiva: nada', () => {
  const cfg = { recetas: { ...config.recetas, lista: [{ ...receta, activa: false }] } }
  assert.equal(decidirReceta({ ...base, config: cfg }), null)
})
test('el bot va a contestar ese chat: nada', () => {
  assert.equal(decidirReceta({ ...base, botActivo: true }), null)
})
test('ya salió una receta hace 2 h: nada; hace 30 h: sale', () => {
  assert.equal(decidirReceta({ ...base, contacto: { ...contacto, ultimaRecetaAt: hace(2) } }), null)
  assert.equal(decidirReceta({ ...base, contacto: { ...contacto, ultimaRecetaAt: hace(30) } })?.id, 'r_1')
})
test('orgánico: solo si el contacto es NUEVO', () => {
  assert.equal(decidirReceta({ ...base, sourceId: '', esNuevo: true })?.id, 'r_1')
  assert.equal(decidirReceta({ ...base, sourceId: '', esNuevo: false }), null)
})
test('sin config no lanza', () => {
  assert.equal(decidirReceta({ ...base, config: null }), null)
})

test('piezas: texto → adjuntos en orden → pregunta con botones, todas con Canal y Nombre', () => {
  const p = piezasDeReceta({ receta, respuestas, contacto })
  assert.deepEqual(p.map(x => x.Mensaje || x.ImagenURL || x.AudioURL || x.DocURL || x.Cuerpo), [
    '¡Hola! 🧡 Bienvenid@ a Mandarina.', 'https://x/logo.jpg',
    '🐉 Chaquetas DBZ a $35', 'https://x/1.jpg', 'https://x/voz.ogg', 'https://x/guia.pdf',
    '¿Cuál te gustó?',
  ])
  assert.ok(p.every(x => x.Canal === '1024077200794372' && x.Telefono === '593999000111' && x.Nombre === 'Ana'))
  assert.equal(p[5].DocNombre, 'guia.pdf')
  const ult = p[6]
  assert.equal(ult.TipoMensaje, 'interactive_buttons')
  assert.deepEqual(JSON.parse(ult.Botones), [
    { type: 'reply', reply: { id: 'rc_1', title: '1' } },
    { type: 'reply', reply: { id: 'rc_2', title: '2' } },
    { type: 'reply', reply: { id: 'rc_3', title: '3' } },
  ])
})
test('piezas: una respuesta con botones propios sale como interactivo', () => {
  const r = { ...receta, pasos: [{ tipo: 'respuesta', respuestaId: 'r-doom' }], pregunta: null }
  const p = piezasDeReceta({ receta: r, respuestas, contacto })
  assert.equal(p.length, 1)
  assert.equal(p[0].TipoMensaje, 'interactive_buttons')
  assert.equal(p[0].Cuerpo, '¿Negro o verde?')
})
test('piezas: un paso huérfano (respuesta borrada) se salta sin romper', () => {
  const r = { ...receta, pasos: [{ tipo: 'respuesta', respuestaId: 'no-existe' }, { tipo: 'respuesta', respuestaId: 'r-saludo' }], pregunta: null }
  const p = piezasDeReceta({ receta: r, respuestas, contacto })
  assert.equal(p.length, 2)
  assert.equal(p[0].Mensaje, '¡Hola! 🧡 Bienvenid@ a Mandarina.')
})
test('piezas: pregunta sin botones válidos sale como texto plano; sin texto no sale', () => {
  const r1 = { ...receta, pasos: [], pregunta: { texto: '¿Talla?', botones: [{ title: '  ' }] } }
  assert.deepEqual(piezasDeReceta({ receta: r1, respuestas, contacto }).map(x => x.Mensaje), ['¿Talla?'])
  const r2 = { ...receta, pasos: [], pregunta: { texto: '', botones: [{ title: 'M' }] } }
  assert.equal(piezasDeReceta({ receta: r2, respuestas, contacto }).length, 0)
})
test(`piezas: tope de ${MAX_PIEZAS} piezas por receta`, () => {
  const conAdjuntos = { id: 'r-catalogo', text: 'Catálogo:', botones: [],
    adjuntos: Array.from({ length: 10 }, (_, i) => ({ tipo: 'imagen', url: `https://x/${i}.jpg`, nombre: '' })) }
  const soloTexto = (id, text) => ({ id, text, botones: [], adjuntos: [] })
  const respuestasLargas = [conAdjuntos, soloTexto('r-a', 'a'), soloTexto('r-b', 'b'), soloTexto('r-c', 'c')]
  const recetaLarga = { id: 'r_larga', nombre: 'Larga', activa: true,
    pasos: [
      { tipo: 'respuesta', respuestaId: 'r-catalogo' },
      { tipo: 'respuesta', respuestaId: 'r-a' },
      { tipo: 'respuesta', respuestaId: 'r-b' },
      { tipo: 'respuesta', respuestaId: 'r-c' },
    ],
    pregunta: { texto: '¿Cuál te gustó?', botones: [] } }
  const p = piezasDeReceta({ receta: recetaLarga, respuestas: respuestasLargas, contacto })
  assert.equal(p.length, MAX_PIEZAS)
})
test('el alias manda sobre el nombre de Meta', () => {
  const p = piezasDeReceta({ receta, respuestas, contacto: { ...contacto, alias: 'Anita' } })
  assert.equal(p[0].Nombre, 'Anita')
})
test('botones: recorte a 20 letras, máximo 3, sin vacíos, acepta strings', () => {
  assert.deepEqual(normalizarBotones(['Sí', { title: '   ' }, { title: 'Quiero más información por favor' }, 'x', 'y']),
    [{ id: 'rc_1', title: 'Sí' }, { id: 'rc_2', title: 'Quiero más informaci' }, { id: 'rc_3', title: 'x' }])
})
test('aviso de anuncio nuevo: trae cuenta, titular, id y enlace', () => {
  const t = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'Hoodie Luffy', sourceId: '120253', url: 'https://inbox.apps.mandarinaec.com/?tab=autos' })
  assert.match(t, /Anuncio NUEVO en MANDI/)
  assert.match(t, /Hoodie Luffy/)
  assert.match(t, /120253/)
  assert.match(t, /tab=autos/)
})
test('aviso de anuncio nuevo: sin receta pide configurarla; con receta avisa que ya tiene', () => {
  const sinReceta = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'Hoodie Luffy', sourceId: '120253', url: 'https://x' })
  assert.match(sinReceta, /Sin receta: nadie le contesta solo/)
  const conReceta = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'Hoodie Luffy', sourceId: '120253', url: 'https://x', tieneReceta: true })
  assert.match(conReceta, /Ya tiene receta asignada\./)
  assert.doesNotMatch(conReceta, /Sin receta/)
})
test('aviso de anuncio nuevo: tipo post cambia el rótulo, anuncio de pauta no', () => {
  const post = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'x', sourceId: '1', url: 'https://x', tipo: 'post' })
  assert.match(post, /Publicación NUEVA en MANDI/)
  const ad = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'x', sourceId: '1', url: 'https://x', tipo: 'ad' })
  assert.match(ad, /Anuncio NUEVO en MANDI/)
})
test('aviso de anuncio nuevo: escapa HTML del titular', () => {
  const t = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: '<b>x</b> & y', sourceId: '1', url: 'https://x' })
  assert.match(t, /&lt;b&gt;x&lt;\/b&gt; &amp; y/)
})
