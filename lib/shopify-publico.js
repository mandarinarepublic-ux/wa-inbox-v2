// lib/shopify-publico.js — Los productos PUBLICADOS de la tienda Mandarina, leídos de
// /products.json (público, sin credenciales). Lo usan el feed del catálogo de
// WhatsApp (/api/feed-catalogo) y su revisión diaria (/api/cron/catalogo): los dos
// tienen que ver EXACTAMENTE la misma lista, por eso vive en un solo lugar.

export const TIENDA = 'https://mandarinaec.com'

export async function productosDeShopify(tienda = TIENDA) {
  const todos = []
  for (let pagina = 1; pagina <= 20; pagina++) {     // 250 por página; tope 5.000
    const res = await fetch(`${tienda}/products.json?limit=250&page=${pagina}`, { cache: 'no-store' })
    // ☠️ `fetch` no lanza con 4xx/5xx: sin esto un error de Shopify sería una lista
    // VACÍA, y con REEMPLAZAR Meta borraría todo el catálogo. Mejor fallar.
    if (!res.ok) throw new Error(`Shopify respondió ${res.status}`)
    const d = await res.json()
    const lote = d?.products || []
    todos.push(...lote)
    if (lote.length < 250) break
  }
  return todos
}
