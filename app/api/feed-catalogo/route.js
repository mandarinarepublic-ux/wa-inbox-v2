import { csvDelFeed, MINIMO_PRODUCTOS } from '@/lib/feed-catalogo'

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
    // Con el REEMPLAZAR diario, una lista corta BORRARÍA el catálogo: mejor error.
    return new Response(csvDelFeed(productos, TIENDA, MINIMO_PRODUCTOS), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Meta la lee cada hora: 10 min de caché en el borde para que lo nuevo no se atrase.
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('[/api/feed-catalogo]', err)
    return new Response(`error: ${err.message}\n`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}
