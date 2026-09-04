import test from 'node:test'
import assert from 'node:assert'
import { toMensaje, esPintable, paginarLimite } from '../lib/inbox-supabase.js'

// Caso que se escapó en el deploy de wa-mensaje.js: filas YA GUARDADAS en la
// base con `texto` vacío (la ingestión vieja no derivaba la etiqueta), leídas
// AHORA por toMensaje. Sin esto, esPintable las sigue descartando y la persona
// queda invisible aunque la ingestión ya esté arreglada — eso es justo lo que
// pasó: 126 personas invisibles pese al deploy.

test('toMensaje deriva el order de una fila vieja (texto vacio) usando raw', () => {
  const fila = {
    telefono: '593987654321', tipo: 'order', texto: '',
    raw: {
      type: 'order',
      order: {
        product_items: [
          { currency: 'USD', quantity: 2, item_price: 15, product_retailer_id: 'ABC' },
        ],
      },
    },
  }
  const m = toMensaje(fila)
  assert.match(m.mensaje, /^📦 Pedido del catálogo — 2 artículos · \$30\.00/)
  assert.match(m.mensaje, /ABC/)
  assert.ok(esPintable(m), 'tiene que pasar el filtro de pintable')
})

test('toMensaje deriva un order generico cuando la fila vieja no tiene raw (anterior al respaldo)', () => {
  const fila = { telefono: '593987654321', tipo: 'order', texto: '', raw: null }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '📦 Pedido del catálogo')
  assert.ok(esPintable(m))
})

test('toMensaje deriva un unsupported viejo con el motivo si raw lo trae', () => {
  const fila = {
    telefono: '593987654321', tipo: 'unsupported', texto: '',
    raw: { type: 'unsupported', errors: [{ title: 'This message is unavailable.' }] },
  }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '⚠️ Te escribió algo que no podemos mostrar (This message is unavailable.)')
  assert.ok(esPintable(m))
})

test('toMensaje deriva un unsupported viejo sin motivo cuando no hay raw', () => {
  const fila = { telefono: '593987654321', tipo: 'unsupported', texto: '' }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '⚠️ Te escribió algo que no podemos mostrar')
  assert.ok(esPintable(m))
})

test('toMensaje deriva un system viejo sin necesitar raw', () => {
  const fila = { telefono: '593987654321', tipo: 'system', texto: '' }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, 'ℹ️ Aviso de WhatsApp')
  assert.ok(esPintable(m))
})

// Bug #4 (MANDI): esta fila era un fantasma REAL de verdad — hasta que se
// confirmó que Meta manda textos vacíos de verdad y esconde a la persona
// entera. Ya no se trata como fantasma: un texto vacío ahora se etiqueta
// igual que cualquier otro tipo sin contenido (ver contenidoTipoEspecial).
test('toMensaje YA NO esconde un texto que llego de verdad vacio (bug #4, MANDI)', () => {
  const fila = { telefono: '593987654321', tipo: 'texto', texto: '', media_url: '', media_id: '', botones: '' }
  const m = toMensaje(fila)
  assert.ok(m.mensaje.trim(), 'tiene que producir una etiqueta, no vacio')
  assert.ok(esPintable(m), 'un texto vacio de verdad NO puede seguir escondiendo a la persona')
})

// El fantasma REAL que sigue existiendo: un tipo con media propio que llegó
// SIN media, SIN caption y SIN botones. Ahí sí no hay nada que mostrar, ni
// con la etiqueta genérica (contenidoTipoEspecial deja los tipos de media en
// '' a propósito — ver el comentario en esPintable).
test('toMensaje SI descarta una imagen que llego sin media, caption ni botones (fantasma real)', () => {
  const fila = { telefono: '593987654321', tipo: 'imagen', texto: '', media_url: '', media_id: '', botones: '' }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '')
  assert.ok(!esPintable(m), 'una imagen sin nada que mostrar se sigue descartando: eso si es un fantasma')
})

// Telefono malformado: el otro guardia que el filtro sigue sosteniendo, sin
// importar que el mensaje tenga contenido de sobra.
test('esPintable descarta un telefono malformado aunque el mensaje tenga contenido', () => {
  const m = { telefono: '12345', mensaje: 'hola', mediaUrl: '', mediaId: '', botones: '' }
  assert.ok(!esPintable(m), 'un telefono invalido se sigue descartando')
})

// LA prueba que tiene que romperse si alguien reintroduce un allow-list: un
// tipo INVENTADO que no existe en ningún case del código, con texto vacío y
// sin media, tiene que seguir produciendo contenido y pasando el filtro.
test('toMensaje/esPintable nunca esconden un tipo inventado con texto vacio (rompe si vuelve el allow-list)', () => {
  const fila = { telefono: '593987654321', tipo: 'tipo_que_no_existe_todavia', texto: '', media_url: '', media_id: '', botones: '' }
  const m = toMensaje(fila)
  assert.ok(m.mensaje.trim(), 'un tipo desconocido tiene que producir contenido no vacio')
  assert.match(m.mensaje, /tipo_que_no_existe_todavia/, 'la etiqueta tiene que nombrar el tipo')
  assert.ok(esPintable(m), 'un tipo inventado NUNCA puede quedar invisible')
})

test('toMensaje respeta el texto ya derivado (fila nueva, ingestion arreglada) sin tocar raw', () => {
  const fila = { telefono: '593987654321', tipo: 'order', texto: '📦 Pedido del catálogo — 1 artículo · $10.00', raw: null }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '📦 Pedido del catálogo — 1 artículo · $10.00')
})

