// lib/feed-catalogo.js — 🛍️ La lista de productos que Meta lee sola cada día para
// el catálogo de WhatsApp (CatMandSF). Diseño 13-oct-2026. Módulo PURO.
//
// ☠️ Por qué existe: CatMandSF NO está conectado a Shopify (el catálogo que sí
// sincroniza quedó amarrado a la WABA vieja borrada, ver la memoria del catálogo),
// y el 13-oct le faltaban 66 de los 228 productos publicados. Con esta lista como
// "fuente de datos programada" en Commerce Manager, lo que se publica en Shopify
// aparece en WhatsApp al día siguiente sin tocar nada.
//
// El `id` es el id de PRODUCTO de Shopify: el mismo que ya usan los ~160 productos
// buenos del catálogo (no se duplican, se actualizan) y el que el inbox ya resuelve
// en los pedidos (crm.productos_shopify). La fuente es /products.json de la tienda,
// que es público: solo trae lo publicado en la tienda online.

export const COLUMNAS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price',
  'link', 'image_link', 'additional_image_link', 'brand', 'product_type']

const sinHtml = (h) => String(h || '')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|div|h\d)>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim()

const precio = (n) => `${Number(n).toFixed(2)} USD`

/** Un producto de /products.json → fila del feed, o null si no se puede publicar (sin foto o sin precio). */
export function filaDeProducto(p, dominio = 'https://mandarinaec.com') {
  const fotos = (p?.images || []).map((i) => i?.src).filter(Boolean)
  const variantes = (p?.variants || []).filter((v) => Number(v?.price) > 0)
  if (!p?.id || !p?.handle || !fotos.length || !variantes.length) return null
  const disponibles = variantes.filter((v) => v.available)
  // El precio que ve el cliente: la variante más barata de las que hay en stock.
  const base = (disponibles.length ? disponibles : variantes)
    .reduce((a, v) => (Number(v.price) < Number(a.price) ? v : a))
  const antes = Number(base.compare_at_price)
  const conDescuento = antes > Number(base.price)
  const titulo = String(p.title || '').trim().slice(0, 200)
  return {
    id: String(p.id),
    title: titulo,
    // Meta exige descripción: sin texto en Shopify, va el título.
    description: (sinHtml(p.body_html) || titulo).slice(0, 5000),
    availability: disponibles.length ? 'in stock' : 'out of stock',
    condition: 'new',
    price: precio(conDescuento ? antes : base.price),
    sale_price: conDescuento ? precio(base.price) : '',
    link: `${dominio}/products/${p.handle}`,
    image_link: fotos[0],
    additional_image_link: fotos.slice(1, 10).join(','),
    brand: String(p.vendor || 'Mandarina Republic').trim() || 'Mandarina Republic',
    product_type: String(p.product_type || '').trim(),
  }
}

const celda = (v) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Productos de Shopify → CSV con encabezado, listo para Meta. */
export function csvDelFeed(productos, dominio) {
  const filas = (productos || []).map((p) => filaDeProducto(p, dominio)).filter(Boolean)
  return [COLUMNAS.join(','), ...filas.map((f) => COLUMNAS.map((c) => celda(f[c])).join(','))].join('\n') + '\n'
}
