import { NextResponse } from 'next/server'
import { autorizadoCron } from '@/lib/cron-auth'
import { env } from '@/lib/env'
import { getSupabase } from '@/lib/supabase'
import { filaDeProducto } from '@/lib/feed-catalogo'
import { productosDeShopify, TIENDA } from '@/lib/shopify-publico'
import { compararCatalogos } from '@/lib/catalogo-revision'
import { CATALOGO_POR_DEFECTO } from '@/lib/carrusel'

// 🛍️ Revisión diaria del catálogo de WhatsApp (7:00 Guayaquil, vercel.json):
// ¿CatMandSF quedó igual a Shopify después de la carga de Meta de las 6:30?
// Deja una corrida en ⏱️ Tareas automáticas del CRM (crm.tareas_auto_corridas).
// La comparación es pura (lib/catalogo-revision.js); acá solo se leen las listas.
//
// No arregla nada por su cuenta: el que carga es Meta. Si algo no cuadra, lo dice.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GRAPH = 'https://graph.facebook.com/v22.0'
const FUENTE = '1179484123962008'   // "Productos CatMandSF" (REEMPLAZAR diario 6:30)
const TAREA = 'catalogo_whatsapp_mandi'

async function graph(ruta) {
  const sep = ruta.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}${ruta}${sep}access_token=${encodeURIComponent(env('META_TOKEN'))}`, { cache: 'no-store' })
  const d = await res.json().catch(() => ({}))
  // ☠️ `fetch` no lanza con 4xx/5xx: un error de Meta leído como datos sería un
  // catálogo "vacío" y la revisión diría que sobran o faltan todos.
  if (!res.ok) throw new Error(`Meta ${res.status}: ${d?.error?.message || 'sin detalle'}`)
  return d
}

async function productosDeMeta(catalogo) {
  const items = []
  let ruta = `/${catalogo}/products?fields=retailer_id,name,price,sale_price,availability&limit=250`
  for (let i = 0; ruta && i < 40; i++) {
    const d = await graph(ruta)
    items.push(...(d?.data || []))
    const sig = d?.paging?.next
    ruta = sig ? sig.replace(GRAPH, '').replace(/[?&]access_token=[^&]*/, '') : null
  }
  return items
}

async function ultimaCarga() {
  try {
    const d = await graph(`/${FUENTE}/uploads?limit=1&fields=start_time,end_time,num_detected_items,num_persisted_items,num_deleted_items,error_count`)
    const u = d?.data?.[0]
    if (!u) return null
    return {
      inicio: u.start_time, fin: u.end_time || null, detectados: u.num_detected_items ?? null,
      guardados: u.num_persisted_items ?? null, borrados: u.num_deleted_items ?? 0, errores: u.error_count ?? 0,
    }
  } catch (e) {
    // Sin permiso para leer las cargas, la comparación igual sirve: se dice y se sigue.
    console.error('[cron/catalogo] no se pudo leer la última carga', e.message)
    return null
  }
}

export async function GET(req) {
  if (!autorizadoCron(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const inicio = new Date()
  const catalogo = env('CATALOG_ID') || CATALOGO_POR_DEFECTO
  let corrida
  try {
    const [productos, items, carga] = await Promise.all([productosDeShopify(), productosDeMeta(catalogo), ultimaCarga()])
    const filas = productos.map((p) => filaDeProducto(p, TIENDA)).filter(Boolean)
    corrida = compararCatalogos(filas, items, carga, inicio)
  } catch (err) {
    console.error('[cron/catalogo]', err)
    corrida = { estado: 'error', resumen: `No se pudo comparar: ${err.message}`, detalle: null }
  }

  // El panel es la única salida de esta revisión: si no se puede escribir, el cron
  // responde 500 para que quede en los logs de Vercel (un 200 mentiría).
  const { error } = await getSupabase().schema('crm').from('tareas_auto_corridas').insert({
    tarea_id: TAREA, inicio: inicio.toISOString(), fin: new Date().toISOString(),
    estado: corrida.estado, resumen: corrida.resumen, detalle: corrida.detalle,
  })
  if (error) {
    console.error('[cron/catalogo] no se pudo guardar la corrida', error)
    return NextResponse.json({ ok: false, error: error.message, ...corrida }, { status: 500 })
  }
  return NextResponse.json({ ok: true, estado: corrida.estado, resumen: corrida.resumen })
}
