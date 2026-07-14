import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// Catálogo Shopify para la pestaña TIENDA del panel derecho. Lee la tabla
// `crm.productos_shopify` (mismo proyecto Supabase, schema `crm`), que el sync del
// CRM mantiene fresca. Solo productos con foto (el objetivo es ENVIAR la imagen al
// cliente como si fuera una respuesta rápida). La imagen es una URL pública de
// cdn.shopify.com → se envía directo por /api/saliente sin proxy.
export const dynamic = 'force-dynamic'

// Este inbox es MANDI → tienda 'MANDARINA' en el catálogo. Override por env si hace falta.
const TIENDA = process.env.INBOX_TIENDA || 'MANDARINA'

export async function GET(req) {
  try {
    const q = (new URL(req.url).searchParams.get('q') || '').trim()

    // getSupabase() está scopeado al schema `inbox`; para el catálogo saltamos a `crm`.
    let query = getSupabase()
      .schema('crm')
      .from('productos_shopify')
      .select('id, title, price, image, variants')
      .eq('activo', true)
      .ilike('tienda', TIENDA)
    if (q) query = query.ilike('title', `%${q}%`)
    query = query.order('title').limit(400)

    const { data, error } = await query
    if (error) throw error

    const products = (data || [])
      .filter((p) => p.image) // sin foto no sirve para enviar
      .map((p) => ({
        id: p.id,
        title: p.title || '',
        price: p.price !== null && p.price !== undefined ? String(p.price) : '',
        image: p.image,
        variants: Array.isArray(p.variants) ? p.variants : [],
      }))

    return NextResponse.json({ products })
  } catch (e) {
    console.error('[/api/tienda]', e.message)
    // Degradar suave: la pestaña muestra "sin resultados" en vez de romper el panel.
    return NextResponse.json({ products: [], error: e.message })
  }
}
