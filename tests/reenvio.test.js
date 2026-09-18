// Reenviar un mensaje a otro chat. La decisión de QUÉ se manda (y qué NO se
// puede mandar) vive en un módulo puro para poder probarla sin navegador: la
// pantalla solo pinta el botón y llama.
//
// ☠️ La regla que importa: un mensaje sin archivo GUARDADO no se reenvía. Los
// entrantes de Meta llegan con `mediaId` y sin `mediaUrl` hasta que el archivado
// termina, y ese id es de NUESTRO número: mandarlo a otro chat es apostar a que
// Meta lo acepte. Mejor decir "todavía no" que mandar un mensaje muerto.
import test from 'node:test'
import assert from 'node:assert'
import { puedeReenviar, piezasDeReenvio, resumenDeReenvio } from '../lib/reenvio.js'

const M = (extra) => ({ tipo: 'texto', mensaje: '', mediaUrl: '', mediaId: '', direccion: 'ENTRANTE', ubicacion: null, pedido: null, ...extra })

test('texto: se reenvía tal cual', () => {
  const msg = M({ mensaje: 'Hola, ¿tienes la talla L?' })
  assert.deepEqual(puedeReenviar(msg), { ok: true, motivo: '' })
  assert.deepEqual(piezasDeReenvio(msg), [{ clase: 'texto', texto: 'Hola, ¿tienes la talla L?' }])
})

test('texto vacío: no hay nada que reenviar', () => {
  const r = puedeReenviar(M({ mensaje: '   ' }))
  assert.equal(r.ok, false)
  assert.match(r.motivo, /nada/i)
  assert.deepEqual(piezasDeReenvio(M({ mensaje: '   ' })), [])
})

test('foto con archivo guardado: va la foto y su texto como pie', () => {
  const msg = M({ tipo: 'imagen', mediaUrl: 'https://x/f.jpg', mensaje: 'Así se ve' })
  assert.equal(puedeReenviar(msg).ok, true)
  assert.deepEqual(piezasDeReenvio(msg), [{ clase: 'imagen', url: 'https://x/f.jpg', texto: 'Así se ve' }])
})

test('foto sin pie: una sola pieza, sin texto', () => {
  assert.deepEqual(piezasDeReenvio(M({ tipo: 'imagen', mediaUrl: 'https://x/f.jpg' })), [{ clase: 'imagen', url: 'https://x/f.jpg', texto: '' }])
})

