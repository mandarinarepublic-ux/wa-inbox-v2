import test from 'node:test'
import assert from 'node:assert'
import { extraer, normalizarReferral, formatearPedido, contenidoTipoEspecial } from '../lib/wa-mensaje.js'

test('extraer lee un texto', () => {
  const r = extraer({ type: 'text', text: { body: 'hola' } })
  assert.equal(r.tipo, 'texto')
  assert.equal(r.contenido, 'hola')
  assert.equal(r.mediaId, '')
})

test('extraer lee una imagen con caption y su media id', () => {
  const r = extraer({ type: 'image', image: { id: 'MID1', caption: 'esta talla' } })
  assert.equal(r.tipo, 'imagen')
  assert.equal(r.contenido, 'esta talla')
  assert.equal(r.mediaId, 'MID1')
})

test('extraer deja el audio sin texto pero con media id', () => {
  const r = extraer({ type: 'audio', audio: { id: 'AUD1' } })
  assert.equal(r.tipo, 'audio')
  assert.equal(r.contenido, '')
  assert.equal(r.mediaId, 'AUD1')
})

test('extraer usa el nombre del archivo como texto del documento', () => {
  const r = extraer({ type: 'document', document: { id: 'DOC1', filename: 'guia.pdf' } })
  assert.equal(r.tipo, 'documento')
  assert.equal(r.contenido, 'guia.pdf')
  assert.equal(r.mediaId, 'DOC1')
})

test('extraer arrastra el id del mensaje citado', () => {
  const r = extraer({ type: 'text', text: { body: 'si' }, context: { id: 'wamid.CITA' } })
  assert.equal(r.contextoId, 'wamid.CITA')
})

test('normalizarReferral devuelve null cuando no hay pauta', () => {
  assert.equal(normalizarReferral(null), null)
  assert.equal(normalizarReferral({}), null)
})

// ── order (pedido del catálogo) ─────────────────────────────────────────────

test('formatearPedido arma el total y las lineas de un pedido de dos articulos', () => {
  const texto = formatearPedido({
    catalog_id: '748962957813465',
    text: '',
    product_items: [
      { currency: 'USD', quantity: 1, item_price: 30, product_retailer_id: '8011691753565' },
      { currency: 'USD', quantity: 2, item_price: 25, product_retailer_id: '108' },
    ],
  })
  assert.equal(texto, [
    '📦 Pedido del catálogo — 3 artículos · $80.00',
    '   • 1 × $30.00  (8011691753565)',
    '   • 2 × $25.00  (108)',
  ].join('\n'))
})

test('formatearPedido con un solo articulo dice "articulo" en singular', () => {
  const texto = formatearPedido({
    product_items: [{ currency: 'USD', quantity: 1, item_price: 15, product_retailer_id: 'ABC' }],
  })
  assert.match(texto, /^📦 Pedido del catálogo — 1 artículo · \$15\.00$/m)
})

test('formatearPedido con cero articulos NUNCA revienta ni desaparece', () => {
  const texto = formatearPedido({ product_items: [] })
  assert.equal(texto, '📦 Pedido del catálogo — 0 artículos · $0.00')
})

test('formatearPedido pinta un articulo con precio en 0 (pasó de verdad)', () => {
  const texto = formatearPedido({
    product_items: [{ currency: 'USD', quantity: 1, item_price: 0, product_retailer_id: 'SINPRECIO' }],
  })
  assert.equal(texto, [
    '📦 Pedido del catálogo — 1 artículo · $0.00',
    '   • 1 × $0.00  (SINPRECIO)',
  ].join('\n'))
})

test('formatearPedido incluye la nota del cliente cuando viene', () => {
  const texto = formatearPedido({
    text: 'sin arroz por favor',
    product_items: [{ currency: 'USD', quantity: 1, item_price: 10, product_retailer_id: 'X' }],
  })
  assert.match(texto, /📝 sin arroz por favor$/)
})

test('extraer arma el contenido de un order desde el payload real de Meta', () => {
  const r = extraer({
    type: 'order',
    order: {
      catalog_id: '748962957813465',
      text: '',
      product_items: [
        { currency: 'USD', quantity: 1, item_price: 30, product_retailer_id: '8011691753565' },
        { currency: 'USD', quantity: 2, item_price: 25, product_retailer_id: '108' },
      ],
    },
  })
  assert.equal(r.tipo, 'order')
  assert.match(r.contenido, /^📦 Pedido del catálogo — 3 artículos · \$80\.00/)
  assert.equal(r.mediaId, '')
})

// ── unsupported (Meta no manda el contenido, pero SÍ escribió una persona) ──

test('extraer etiqueta un unsupported con el motivo que manda Meta', () => {
  const r = extraer({
    type: 'unsupported',
    errors: [{ code: 131060, title: 'This message is unavailable.' }],
    unsupported: { type: 'unknown', raw_type: 'unknown' },
  })
  assert.equal(r.tipo, 'unsupported')
  assert.equal(r.contenido, '⚠️ Te escribió algo que no podemos mostrar (This message is unavailable.)')
})

test('extraer etiqueta un unsupported sin motivo (sin errors)', () => {
  const r = extraer({ type: 'unsupported' })
  assert.equal(r.contenido, '⚠️ Te escribió algo que no podemos mostrar')
})

// ── system (aviso de WhatsApp, no una persona escribiendo) ──────────────────

test('extraer etiqueta un system como aviso de WhatsApp', () => {
  const r = extraer({ type: 'system', system: { body: 'El numero cambio', type: 'user_changed_number' } })
  assert.equal(r.tipo, 'system')
  assert.equal(r.contenido, 'ℹ️ Aviso de WhatsApp')
})

// ── contenidoTipoEspecial: la misma función que usa extraer(), pero llamada
// directo con `raw` (lo que hace lib/inbox-supabase.js al leer filas viejas
// con `texto` vacío). Tiene que decir EXACTAMENTE lo mismo que extraer().

test('contenidoTipoEspecial reconstruye el order desde raw igual que extraer', () => {
  const raw = { type: 'order', order: { product_items: [{ currency: 'USD', quantity: 1, item_price: 30, product_retailer_id: 'X' }] } }
  assert.equal(contenidoTipoEspecial('order', raw), extraer(raw).contenido)
})

test('contenidoTipoEspecial deja la etiqueta generica cuando el order no tiene raw', () => {
  assert.equal(contenidoTipoEspecial('order', null), '📦 Pedido del catálogo')
  assert.equal(contenidoTipoEspecial('order', {}), '📦 Pedido del catálogo')
})

test('contenidoTipoEspecial arma el unsupported con motivo desde raw', () => {
  const raw = { errors: [{ title: 'This message is unavailable.' }] }
  assert.equal(contenidoTipoEspecial('unsupported', raw), '⚠️ Te escribió algo que no podemos mostrar (This message is unavailable.)')
})

test('contenidoTipoEspecial no revienta con tipos comunes: devuelve vacio', () => {
  assert.equal(contenidoTipoEspecial('texto', null), '')
  assert.equal(contenidoTipoEspecial('imagen', {}), '')
})
