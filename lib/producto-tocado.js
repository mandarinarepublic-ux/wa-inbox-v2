// lib/producto-tocado.js — el producto que el cliente TOCÓ dentro del anuncio. Puro, sin red.
//
// ☠️ Un anuncio pautado (ej. Dragon Ball) muestra debajo productos del catálogo de
// Shopify. Si el cliente toca uno (ej. Tortugas Ninja), Meta abre el chat con un
// texto que escribe ELLA: "Me interesa <título exacto de Shopify>. (<variante>)".
// El referral, en cambio, sigue diciendo el anuncio pautado — mismo source_id,
// mismo video, ningún campo de producto. Decidir solo por el referral le mandaba
// al cliente el pitch del anuncio en vez del producto que eligió (30 casos en
// MANDI en 30 días, sep-oct 2026; IND tuvo los suyos en jul-sep).
//
// Por eso el producto se saca del TEXTO, y no con una regex sobre el punto (los
// títulos traen puntos, comillas, "|" y emojis): se busca el título de Shopify
// con el que EMPIEZA el texto. En caso de duda (ninguno o dos productos con el
// mismo título) no se adivina.

// Formatos vistos en producción:
//   "Me interesa Hoodie Tortugas Ninja - Casey Jones."
//   "Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)"
//   "Vi tu anuncio en Instagram.\nMe interesa Conjunto \"Dual Lifestyle\"."   (IND)
//   "Me interesa Zip Hoodie Venom \"Symbiote\". Buenos días me interesa"     (el cliente agrega)
const PREFIJO = /^\s*(?:vi tu anuncio en [^\n.]*\.\s*)?me interesa\s+/i

const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

/** Lo que viene después de "Me interesa ", o '' si el texto no tiene esa forma. */
export function restoProductoTocado(texto) {
  const t = String(texto || '')
  const m = t.match(PREFIJO)
  return m ? t.slice(m[0].length) : ''
}

/**
 * Empareja el texto con UN producto de la lista ({ title, price, image, ... }).
 * Devuelve { producto, variante } o { motivo } ('sin-formato' | 'ninguno' | 'varios').
 * Gana el título MÁS LARGO que calce, para que "Camisetas Dragon Ball" no se
 * coma a "Camisetas Dragon Ball - Vegeta".
 */
export function emparejarProductoTocado(texto, productos) {
  const resto = restoProductoTocado(texto)
  if (!resto) return { motivo: 'sin-formato' }
  const r = norm(resto)
  let mejor = []
  let largo = 0
  for (const p of Array.isArray(productos) ? productos : []) {
    const t = norm(p?.title)
    if (!t) continue
    // El título tiene que terminar donde termina el nombre: seguido del punto que
    // pone Meta, o del fin del texto. "Hoodie Spiderman" no calza con "Hoodie Spiderman 2099."
    const calza = r === t || r.startsWith(t + '.')
    if (!calza) continue
    if (t.length > largo) { mejor = [p]; largo = t.length }
    else if (t.length === largo) mejor.push(p)
  }
  if (!mejor.length) return { motivo: 'ninguno' }
  if (mejor.length > 1) return { motivo: 'varios' }
  // La variante se lee del texto ORIGINAL (con sus mayúsculas): `norm` solo pasa a
  // minúsculas y junta espacios, así que el largo del título es el mismo en los dos.
  const original = String(resto).normalize('NFC').replace(/\s+/g, ' ').trim()
  const v = original.slice(largo).match(/^\.?\s*\(([^()]+)\)/)
  return { producto: mejor[0], variante: (v?.[1] || '').trim() }
}

/** "35.00" → "$35" · "29.99" → "$29.99" · vacío → '' */
export function precioVisible(precio) {
  const n = Number(String(precio ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return ''
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/**
 * Los mensajes de bienvenida para el producto tocado, en el formato de
 * /api/saliente. El primero cita el mensaje del cliente (como las recetas).
 */
export function piezasProductoTocado({ producto, variante, contacto, citaId = '' }) {
  const base = { Telefono: contacto.telefono, Nombre: contacto.alias || contacto.nombre || '', Canal: contacto.phoneId }
  const precio = precioVisible(producto?.price)
  const lineas = [
    '¡Hola! 🧡 Bienvenid@ a Mandarina.',
    `Te interesó *${String(producto?.title || '').trim()}* 😍`,
  ]
  if (precio) lineas.push(`💲 Precio: ${precio}`)
  if (variante) lineas.push(`📏 Elegiste: ${variante}`)
  const piezas = [{ ...base, Mensaje: lineas.join('\n') }]
  if (producto?.image) piezas.push({ ...base, ImagenURL: producto.image })
  piezas.push({ ...base, Mensaje: variante ? `¿Te lo separo en ${variante}? 🙌` : '¿En qué talla lo estabas buscando?' })
  const cita = String(citaId || '').trim()
  if (cita) piezas[0] = { ...piezas[0], ContextoId: cita }
  return piezas
}
