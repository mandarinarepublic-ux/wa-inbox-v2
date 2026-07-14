import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// Catálogo para la pestaña TIENDA del panel derecho. Dos fuentes (?fuente=):
//  - 'shopify' (default): catálogo online `crm.productos_shopify` (lo llena el sync del CRM).
//  - 'sucursal': inventario físico `crm.sucursal` (stock/talla/color, foto en Cloudinary).
// Ambas en el mismo proyecto Supabase (schema `crm`). Solo items con foto (el objetivo
// es ENVIAR la imagen al cliente). Filtro por tienda con ilike (maneja MANDARINA/Mandarina).
export const dynamic = 'force-dynamic'

// Tienda de este inbox. MANDI='MANDARINA'. Override por env si hace falta.
const TIENDA = process.env.INBOX_TIENDA || 'MANDARINA'

export async function GET(req) {
  try {
    const sp     = new URL(req.url).searchParams
    const q      = (sp.get('q') || '').trim()
    const fuente = (sp.get('fuente') || 'shopify').toLowerCase()
    const sb     = getSupabase()

    if (fuente === 'sucursal') {
      // Inventario físico de sucursal.
      let query = sb.schema('crm').from('sucursal')
        .select('id, nombre, precio, talla, color, stock, reservado, foto_url')
        .eq('activo', true)
        .ilike('tienda', TIENDA)
      if (q) query = query.ilike('nombre', `%${q}%`)
      query = query.order('nombre').limit(500)
      const { data, error } = await query
      if (error) throw error
      const products = (data || [])
        .filter((p) => p.foto_url)
        .map((p) => ({
          id: p.id,
          title: p.nombre || '',
          price: p.precio !== null && p.precio !== undefined ? String(p.precio) : '',
          image: p.foto_url,
          talla: p.talla || '',
          color: p.color || '',
          stock: p.stock,
          fuente: 'sucursal',
        }))
      return NextResponse.json({ products })
    }

    // Catálogo online Shopify (default).
    let query = sb.schema('crm').from('productos_shopify')
      .select('id, title, price, image, variants')
      .eq('activo', true)
      .ilike('tienda', TIENDA)
    if (q) query = query.ilike('title', `%${q}%`)
    query = query.order('title').limit(400)
    const { data, error } = await query
    if (error) throw error
    const products = (data || [])
      .filter((p) => p.image)
      .map((p) => ({
        id: p.id,
        title: p.title || '',
        price: p.price !== null && p.price !== undefined ? String(p.price) : '',
        image: p.image,
        variants: Array.isArray(p.variants) ? p.variants : [],
        fuente: 'shopify',
      }))
    return NextResponse.json({ products })
  } catch (e) {
    console.error('[/api/tienda]', e.message)
    return NextResponse.json({ products: [], error: e.message })
  }
}
