// lib/producto-tocado.js — el ORIGEN real de un cliente de pauta: el producto que
// TOCÓ dentro del anuncio. Puro, sin red. Mismo archivo en MANDI e IND.
//
// ☠️ Un anuncio pautado (ej. Dragon Ball) muestra debajo productos del catálogo de
// Shopify. Si el cliente toca uno (ej. Tortugas Ninja), Meta abre el chat con un
// texto que escribe ELLA: "Me interesa <título de Shopify>. (<variante>)". El
// referral, en cambio, sigue diciendo el anuncio pautado — mismo source_id, mismo
// video, ningún campo de producto. Por eso la lista y el chat mostraban
// "Dragon Ball" a quien había elegido Tortugas Ninja (30 casos en MANDI en 30
// días, sep-oct 2026; IND tuvo los suyos en jul-sep).
//
// Formatos vistos en producción:
//   "Me interesa Hoodie Tortugas Ninja - Casey Jones."
//   "Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, 2XL)"
//   "Vi tu anuncio en Instagram.\nMe interesa Conjunto \"Dual Lifestyle\"."   (IND)
//   "Me interesa Zip Hoodie Venom \"Symbiote\". Buenos días me interesa"     (el cliente agrega)
const PREFIJO = /^\s*(?:vi tu anuncio en [^\n.]*\.\s*)?me interesa\s+/i

/** Lo que viene después de "Me interesa ", o '' si el texto no tiene esa forma. */
export function restoProductoTocado(texto) {
  const t = String(texto || '')
  const m = t.match(PREFIJO)
  return m ? t.slice(m[0].length) : ''
}

const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Nombre y variante leídos SOLO del texto, sin catálogo (para mostrar algo aunque
 * el producto no esté en Shopify con ese título):
 *   "Chaqueta X | Envío Gratis 🐉. (Azul, 2XL)" → { nombre: 'Chaqueta X | Envío Gratis 🐉', variante: 'Azul, 2XL' }
 */
export function partesProductoTocado(texto) {
  const resto = restoProductoTocado(texto).replace(/\s+/g, ' ').trim()
  if (!resto) return { nombre: '', variante: '' }
  const m = resto.match(/^(.*?)\.\s*\(([^()]+)\)\s*$/)
  if (m) return { nombre: m[1].trim(), variante: m[2].trim() }
  return { nombre: resto.replace(/\.\s*$/, '').trim(), variante: '' }
}

/**
 * Empareja el texto con los productos de Shopify ({ title, price, image, ... }).
 * Gana el título MÁS LARGO con el que EMPIEZA el texto (los títulos traen puntos,
 * "|", comillas y emojis: no sirve cortar en el punto), para que "Camisetas
 * Dragon Ball" no se coma a "Camisetas Dragon Ball - Vegeta".
 * Devuelve { productos, variante }: `productos` trae TODOS los que calzan con ese
 * título (puede haber duplicados en Shopify); vacío si ninguno.
 */
export function emparejarProductoTocado(texto, catalogo) {
  const resto = restoProductoTocado(texto)
  if (!resto) return { productos: [], variante: '' }
  const r = norm(resto)
  let mejor = []
  let largo = 0
  for (const p of Array.isArray(catalogo) ? catalogo : []) {
    const t = norm(p?.title)
    if (!t) continue
    // El título tiene que terminar donde termina el nombre: seguido del punto que
    // pone Meta, o del fin del texto. "Hoodie Spiderman" no calza con "Hoodie Spiderman 2099."
    if (!(r === t || r.startsWith(t + '.'))) continue
    if (t.length > largo) { mejor = [p]; largo = t.length }
    else if (t.length === largo) mejor.push(p)
  }
  if (!mejor.length) return { productos: [], variante: partesProductoTocado(texto).variante }
  // La variante se lee del texto ORIGINAL (con sus mayúsculas): `norm` solo pasa a
  // minúsculas y junta espacios, así que el largo del título es el mismo en los dos.
  const original = String(resto).normalize('NFC').replace(/\s+/g, ' ').trim()
  const v = original.slice(largo).match(/^\.?\s*\(([^()]+)\)/)
  return { productos: mejor, variante: (v?.[1] || '').trim() }
}
