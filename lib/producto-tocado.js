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
