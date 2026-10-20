import { csvDelFeed, MINIMO_PRODUCTOS } from '@/lib/feed-catalogo'
import { productosDeShopify, TIENDA } from '@/lib/shopify-publico'

// 🛍️ GET /api/feed-catalogo → CSV de los productos publicados en Shopify, para la
// "fuente de datos programada" de CatMandSF en Commerce Manager (lib/feed-catalogo.js).
//
// PÚBLICA a propósito (lib/rutas-publicas.js): la lee Meta, que no tiene sesión.
// No expone nada que la tienda no muestre ya en /products.json.
export const dynamic = 'force-dynamic'
export const maxDuration = 30


export async function GET() {
  try {
    const productos = await productosDeShopify()
    // Con el REEMPLAZAR diario, una lista corta BORRARÍA el catálogo: mejor error.
    return new Response(csvDelFeed(productos, TIENDA, MINIMO_PRODUCTOS), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Meta la lee una vez al día (6:30); 10 min de caché en el borde para que al
        // dispararla a mano desde Commerce Manager no lea una lista vieja.
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error('[/api/feed-catalogo]', err)
    return new Response(`error: ${err.message}\n`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}
