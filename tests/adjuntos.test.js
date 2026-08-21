// Pegar (Ctrl+V) y arrastrar entran a la MISMA tubería que el 📎. Esto prueba
// las decisiones de esa tubería, que son donde estaban las trampas.
import test from 'node:test'
import assert from 'node:assert'
import { decidirPegado, decidirAdjuntos, extDeNombre, TOPE_FOTOS } from '../lib/adjuntos.js'

const foto  = (n = 'a.jpg') => ({ name: n, type: 'image/jpeg' })
const clip  = (n = 'a.mp4') => ({ name: n, type: 'video/mp4' })
const pdf   = (n = 'a.pdf') => ({ name: n, type: 'application/pdf' })

// ── Ctrl+V: ¿texto o adjunto? ──────────────────────────────────────
test('pegar texto normal sigue siendo texto', () => {
  assert.strictEqual(decidirPegado({ tieneArchivos: false, texto: 'hola' }), 'texto')
})

test('pegar una captura de pantalla adjunta', () => {
  assert.strictEqual(decidirPegado({ tieneArchivos: true, texto: '' }), 'adjuntar')
})

test('copiar de Excel/Sheets pega el TEXTO, no la captura de las celdas', () => {
  // La trampa: Windows deja texto Y una imagen de las celdas. Si ganara el
  // archivo, copiar un número de pedido de una hoja le mandaría al cliente una
  // foto de la hoja.
  assert.strictEqual(decidirPegado({ tieneArchivos: true, texto: 'MAN-AND-5563' }), 'texto')
})

test('el texto en blanco no cuenta como texto', () => {
  assert.strictEqual(decidirPegado({ tieneArchivos: true, texto: '   \n ' }), 'adjuntar')
})

test('un pegado vacío no rompe nada', () => {
  assert.strictEqual(decidirPegado({}), 'texto')
})

// ── Qué hacer con los archivos que entran ──────────────────────────
test('sin archivos no se hace nada y no se avisa nada', () => {
  const r = decidirAdjuntos({ entrantes: [] })
  assert.strictEqual(r.accion, 'nada')
  assert.strictEqual(r.aviso, '')
})

test('con la caja vacía, las fotos entran', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [foto(), foto('b.jpg')] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.tipo, 'imagen')
  assert.strictEqual(r.archivos.length, 2)
})

test('pegar dos veces SUMA (no reemplaza la anterior)', () => {
  // Es el caso real: una captura, Ctrl+V, otra captura, Ctrl+V → dos fotos.
  const r = decidirAdjuntos({ actuales: 1, entrantes: [foto('b.jpg')] })
  assert.strictEqual(r.accion, 'agregar')
  assert.strictEqual(r.archivos.length, 1)
  assert.strictEqual(r.aviso, '')
})

test('un PDF ahora se manda como DOCUMENTO', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [pdf()] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.tipo, 'documento')
  assert.strictEqual(r.archivos.length, 1)
})

// ☠️ Esta prueba existe para que nadie reponga una lista blanca de tipos.
// Es la quinta vez en este repo que una lista blanca esconde algo en silencio
// (ver el filtro de pintable): lo que no se reconoce se MANDA, no se descarta.
test('un tipo INVENTADO tambien sale como documento, no se descarta', () => {
  const raro = { name: 'plano.dwg', type: 'application/acad' }
  const r = decidirAdjuntos({ actuales: 0, entrantes: [raro] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.tipo, 'documento')
  assert.strictEqual(r.archivos[0].name, 'plano.dwg')
})

test('un archivo SIN tipo ni extension sale como documento', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [{ name: 'sinnombre', type: '' }] })
  assert.strictEqual(r.tipo, 'documento')
})

test('el documento va SOLO: si vienen dos, se manda el primero y se avisa', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [pdf('uno.pdf'), pdf('dos.pdf')] })
  assert.strictEqual(r.tipo, 'documento')
  assert.strictEqual(r.archivos.length, 1)
  assert.strictEqual(r.archivos[0].name, 'uno.pdf')
  assert.match(r.aviso, /va solo/)
})

// ☠️ El documento entra ULTIMO a proposito. Si ganara, arrastrar una carpeta con
// fotos y un readme.txt mandaria el readme e ignoraria las fotos.
test('si hay fotos Y un documento, ganan las FOTOS', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [foto('a.jpg'), foto('b.jpg'), pdf()] })
  assert.strictEqual(r.tipo, 'imagen')
  assert.strictEqual(r.archivos.length, 2)
})

test('un video le gana al documento', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [pdf(), clip()] })
  assert.strictEqual(r.tipo, 'video')
})

test('si vienen mezclados, se toman las fotos y se avisa del resto', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [foto(), pdf()] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.archivos.length, 1)
  assert.match(r.aviso, /un documento va solo/)
})

test('el video va SOLO y se lleva por delante lo que hubiera', () => {
  const r = decidirAdjuntos({ actuales: 3, entrantes: [clip()] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.tipo, 'video')
  assert.strictEqual(r.archivos.length, 1)
})

test('video + fotos a la vez: gana el video y se avisa', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [foto(), clip()] })
  assert.strictEqual(r.tipo, 'video')
  assert.strictEqual(r.archivos.length, 1)
  assert.match(r.aviso, /El video va solo/)
})

