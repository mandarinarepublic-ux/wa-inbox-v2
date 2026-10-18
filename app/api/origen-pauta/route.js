import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { completarAnunciosDesdeMeta } from '@/lib/anuncios-meta'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { nombreDeAnuncio } from '@/lib/anuncio-vista'
import { emparejarProductoTocado, partesProductoTocado } from '@/lib/producto-tocado'

// ORIGEN real de un cliente de pauta, para el cuadro del chat:
//   Pauta  → el anuncio por el que entró (nombre del Administrador de anuncios + campaña).
//   Producto → lo que TOCÓ dentro del anuncio ("Me interesa X." lo escribe Meta),
//              con su foto y precio de Shopify si el título calza.
// Solo lectura: no cambia ni envía nada. Ver lib/producto-tocado.js.
export const dynamic = 'force-dynamic'

// MANDI='MANDARINA'. Mismo override que /api/tienda.
const TIENDA = process.env.INBOX_TIENDA || 'MANDARINA'

// El catálogo cambia poco (lo llena el sync del CRM): se guarda 10 min por instancia.
let catalogoCache = { filas: null, at: 0 }
async function catalogo(sb) {
  if (catalogoCache.filas && Date.now() - catalogoCache.at < 600000) return catalogoCache.filas
  // ~300 productos por tienda: lejos del tope de 1000 de PostgREST, pero se pide
  // con un rango explícito y se avisa si algún día se llega.
  const { data, error } = await sb.schema('crm').from('productos_shopify')
    .select('title, price, image').eq('activo', true).ilike('tienda', TIENDA).order('id').range(0, 999)
  if (error) throw error
  if ((data || []).length >= 1000) console.warn('[/api/origen-pauta] el catálogo llegó a 1000 filas: hay que paginar')
  catalogoCache = { filas: data || [], at: Date.now() }
  return catalogoCache.filas
}

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams
    const sourceId = String(sp.get('source_id') || '').trim()
    const texto = sp.get('texto') || ''
    const sb = getSupabase()

    let pauta = null
    if (sourceId) {
      const { data } = await sb.from('anuncios')
        .select('source_id, etiqueta, titular, nombre_anuncio, texto, campana, estado_anuncio')
        .eq('cuenta', CUENTA).eq('source_id', sourceId).maybeSingle()
      if (data) pauta = { nombre: nombreDeAnuncio(data), campana: data.campana || '', estado: data.estado_anuncio || '' }
      // Pauta nueva sin nombre todavía: el nombre de Meta solo se pedía al abrir AUTOS
      // o FLUJOS. Se pide acá también, sin hacer esperar al chat; el próximo que abra
      // el chat ya lo ve. (Cada 12 h se vuelve a leer: si se renombra, se actualiza.)
      if (!data?.nombre_anuncio) waitUntil(completarAnunciosDesdeMeta(CUENTA).catch(e => console.error('[/api/origen-pauta] nombre de Meta:', e.message)))
    }

    const partes = partesProductoTocado(texto)
    let producto = null
    let variante = partes.variante
    if (partes.nombre) {
      const r = emparejarProductoTocado(texto, await catalogo(sb))
      variante = r.variante || variante
      // Duplicados en Shopify (mismo título): para MOSTRAR da igual cuál; se usa el
      // primero con foto.
      const p = r.productos.find(x => x.image) || r.productos[0]
      producto = p
        ? { titulo: p.title, imagen: p.image || '', precio: p.price ?? '', enShopify: true }
        : { titulo: partes.nombre, imagen: '', precio: '', enShopify: false }
    }

    return NextResponse.json({ pauta, producto, variante })
  } catch (err) {
    console.error('[/api/origen-pauta]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
