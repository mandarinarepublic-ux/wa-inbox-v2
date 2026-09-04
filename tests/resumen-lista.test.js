import test from 'node:test'
import assert from 'node:assert'
import { resumenDeLista } from '../lib/resumen-lista.js'

// En 30 días, 816 conversaciones arrancan con EXACTAMENTE el mismo texto
// ("¡Hola! Quiero más información."): en la lista se ven todas iguales y no hay
// forma de saber qué quiere cada quien. El dato sí está — en el anuncio del que
// vienen. Acá se decide qué se pinta en esa segunda línea.
const ent = (o) => ({ direccion: 'ENTRANTE', tipo: 'texto', mensaje: '', referral: null, ...o })

test('un lead de pauta muestra la PRIMERA LINEA del anuncio', () => {
  const r = resumenDeLista(ent({
    mensaje: '¡Hola! Quiero más información.',
    referral: { headline: 'Mandarina Republic', body: '🔥 Chaqueta Varsity Dragon Ball Z – Naranja🔥\nEnvío gratis' },
  }))
  assert.equal(r.icono, '🎯')
  assert.equal(r.texto, '🔥 Chaqueta Varsity Dragon Ball Z – Naranja🔥')
})

// ☠️ El TITULAR es basura: en 30 días solo hay 3 distintos en MANDI y son
// "Chatear", "api.whatsapp.com" y "Mandarina Republic". El cuerpo es el que
// dice qué se vende. Por eso el orden es cuerpo primero, titular de respaldo.
test('sin cuerpo cae al titular, pero NUNCA a uno que sea un dominio', () => {
  assert.equal(resumenDeLista(ent({ referral: { headline: 'LA NECESITO', body: '' } })).texto, 'LA NECESITO')
  assert.equal(resumenDeLista(ent({ referral: { headline: 'api.whatsapp.com', body: '' } })), null)
})

test('un pedido del catalogo se anuncia como tal', () => {
  const r = resumenDeLista(ent({ tipo: 'order', mensaje: '📦 Pedido del catálogo — 1 artículo · $35.00\n • 1 × $35.00' }))
  assert.equal(r.icono, '📦')
})

test('el boton de la web muestra el producto, no el saludo', () => {
  const r = resumenDeLista(ent({ mensaje: 'Hola! Me interesa este producto: Hoodie X-men Ciclope' }))
  assert.equal(r.icono, '🛍️')
  assert.equal(r.texto, 'Hoodie X-men Ciclope')
})

// ☠️ En cuanto se contesta, la lista tiene que volver a mostrar lo último que se
// dijo. Si la etiqueta se quedara pegada, la lista dejaría de contar el estado
// real de la conversación — y esa segunda línea es como se escanea la bandeja.
test('un SALIENTE nunca lleva etiqueta: manda el ultimo mensaje', () => {
  assert.equal(resumenDeLista({ direccion: 'SALIENTE', tipo: 'texto', mensaje: '¿En qué talla?', referral: { body: 'X' } }), null)
})

test('un entrante normal se queda como esta hoy', () => {
  assert.equal(resumenDeLista(ent({ mensaje: 'hola, tienen talla M?' })), null)
  assert.equal(resumenDeLista(null), null)
})

// Kakaroto 2000: cayó en el ~5% que Meta manda SIN referral. No hay dato que
// inventar — se queda con su texto, y al quedar sin etiqueta entre cientos que
// sí la tienen, SALTA A LA VISTA en vez de esconderse.
test('un lead sin referral no se inventa un origen', () => {
  assert.equal(resumenDeLista(ent({ mensaje: '¡Hola! Quiero más información.' })), null)
})