test('video, audio y documento guardados: una pieza de su clase', () => {
  assert.deepEqual(piezasDeReenvio(M({ tipo: 'video', mediaUrl: 'https://x/v.mp4' })), [{ clase: 'video', url: 'https://x/v.mp4', texto: '' }])
  assert.deepEqual(piezasDeReenvio(M({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' })), [{ clase: 'audio', url: 'https://x/a.ogg' }])
  assert.deepEqual(piezasDeReenvio(M({ tipo: 'documento', mediaUrl: 'https://x/d.pdf', mensaje: 'guia.pdf' })), [{ clase: 'documento', url: 'https://x/d.pdf', nombre: 'guia.pdf' }])
})

test('documento sin nombre: se manda con uno genérico, nunca con el uuid del bucket', () => {
  assert.deepEqual(piezasDeReenvio(M({ tipo: 'documento', mediaUrl: 'https://x/d.pdf' })), [{ clase: 'documento', url: 'https://x/d.pdf', nombre: 'documento' }])
})

test('☠️ media que todavía NO está archivada (solo mediaId): no se reenvía', () => {
  for (const tipo of ['imagen', 'video', 'audio', 'documento']) {
    const r = puedeReenviar(M({ tipo, mediaId: 'wamid-media-123' }))
    assert.equal(r.ok, false, tipo)
    assert.match(r.motivo, /archiv/i, tipo)
    assert.deepEqual(piezasDeReenvio(M({ tipo, mediaId: 'wamid-media-123' })), [], tipo)
  }
})

test('ubicación: se reenvía como texto con coordenadas y enlace a Maps', () => {
  const msg = M({ tipo: 'texto', mensaje: '📍 -0.18,-78.47 Tienda', ubicacion: { lat: -0.18, lon: -78.47, nombre: 'Tienda', direccion: '', url: '' } })
  assert.equal(puedeReenviar(msg).ok, true)
  const piezas = piezasDeReenvio(msg)
  assert.equal(piezas.length, 1)
  assert.equal(piezas[0].clase, 'texto')
  assert.match(piezas[0].texto, /Tienda/)
  assert.match(piezas[0].texto, /-0\.18/)
  assert.match(piezas[0].texto, /google\.com\/maps/)
})

test('lo que NO se reenvía: pedido del catálogo, reacción, edición, borrado, aviso, sticker y lo no soportado', () => {
  const casos = [
    ['order', /pedido/i],
    ['reaction', /reacc/i],
    ['edit', /edit/i],
    ['revoke', /elimin/i],
    ['system', /aviso/i],
    ['unsupported', /mostrar|soport/i],
    ['sticker', /sticker/i],
  ]
  for (const [tipo, patron] of casos) {
    const r = puedeReenviar(M({ tipo, mensaje: 'etiqueta', mediaUrl: 'https://x/s.webp' }))
    assert.equal(r.ok, false, tipo)
    assert.match(r.motivo, patron, tipo)
  }
})

test('un mensaje con pedido del catálogo no se reenvía aunque traiga texto', () => {
  assert.equal(puedeReenviar(M({ tipo: 'texto', mensaje: 'Pedido', pedido: { items: [] } })).ok, false)
})

test('resumenDeReenvio: una línea corta para la ventana de elegir chat', () => {
  assert.match(resumenDeReenvio(M({ mensaje: 'Hola '.repeat(40) })), /^Hola/)
  assert.ok(resumenDeReenvio(M({ mensaje: 'Hola '.repeat(40) })).length <= 80)
  assert.match(resumenDeReenvio(M({ tipo: 'imagen', mediaUrl: 'https://x/f.jpg' })), /foto/i)
  assert.match(resumenDeReenvio(M({ tipo: 'audio', mediaUrl: 'https://x/a.ogg' })), /voz|audio/i)
  assert.match(resumenDeReenvio(M({ tipo: 'documento', mediaUrl: 'https://x/d.pdf', mensaje: 'guia.pdf' })), /guia\.pdf/)
})

test('un mensaje nuestro (SALIENTE) también se reenvía', () => {
  assert.equal(puedeReenviar(M({ mensaje: 'Te confirmo stock', direccion: 'SALIENTE' })).ok, true)
})

// ── A qué chats se puede reenviar ────────────────────────────────────────────
// La ventana de 24 h es POR CONVERSACIÓN y por número: un chat con la ventana
// cerrada no puede recibir nada que no sea plantilla, así que se ofrece pero
// deshabilitado y con el motivo escrito. Mostrarlo habilitado sería repetir el
// bug de los 131047: el vendedor lo ve salir y el cliente no recibe nada.
import { destinosParaReenviar } from '../lib/reenvio.js'

const AHORA = Date.parse('2026-09-18T12:00:00Z')
const hace = (h) => new Date(AHORA - h * 3600 * 1000).toISOString()
const conv = (extra) => ({ telefono: '593999000111', nombre: 'Ana', phoneId: 'P1', ultimoEntranteCanal: null, msgs: [], ...extra })

test('destinos: la ventana sale del último ENTRANTE de esa conversación', () => {
  const abierta = conv({ telefono: '1', msgs: [{ direccion: 'ENTRANTE', timestamp: hace(3) }] })
  const cerrada = conv({ telefono: '2', msgs: [{ direccion: 'ENTRANTE', timestamp: hace(30) }] })
  const [a, b] = destinosParaReenviar([abierta, cerrada], { ahoraMs: AHORA })
  assert.equal(a.puede, true)
  assert.equal(a.motivo, '')
  assert.equal(b.puede, false)
  assert.match(b.motivo, /24 h/)
})

test('destinos: un saliente NO abre la ventana (solo cuenta lo que escribió el cliente)', () => {
  const soloNuestro = conv({ msgs: [{ direccion: 'SALIENTE', timestamp: hace(1) }] })
  assert.equal(destinosParaReenviar([soloNuestro], { ahoraMs: AHORA })[0].puede, false)
})

test('destinos: `ultimoEntranteCanal` manda sobre los mensajes cargados', () => {
  // La lista lateral trae la fecha del último entrante DE ESE CANAL aunque el
  // hilo todavía no esté cargado: sin esto, un chat abierto se vería cerrado.
  const c = conv({ ultimoEntranteCanal: hace(2), msgs: [] })
  assert.equal(destinosParaReenviar([c], { ahoraMs: AHORA })[0].puede, true)
})

test('destinos: se excluye el chat de origen (no tiene sentido reenviarse a sí mismo)', () => {
  const uno = conv({ telefono: '593999000111', phoneId: 'P1', ultimoEntranteCanal: hace(1) })
  const otro = conv({ telefono: '593888000222', phoneId: 'P1', ultimoEntranteCanal: hace(1) })
  const lista = destinosParaReenviar([uno, otro], { ahoraMs: AHORA, excluir: { telefono: '0999000111', phoneId: 'P1' } })
  assert.deepEqual(lista.map(d => d.telefono), ['593888000222'])
})

test('destinos: el mismo teléfono en OTRO número sí es un destino distinto', () => {
  const mandi = conv({ telefono: '593999000111', phoneId: 'P1', ultimoEntranteCanal: hace(1) })
  const republic = conv({ telefono: '593999000111', phoneId: 'P2', ultimoEntranteCanal: hace(1) })
  const lista = destinosParaReenviar([mandi, republic], { ahoraMs: AHORA, excluir: { telefono: '593999000111', phoneId: 'P1' } })
  assert.deepEqual(lista.map(d => d.phoneId), ['P2'])
})

test('destinos: se filtran por nombre o por número, sin importar acentos ni mayúsculas', () => {
  const ana = conv({ telefono: '593999000111', nombre: 'Ana Pérez', ultimoEntranteCanal: hace(1) })
  const luis = conv({ telefono: '593988777666', nombre: 'Luis', ultimoEntranteCanal: hace(1) })
  assert.deepEqual(destinosParaReenviar([ana, luis], { ahoraMs: AHORA, busqueda: 'perez' }).map(d => d.nombre), ['Ana Pérez'])
  assert.deepEqual(destinosParaReenviar([ana, luis], { ahoraMs: AHORA, busqueda: '777' }).map(d => d.nombre), ['Luis'])
  assert.equal(destinosParaReenviar([ana, luis], { ahoraMs: AHORA, busqueda: 'zzz' }).length, 0)
})

test('destinos: primero los que pueden recibir, y nunca revienta con una lista vacía o rara', () => {
  const cerrada = conv({ telefono: '1', nombre: 'Cerrada', msgs: [{ direccion: 'ENTRANTE', timestamp: hace(40) }] })
  const abierta = conv({ telefono: '2', nombre: 'Abierta', ultimoEntranteCanal: hace(1) })
  assert.deepEqual(destinosParaReenviar([cerrada, abierta], { ahoraMs: AHORA }).map(d => d.nombre), ['Abierta', 'Cerrada'])
  assert.deepEqual(destinosParaReenviar(null, { ahoraMs: AHORA }), [])
  assert.deepEqual(destinosParaReenviar([null, undefined], { ahoraMs: AHORA }), [])
})
