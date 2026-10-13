import { csvDelFeed } from '@/lib/feed-catalogo'

// 🛍️ GET /api/feed-catalogo → CSV de los productos publicados en Shopify, para la
// "fuente de datos programada" de CatMandSF en Commerce Manager (lib/feed-catalogo.js).
//
// PÚBLICA a propósito (lib/rutas-publicas.js): la lee Meta, que no tiene sesión.
// No expone nada que la tienda no muestre ya en /products.json.
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TIENDA = 'https://mandarinaec.com'

async function productosDeShopify() {
  const todos = []
  for (let pagina = 1; pagina <= 20; pagina++) {     // 250 por página; tope 5.000
    const res = await fetch(`${TIENDA}/products.json?limit=250&page=${pagina}`, { cache: 'no-store' })
    // ☠️ `fetch` no lanza con 4xx/5xx: sin esto un error de Shopify sería un feed
    // VACÍO, y Meta podría bajar todo el catálogo. Mejor fallar y que Meta reintente.
    if (!res.ok) throw new Error(`Shopify respondió ${res.status}`)
    const d = await res.json()
    const lote = d?.products || []
    todos.push(...lote)
    if (lote.length < 250) break
  }
  return todos
}

export async function GET() {
  try {
    const productos = await productosDeShopify()
    if (!productos.length) throw new Error('Shopify no devolvió productos')
    return new Response(csvDelFeed(productos, TIENDA), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Meta la lee una vez al día: una hora de caché en el borde basta y ahorra.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch (err) {
    console.error('[/api/feed-catalogo]', err)
    return new Response(`error: ${err.message}\n`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}
