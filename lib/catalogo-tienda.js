// lib/catalogo-tienda.js — catálogo online de Shopify de esta tienda, para el webhook.
// Misma tabla que la pestaña TIENDA (/api/tienda): crm.productos_shopify, la llena
// el sync del CRM. SOLO server-side.
import { getSupabase } from './supabase.js'
import { paginarLimite } from './inbox-supabase.js'

// MANDI='MANDARINA'. Mismo override que /api/tienda.
const TIENDA = process.env.INBOX_TIENDA || 'MANDARINA'

/** Productos activos { id, title, price, image }. ☠️ PostgREST corta en 1000: se pagina por id. */
export async function getCatalogoActivo() {
  const sb = getSupabase()
  return paginarLimite(async (desde, hasta) => {
    const { data, error } = await sb.schema('crm').from('productos_shopify')
      .select('id, title, price, image')
      .eq('activo', true)
      .ilike('tienda', TIENDA)
      .order('id')
      .range(desde, hasta)
    if (error) throw error
    return data
  })
}