test('si lo que había era un video, las fotos lo REEMPLAZAN', () => {
  // No se pueden sumar: el envío de video es otro camino y de a uno.
  const r = decidirAdjuntos({ actuales: 1, esVideoActual: true, entrantes: [foto()] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.tipo, 'imagen')
})

test('no se pasa del tope de la tanda', () => {
  const muchas = Array.from({ length: 14 }, (_, i) => foto(`f${i}.jpg`))
  const r = decidirAdjuntos({ actuales: 0, entrantes: muchas })
  assert.strictEqual(r.archivos.length, TOPE_FOTOS)
  assert.match(r.aviso, /Solo caben 10 fotos/)
})

test('sumando tampoco se pasa del tope: solo entra lo que cabe', () => {
  const r = decidirAdjuntos({ actuales: 8, entrantes: [foto(), foto('b.jpg'), foto('c.jpg')] })
  assert.strictEqual(r.accion, 'agregar')
  assert.strictEqual(r.archivos.length, 2)
  assert.match(r.aviso, /se agregaron 2/)
})

test('con la tanda llena no entra nada, pero se avisa', () => {
  const r = decidirAdjuntos({ actuales: TOPE_FOTOS, entrantes: [foto()] })
  assert.strictEqual(r.accion, 'nada')
  assert.match(r.aviso, /Ya tienes 10 fotos/)
})

// ── Audio: nota de voz ────────────────────────────────────────────────────────
//
// Los audios entran por las mismas tres puertas que las fotos (clip, arrastrar,
// Ctrl+V) y van SOLOS, igual que el video: se mandan por otro camino (`sendAudio`,
// que además convierte a OGG/Opus) y de a uno.
//
// Antes de esto, soltar un MP3 en el chat no hacía absolutamente nada: el filtro
// lo descartaba en silencio y parecía que el inbox estaba roto.

test('un audio se acepta y va SOLO', () => {
  const r = decidirAdjuntos({ entrantes: [{ name: 'saludo.mp3', type: 'audio/mpeg' }] })
  assert.equal(r.accion, 'reemplazar')
  assert.equal(r.tipo, 'audio')
  assert.equal(r.archivos.length, 1)
})

test('el audio de Fish Audio entra aunque Windows lo marque como video', () => {
  // Fish Audio suelta `.mp3.mpeg` y Windows lo marca `video/mpeg`. Si se mirara
  // solo el tipo, se intentaría mandar como VIDEO y Meta lo rechazaría.
  const r = decidirAdjuntos({ entrantes: [{ name: 'Goku-2026-08-21.mp3.mpeg', type: 'video/mpeg' }] })
  assert.equal(r.tipo, 'audio')
})

test('el audio se lleva por delante las fotos que hubiera', () => {
  const r = decidirAdjuntos({
    actuales: 3,
    entrantes: [{ name: 'nota.ogg', type: 'audio/ogg' }],
  })
  assert.equal(r.accion, 'reemplazar')
  assert.equal(r.tipo, 'audio')
})

test('si entra audio junto con fotos, manda el audio y se avisa', () => {
  const r = decidirAdjuntos({
    entrantes: [
      { name: 'foto.jpg', type: 'image/jpeg' },
      { name: 'nota.mp3', type: 'audio/mpeg' },
    ],
  })
  assert.equal(r.tipo, 'audio')
  assert.match(r.aviso, /solo/i)
})

test('ya no existe el rechazo POR TIPO: un pdf que antes se rechazaba ahora sale', () => {
  // Esta prueba reemplaza a la del aviso "eso no sirve". Ese aviso desaparecio
  // a proposito: no queda ningun tipo de archivo que el inbox rechace.
  const r = decidirAdjuntos({ entrantes: [{ name: 'hoja.pdf', type: 'application/pdf' }] })
  assert.notEqual(r.accion, 'nada')
  assert.strictEqual(r.tipo, 'documento')
  assert.strictEqual(r.aviso, '')
})

// ── La extension con la que se guarda un documento ────────────────
test('extDeNombre saca la extension de un nombre normal', () => {
  assert.strictEqual(extDeNombre('PROFORMA-5601.pdf'), 'pdf')
  assert.strictEqual(extDeNombre('lista de precios.XLSX'), 'xlsx')
  assert.strictEqual(extDeNombre('plano.dwg'), 'dwg')
})

// ☠️ Este valor termina DENTRO de la ruta del archivo en el bucket. Si dejara
// pasar barras o puntos, un nombre de archivo podria escribir donde no debe.
test('extDeNombre no deja escapar de la carpeta', () => {
  // Lo que importa no es QUE devuelve sino que lo que devuelve no pueda ser un
  // path: nada de barras, puntos o espacios, pase lo que pase.
  const hostiles = [
    'x.../../../etc/passwd',
    'a.pdf/../../otro',
    'a.p/d\f',
    'a.p..f',
    'a.%2e%2e%2f',
    'a.' + '../'.repeat(20),
  ]
  for (const n of hostiles) {
    const ext = extDeNombre(n)
    assert.match(ext, /^[a-z0-9]{1,8}$/, `"${n}" dio "${ext}"`)
  }
})

test('extDeNombre no revienta con nombres raros', () => {
  assert.strictEqual(extDeNombre(''), 'bin')
  assert.strictEqual(extDeNombre(null), 'bin')
  assert.strictEqual(extDeNombre('sinpunto'), 'bin')
  assert.strictEqual(extDeNombre('termina.'), 'bin')
  assert.strictEqual(extDeNombre('.oculto'), 'oculto')
})

test('extDeNombre corta las extensiones absurdamente largas', () => {
  assert.strictEqual(extDeNombre('x.' + 'a'.repeat(100)).length, 8)
})
