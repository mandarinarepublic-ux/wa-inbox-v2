// Pegar (Ctrl+V) y arrastrar entran a la MISMA tubería que el 📎. Esto prueba
// las decisiones de esa tubería, que son donde estaban las trampas.
import test from 'node:test'
import assert from 'node:assert'
import { decidirPegado, decidirAdjuntos, TOPE_FOTOS } from '../lib/adjuntos.js'

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

test('un archivo que no es foto ni video avisa en vez de quedarse callado', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [pdf()] })
  assert.strictEqual(r.accion, 'nada')
  assert.match(r.aviso, /solo se pueden mandar imágenes y videos/)
})

test('si vienen mezclados, se toman las fotos y se avisa del resto', () => {
  const r = decidirAdjuntos({ actuales: 0, entrantes: [foto(), pdf()] })
  assert.strictEqual(r.accion, 'reemplazar')
  assert.strictEqual(r.archivos.length, 1)
  assert.match(r.aviso, /no era foto ni video/)
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