// getMensajesSupabase (el polling de /api/inbox-sync, cada ~20s por pestaña)
// dejó de pedir `raw` por peso (539 kB por ventana de 3.000 mensajes en IND).
// Una fila de ESA consulta llega sin la clave `raw` (no `raw: null`, sino
// ausente del objeto) — este test es el que tiene que cazarlo si alguien
// vuelve a optimizar la consulta mañana y esconde gente otra vez.
test('toMensaje: un order de la consulta SIN raw (polling) sigue pasando el filtro', () => {
  const filaDePolling = { telefono: '593987654321', tipo: 'order', texto: '' } // sin `raw`
  const m = toMensaje(filaDePolling)
  assert.equal(m.mensaje, '📦 Pedido del catálogo')
  assert.ok(m.mensaje.trim(), 'tiene que producir una etiqueta no vacia')
  assert.ok(esPintable(m), 'una fila de polling sin raw NO puede quedar invisible')
})

// paginarLimite es el que le faltaba a getListaSupabase: PostgREST corta en
// 1000 filas por request y un solo `.limit(4000)` se quedaba callado en las
// primeras 1000. Este es el test que falla si alguien vuelve a reemplazar el
// loop por un `.limit()` de una sola llamada — no habla con Supabase, solo
// con un `fetchPage` falso.

test('paginarLimite junta varias paginas cortas hasta que una vuelve incompleta', async () => {
  const paginas = [
    Array.from({ length: 1000 }, (_, i) => i),
    Array.from({ length: 1000 }, (_, i) => 1000 + i),
    Array.from({ length: 762 }, (_, i) => 2000 + i),
  ]
  let llamadas = 0
  const fetchPage = async () => paginas[llamadas++]
  const filas = await paginarLimite(fetchPage, 4000)
  assert.equal(filas.length, 2762)
  assert.equal(llamadas, 3)
})

test('paginarLimite hace UNA sola llamada cuando la primera pagina ya viene incompleta', async () => {
  let llamadas = 0
  const fetchPage = async () => { llamadas++; return Array.from({ length: 400 }, (_, i) => i) }
  const filas = await paginarLimite(fetchPage, 4000)
  assert.equal(filas.length, 400)
  assert.equal(llamadas, 1)
})

test('paginarLimite respeta el tope aunque haya mas filas disponibles', async () => {
  // Fuente con de sobra (5000 filas): fetchPage respeta el rango pedido,
  // igual que `.range(from, to)` en Supabase. Con limite=1500 la segunda
  // llamada pide solo 500 (no 1000), y no debe hacer una tercera.
  const todas = Array.from({ length: 5000 }, (_, i) => i)
  let llamadas = 0
  const fetchPage = async (from, to) => { llamadas++; return todas.slice(from, to + 1) }
  const filas = await paginarLimite(fetchPage, 1500)
  assert.equal(filas.length, 1500)
  assert.equal(llamadas, 2)
})

// ── UBICACIONES ──────────────────────────────────────────────────
// toMensaje deriva `ubicacion` al leer, para que la burbuja pinte una tarjeta
// con enlace a Google Maps en vez de las coordenadas pelonas. El cliente NO
// recibe `raw` (medio mega de jsonb por poll), solo este objetito.

test('toMensaje expone la ubicacion con la direccion que viene en raw', () => {
  const m = toMensaje({
    wa_message_id: 'WA1', telefono: '593999', tipo: 'texto',
    texto: '📍 -0.1754,-78.4776 Ind Store', direccion: 'ENTRANTE',
    raw: { location: { latitude: -0.1754, longitude: -78.4776, name: 'Ind Store', address: 'Av. Amazonas' } },
  })
  assert.equal(m.ubicacion.nombre, 'Ind Store')
  assert.equal(m.ubicacion.direccion, 'Av. Amazonas')
  assert.equal(m.ubicacion.url, 'https://www.google.com/maps/search/?api=1&query=-0.1754,-78.4776')
})

test('toMensaje expone la ubicacion de una fila sin raw, leyendola del texto', () => {
  const m = toMensaje({
    wa_message_id: 'WA2', telefono: '593999', tipo: 'texto',
    texto: '📍 -0.18640510737896,-78.49340057373', direccion: 'ENTRANTE',
  })
  assert.equal(m.ubicacion.lat, '-0.18640510737896')
  assert.equal(m.ubicacion.nombre, '')
})

test('toMensaje deja ubicacion en null en un mensaje normal', () => {
  const m = toMensaje({ wa_message_id: 'WA3', telefono: '593999', tipo: 'texto', texto: 'hola', direccion: 'ENTRANTE' })
  assert.equal(m.ubicacion, null)
})

// El saludo de la tienda empieza con 📍 y NO es una ubicacion: si esto falla,
// 173 mensajes se pintarian como un mapa a coordenadas inventadas.
test('toMensaje no convierte el saludo de la tienda en ubicacion', () => {
  const m = toMensaje({
    wa_message_id: 'WA4', telefono: '593999', tipo: 'texto', direccion: 'SALIENTE',
    texto: '📍 Estamos en Quito:\nAv. 6 de Diciembre y Mercurio.\n\nTe dejo el mapa 👇\nhttps://maps.app.goo.gl/qRJjcgEuA4aRKgdX9',
  })
  assert.equal(m.ubicacion, null)
  assert.ok(m.mensaje.startsWith('📍 Estamos en Quito'), 'el saludo se sigue viendo tal cual')
})
