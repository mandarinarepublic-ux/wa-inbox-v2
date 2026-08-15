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

test('toMensaje NO inventa texto para un tipo comun con texto vacio de verdad (fantasma real)', () => {
  const fila = { telefono: '593987654321', tipo: 'texto', texto: '', media_url: '', media_id: '', botones: '' }
  const m = toMensaje(fila)
  assert.equal(m.mensaje, '')
  assert.ok(!esPintable(m), 'un fantasma real se sigue descartando')
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
