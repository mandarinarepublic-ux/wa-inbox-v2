import test from 'node:test'
import assert from 'node:assert'
import { extraer, normalizarReferral, formatearPedido, contenidoTipoEspecial, parseUbicacion } from '../lib/wa-mensaje.js'

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

test('contenidoTipoEspecial deja los tipos con media propio en vacio (la burbuja los pinta por mediaId)', () => {
  assert.equal(contenidoTipoEspecial('imagen', {}), '')
  assert.equal(contenidoTipoEspecial('video', {}), '')
  assert.equal(contenidoTipoEspecial('audio', {}), '')
  assert.equal(contenidoTipoEspecial('documento', {}), '')
  assert.equal(contenidoTipoEspecial('sticker', {}), '')
})

// ── bug #4: reaction / edit / revoke / contacts / texto vacio de verdad ────
// Antes de este fix, estos tipos caían en el `default` de contenidoTipoEspecial
// y salían con '' -> si eran el ULTIMO mensaje de la conversación, la persona
// entera desaparecía del sidebar (medido: 32 conversaciones, 13 pendientes).

test('contenidoTipoEspecial arma la reaccion con el emoji del payload', () => {
  const raw = { reaction: { message_id: 'wamid.ABC', emoji: '👍' } }
  assert.equal(contenidoTipoEspecial('reaction', raw), '👍 Reaccionó a un mensaje')
})

test('contenidoTipoEspecial arma la reaccion sin emoji cuando no hay payload', () => {
  assert.equal(contenidoTipoEspecial('reaction', null), 'Reaccionó a un mensaje')
  assert.equal(contenidoTipoEspecial('reaction', {}), 'Reaccionó a un mensaje')
})

test('contenidoTipoEspecial etiqueta un edit', () => {
  assert.equal(contenidoTipoEspecial('edit', null), '✏️ Editó un mensaje')
})

test('contenidoTipoEspecial etiqueta un revoke (mensaje eliminado)', () => {
  assert.equal(contenidoTipoEspecial('revoke', null), '🚫 Eliminó un mensaje')
})

test('contenidoTipoEspecial etiqueta contacts, con y sin nombre en el payload', () => {
  assert.equal(contenidoTipoEspecial('contacts', { contacts: [{ name: { formatted_name: 'Juan Perez' } }] }), '👤 Compartió un contacto (Juan Perez)')
  assert.equal(contenidoTipoEspecial('contacts', null), '👤 Compartió un contacto')
})

test('contenidoTipoEspecial etiqueta location, con y sin nombre/direccion en el payload', () => {
  assert.equal(contenidoTipoEspecial('location', { location: { name: 'Tienda', address: 'Av. Siempre Viva' } }), '📍 Compartió su ubicación (Tienda, Av. Siempre Viva)')
  assert.equal(contenidoTipoEspecial('location', null), '📍 Compartió su ubicación')
})

// ── LA prueba que tiene que romperse si alguien vuelve a poner una lista ───
// de tipos permitidos: un tipo INVENTADO, que no existe en ningún case de
// contenidoTipoEspecial ni de extraer(), con texto vacío y sin media, tiene
// que seguir dando contenido no vacío. Si esto falla, alguien reintrodujo el
// allow-list y el bug #5 ya está en camino.

test('contenidoTipoEspecial nombra el tipo, aunque sea uno que no existe todavia', () => {
  const etiqueta = contenidoTipoEspecial('tipo_que_no_existe_todavia', {})
  assert.ok(etiqueta.trim(), 'un tipo desconocido tiene que dar etiqueta, no vacio')
  assert.match(etiqueta, /tipo_que_no_existe_todavia/, 'la etiqueta tiene que nombrar el tipo para poder diagnosticarlo')
})

test('extraer nunca guarda contenido vacio para un tipo inventado sin texto ni media', () => {
  const r = extraer({ type: 'tipo_que_no_existe_todavia' })
  assert.equal(r.tipo, 'tipo_que_no_existe_todavia')
  assert.ok(String(r.contenido).trim(), 'extraer tiene que producir contenido no vacio para CUALQUIER tipo')
  assert.match(r.contenido, /tipo_que_no_existe_todavia/)
})

test('extraer etiqueta un reaction con el emoji real de Meta', () => {
  const r = extraer({ type: 'reaction', reaction: { message_id: 'wamid.ABC', emoji: '❤️' } })
  assert.equal(r.tipo, 'reaction')
  assert.equal(r.contenido, '❤️ Reaccionó a un mensaje')
})

test('extraer etiqueta un edit sin necesitar mas payload', () => {
  const r = extraer({ type: 'edit' })
  assert.equal(r.tipo, 'edit')
  assert.equal(r.contenido, '✏️ Editó un mensaje')
})

test('extraer no guarda un texto realmente vacio en blanco (bug real de MANDI)', () => {
  const r = extraer({ type: 'text', text: { body: '' } })
  assert.equal(r.tipo, 'texto')
  assert.ok(String(r.contenido).trim(), 'un texto vacio de verdad tiene que producir etiqueta, no ""')
})

// ── A QUÉ mensaje reaccionó el cliente ───────────────────────────────────────
// "A veces me reaccionan con un corazón y no sé a qué mensaje." — Rodrigo, 28-ago.
//
// La reacción SÍ se guardaba (con su emoji), pero llegaba huérfana: se veía
// "❤️ Reaccionó a un mensaje" sin decir a cuál.
//
// ☠️ La causa es una sutileza del webhook: en una respuesta citada Meta manda el
// wamid en `context.id`, pero en una REACCIÓN lo manda en `reaction.message_id`.
// `extraer` solo miraba `context.id`, asi que la referencia se perdia — no por
// falta de dato, sino por mirar el campo equivocado.
//
// Poniendolo en `contextoId` (el MISMO campo que usa una cita), la reaccion se
// pinta con la interfaz de citas que ya existe desde julio. Cero UI nueva.

