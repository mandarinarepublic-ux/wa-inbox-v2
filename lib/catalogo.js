// lib/catalogo.js — de qué producto habla un pedido del catálogo de WhatsApp.
//
// ☠️ EL PROBLEMA. Cuando alguien compra desde el catálogo, Meta manda SOLO esto:
//
//   { "catalog_id": "3995559414068729",
//     "product_items": [{ "product_retailer_id": "44500256129117",
//                         "quantity": 1, "item_price": 35 }] }
//
// Ni nombre ni foto. El chat mostraba "1 × $35.00 (44500256129117)" y nadie sabía
// qué se había vendido. Medido el 4-sep-2026: 20 pedidos ($760 en dos meses,
// 15 de ellos del último mes) y NINGUNO se podía identificar.
//
// ⚠️ Y el precio no sirve para adivinar: 45 productos de MANDARINA cuestan $35.
//
// Se resuelve AL LEER, no al guardar, por lo mismo que las ubicaciones: así vale
// para los pedidos que ya estaban en la base, sin migración ni backfill.

// ── LÓGICA PURA (con pruebas en tests/catalogo.test.js) ──────────

/**
 * Saca el catálogo y las líneas de un payload de Meta. null si no es un pedido.
 */
export function itemsDePedido(raw) {
  const o = raw?.order
  if (!o || !Array.isArray(o.product_items)) return null
  return {
    catalogId: String(o.catalog_id || ''),
    items: o.product_items.map((it) => ({
      retailerId: String(it?.product_retailer_id || ''),
      cant:       Number(it?.quantity) || 0,
      precio:     Number(it?.item_price) || 0,
      moneda:     String(it?.currency || 'USD'),
    })),
  }
}

/**
 * Le pega a cada línea lo que se pudo resolver (nombre, foto, color).
 *
 * ☠️ Una línea que NO resuelve conserva su id y NO se descarta. Siete ids de IND
 * no tienen forma de resolverse hoy (su catálogo no pertenece a "Mandarina Lab");
 * si esas líneas se filtraran, un pedido de 2 artículos se vería como de 1. Es la
 * misma regla que el filtro que escondía clientes: sin dato NO significa sin fila.
 */
export function armarPedido(items, mapa) {
  return (items || []).map((it) => {
    const p = mapa?.get?.(it.retailerId) || null
    return {
      ...it,
      nombre: p?.nombre || '',
      imagen: p?.imagen || '',
      color:  p?.color  || '',
      total:  it.cant * it.precio,
    }
  })
}

// ── RESOLUCIÓN (I/O) ─────────────────────────────────────────────
import { getSupabase } from './supabase.js'

const GRAPH = 'https://graph.facebook.com/v22.0'
const META_TOKEN = process.env.META_TOKEN || ''

// Tres saltos, del más barato al más caro. El primero que resuelve, gana.
//
//   1. inbox.catalogo_cache — ya resuelto antes.
//   2. crm.productos_shopify — el catálogo que el CRM ya sincroniza. GRATIS y sin
//      credenciales. Cubre los catálogos cuyo retailer_id ES el id de producto de
//      Shopify (CatMandSF en MANDI, y el de 13 dígitos en IND).
//   3. Graph API de Meta — para los catálogos cuyo retailer_id es un id de
//      VARIANTE (14 dígitos) o alfanumérico, que no están en la tabla del CRM.
//
// ⚠️ El salto 3 NO puede resolver los catálogos de IND (504784567047953 y
// 1522125412466684): no pertenecen a "Mandarina Lab" y el token no los ve. Eso
// no se arregla con código — hay que darle acceso al token o averiguar de quién
// son. Mientras tanto esas líneas muestran su id, que es lo honesto.

const nunca = (p) => p.catch(() => null)   // esto NUNCA puede tumbar un chat

async function deCache(catalogId, ids) {
  const sb = getSupabase()
  const { data } = await sb.from('catalogo_cache')
    .select('retailer_id, nombre, imagen, color')
    .eq('catalog_id', catalogId).in('retailer_id', ids)
  return data || []
}

async function deShopify(ids) {
  const sb = getSupabase()
  const { data } = await sb.schema('crm').from('productos_shopify')
    .select('id, title, image').in('id', ids)
  return (data || []).map((p) => ({
    retailer_id: String(p.id), nombre: p.title || '', imagen: p.image || '', color: '', fuente: 'shopify',
  }))
}

async function deMeta(catalogId, ids) {
  if (!META_TOKEN || !catalogId) return []
  const filtro = encodeURIComponent(JSON.stringify({ retailer_id: { is_any: ids } }))
  const url = `${GRAPH}/${catalogId}/products?fields=retailer_id,name,image_url,color&limit=100`
              + `&filter=${filtro}&access_token=${encodeURIComponent(META_TOKEN)}`
  const res = await fetch(url)
  // ⚠️ `fetch` NO lanza con 4xx/5xx. Sin mirar `res.ok`, un catálogo sin acceso
  // (el caso de IND) devolvería un cuerpo de error que se leería como datos.
  if (!res.ok) return []
  const d = await res.json().catch(() => ({}))
  return (d?.data || []).map((p) => ({
    retailer_id: String(p.retailer_id || ''), nombre: p.name || '',
    imagen: p.image_url || '', color: p.color || '', fuente: 'meta',
  }))
}

async function guardarEnCache(catalogId, filas) {
  if (!filas.length) return
  const sb = getSupabase()
  await sb.from('catalogo_cache').upsert(
    filas.map((f) => ({ ...f, catalog_id: catalogId, actualizado_at: new Date().toISOString() })),
    { onConflict: 'catalog_id,retailer_id' },
  )
}

/** Map retailerId → { nombre, imagen, color }. Nunca lanza: sin datos, Map vacío. */
export async function resolverProductos(catalogId, retailerIds) {
  const mapa = new Map()
  const ids = [...new Set((retailerIds || []).filter(Boolean))]
  if (!ids.length) return mapa

  const meter = (fs) => (fs || []).forEach((f) => {
    if (f.retailer_id && (f.nombre || f.imagen)) {
      mapa.set(f.retailer_id, { nombre: f.nombre, imagen: f.imagen, color: f.color })
    }
  })
  const faltan = () => ids.filter((id) => !mapa.has(id))

  meter(await nunca(deCache(catalogId, ids)))
  if (!faltan().length) return mapa

  const shop = (await nunca(deShopify(faltan()))) || []
  meter(shop)
  await nunca(guardarEnCache(catalogId, shop))
  if (!faltan().length) return mapa

  const meta = (await nunca(deMeta(catalogId, faltan()))) || []
  meter(meta)
  await nunca(guardarEnCache(catalogId, meta))
  return mapa
}

/** El pedido listo para pintar, o null si el mensaje no es un pedido. */
export async function pedidoDeMensaje(raw) {
  const p = itemsDePedido(raw)
  if (!p) return null
  const mapa = await resolverProductos(p.catalogId, p.items.map((i) => i.retailerId))
  const items = armarPedido(p.items, mapa)
  return {
    catalogId: p.catalogId,
    items,
    total: items.reduce((s, i) => s + i.total, 0),
    moneda: items[0]?.moneda || 'USD',
  }
}
