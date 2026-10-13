import { NextResponse } from 'next/server'
import { CATALOGO_POR_DEFECTO } from '@/lib/carrusel'
import { productosParaCarrusel } from '@/lib/catalogo-lista'

// 🛍️ GET /api/catalogo-productos → productos del catálogo de Meta conectado a la
// WABA, listos para elegir en el carrusel: SOLO con foto, publicados y con stock.
// Se lee de Meta (no del CRM) porque el carrusel exige el `retailer_id` EXACTO del
// catálogo, y el de MANDI mezcla formatos (ver lib/carrusel.js).
export const dynamic = 'force-dynamic'

const META_TOKEN = process.env.META_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v23.0'
const VIDA_MS = 10 * 60 * 1000
let cache = { hasta: 0, productos: null }   // por instancia: 248 productos no justifican tabla

async function leerDeMeta(catalogId) {
  const filas = []
  let url = `${GRAPH}/${catalogId}/products?fields=retailer_id,name,price,image_url,availability,visibility&limit=100`
            + `&access_token=${encodeURIComponent(META_TOKEN)}`
  for (let i = 0; url && i < 10; i++) {           // tope: 1.000 productos
    const res = await fetch(url, { cache: 'no-store' })
    const d = await res.json().catch(() => ({}))
    // `fetch` no lanza con 4xx: sin esto un token sin permiso se leería como "catálogo vacío".
    if (!res.ok) throw new Error(d?.error?.message || `Meta respondió ${res.status}`)
    filas.push(...(d.data || []))
    url = d?.paging?.next || ''
  }
  return filas
}

export async function GET(req) {
  try {
    if (!META_TOKEN) return NextResponse.json({ error: 'Falta META_TOKEN' }, { status: 500 })
    const fresco = new URL(req.url).searchParams.get('fresco') === '1'
    if (fresco || !cache.productos || cache.hasta < Date.now()) {
      const catalogId = String(process.env.CATALOG_ID || CATALOGO_POR_DEFECTO).trim()
      const filas = await leerDeMeta(catalogId)
      cache = { hasta: Date.now() + VIDA_MS, productos: productosParaCarrusel(filas), total: filas.length, catalogId }
    }
    return NextResponse.json(
      { productos: cache.productos, totalCatalogo: cache.total, catalogId: cache.catalogId },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[/api/catalogo-productos]', err)
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