test('una reaccion dice A QUE mensaje reacciono', () => {
  const r = extraer({
    type: 'reaction',
    reaction: { message_id: 'wamid.HBgMNTkz', emoji: '❤️' },
  })
  assert.equal(r.contextoId, 'wamid.HBgMNTkz')
})

test('la reaccion conserva su emoji ademas de la referencia', () => {
  // Las dos cosas, no una a costa de la otra.
  const r = extraer({
    type: 'reaction',
    reaction: { message_id: 'wamid.ABC', emoji: '👍' },
  })
  assert.equal(r.tipo, 'reaction')
  assert.ok(r.contenido.includes('👍'), 'el emoji real de Meta, nunca uno inventado')
  assert.equal(r.contextoId, 'wamid.ABC')
})

test('quitar una reaccion tambien dice de que mensaje era', () => {
  // Al quitar el corazon, Meta manda la misma forma con `emoji` vacio. Sigue
  // siendo un evento sobre UN mensaje concreto.
  const r = extraer({
    type: 'reaction',
    reaction: { message_id: 'wamid.XYZ', emoji: '' },
  })
  assert.equal(r.contextoId, 'wamid.XYZ')
})

test('una cita normal sigue saliendo de context.id', () => {
  // La reaccion no puede haber roto el camino de siempre.
  const r = extraer({
    type: 'text', text: { body: 'si, ese' },
    context: { id: 'wamid.CITADO' },
  })
  assert.equal(r.contextoId, 'wamid.CITADO')
})

test('si vinieran los dos, manda context.id', () => {
  // No deberia pasar, pero si pasa: `context` es el campo canonico de "a que
  // respondo"; `reaction.message_id` es el atajo del tipo reaction.
  const r = extraer({
    type: 'reaction',
    context: { id: 'wamid.CONTEXT' },
    reaction: { message_id: 'wamid.REACTION', emoji: '❤️' },
  })
  assert.equal(r.contextoId, 'wamid.CONTEXT')
})

test('una reaccion sin message_id no inventa una referencia', () => {
  const r = extraer({ type: 'reaction', reaction: { emoji: '❤️' } })
  assert.equal(r.contextoId, '')
})

// ── UBICACIONES ──────────────────────────────────────────────────
// La ubicación se guarda como `tipo: 'texto'` con el contenido
// "📍 lat,lon nombre" (ver extraer). parseUbicacion la reconoce al LEER, para
// pintarla como tarjeta con enlace a Google Maps en vez de coordenadas pelonas.

test('parseUbicacion prefiere raw.location, que trae la direccion completa', () => {
  const u = parseUbicacion('📍 -0.1754,-78.4776 Ind Store', {
    location: { latitude: -0.1754, longitude: -78.4776, name: 'Ind Store', address: 'Av. Amazonas y Naciones Unidas' },
  })
  assert.equal(u.lat, '-0.1754')
  assert.equal(u.lon, '-78.4776')
  assert.equal(u.nombre, 'Ind Store')
  assert.equal(u.direccion, 'Av. Amazonas y Naciones Unidas')
})

test('parseUbicacion cae al texto cuando la fila no tiene raw', () => {
  const u = parseUbicacion('📍 -0.18640510737896,-78.49340057373', null)
  assert.equal(u.lat, '-0.18640510737896')
  assert.equal(u.lon, '-78.49340057373')
  assert.equal(u.nombre, '')
  assert.equal(u.direccion, '')
})

test('parseUbicacion lee del texto un nombre con espacios', () => {
  const u = parseUbicacion('📍 -0.1754,-78.4776 Ind Store', null)
  assert.equal(u.nombre, 'Ind Store')
})

test('parseUbicacion devuelve null cuando no hay ubicacion', () => {
  assert.equal(parseUbicacion('hola, quiero una talla M', null), null)
  assert.equal(parseUbicacion('', null), null)
  assert.equal(parseUbicacion(null, null), null)
})

// ── LA prueba que protege los 173 saludos ────────────────────────
// El saludo automático de MANDI empieza con 📍 y NO es una ubicación. Si
// alguien "simplifica" el patrón a `texto.startsWith('📍')`, este mensaje se
// pintaría como un mapa con coordenadas inventadas. El ancla son las
// COORDENADAS pegadas al emoji, nunca el emoji solo.

test('parseUbicacion NO confunde el saludo de la tienda con una ubicacion', () => {
  const saludo = '📍 Estamos en Quito:\nAv. 6 de Diciembre y Mercurio (frente al teatro del Colegio 24 de Mayo).\n\nTe dejo el mapa 👇\nhttps://maps.app.goo.gl/qRJjcgEuA4aRKgdX9'
  assert.equal(parseUbicacion(saludo, null), null)
})

test('parseUbicacion arma el enlace de Google Maps con las coordenadas', () => {
  const u = parseUbicacion('📍 -0.1754,-78.4776 Ind Store', null)
  assert.equal(u.url, 'https://www.google.com/maps/search/?api=1&query=-0.1754,-78.4776')
})
// Caso salido de PRODUCCIÓN, no inventado: 71 filas de julio quedaron con el
// texto "📍 ," — y NO son ubicaciones, son fotos/audios/stickers/pedidos de un
// bug de ingestión ya muerto (nada desde el 11-jul-2026). Sin coordenadas no
// hay tarjeta: se siguen pintando como hasta hoy, con su media.
test('parseUbicacion ignora el "📍 ," de las filas rotas de julio', () => {
  assert.equal(parseUbicacion('📍 ,', null), null)
  assert.equal(parseUbicacion('📍 -0.17,', null), null)
})
