// lib/media-cache.js — memoria de los media_id de Meta, por URL de foto.
//
// El problema que resuelve: las fotos de las RESPUESTAS RÁPIDAS, del catálogo
// Shopify y del inventario de sucursal tienen una URL FIJA, pero en cada envío
// las volvíamos a descargar enteras y a re-subir a Meta para sacar el media_id
// (~5-8 s por foto). Una respuesta rápida de 5 fotos tardaba 40 segundos, y al
// siguiente cliente se repetía el mismo trabajo desde cero.
//
// Meta conserva un media_id subido durante 30 días. Guardándolo acá, la primera
// vez cuesta igual que antes y de ahí en adelante la foto sale en ~300 ms.
//
// La clave es (phone_id, url): un media_id SOLO sirve para el número de teléfono
// que lo subió. Si algún día cambia el phone id (a IND ya le pasó), la caché
// vieja simplemente no matchea y se vuelve a subir — no hay ids cruzados.
import { getSupabase, CUENTA } from './supabase.js'

// Meta los guarda 30 días. Usamos 25 para no quedarnos con uno que caduque justo
// entre que lo leemos y lo mandamos.
const DIAS_VALIDO = 25
const MS_VALIDO = DIAS_VALIDO * 24 * 60 * 60 * 1000

/**
 * media_id vigente para esa foto, o '' si no hay (o si la caché falla).
 * Nunca lanza: si la caché no responde, el envío sigue por el camino largo.
 */
export async function getMediaIdCache(phoneId, url) {
  if (!phoneId || !url) return ''
  try {
    const sb = getSupabase()
    const { data, error } = await sb
      .from('media_cache')
      .select('media_id, creado_en')
      .eq('phone_id', String(phoneId))
      .eq('url', String(url))
      .maybeSingle()
    if (error || !data?.media_id) return ''
    if (Date.now() - new Date(data.creado_en).getTime() > MS_VALIDO) return ''
    return String(data.media_id)
  } catch (e) {
    console.error('[media-cache] lectura falló:', e.message)
    return ''
  }
}

/** Guarda el media_id recién subido. Best-effort: si falla, no rompe el envío. */
export async function setMediaIdCache(phoneId, url, mediaId) {
  if (!phoneId || !url || !mediaId) return
  try {
    const sb = getSupabase()
    const ahora = new Date().toISOString()
    await sb.from('media_cache').upsert(
      { phone_id: String(phoneId), url: String(url), media_id: String(mediaId), cuenta: CUENTA, creado_en: ahora, usado_en: ahora },
      { onConflict: 'phone_id,url' },
    )
  } catch (e) {
    console.error('[media-cache] escritura falló:', e.message)
  }
}

/** Borra la entrada (el id que teníamos ya no le sirve a Meta). */
export async function invalidarMediaId(phoneId, url) {
  if (!phoneId || !url) return
  try {
    const sb = getSupabase()
    await sb.from('media_cache').delete().eq('phone_id', String(phoneId)).eq('url', String(url))
  } catch (e) {
    console.error('[media-cache] invalidación falló:', e.message)
  }
}

/**
 * ¿El error de Meta dice que el media_id no sirve?
 * Códigos típicos: 131052 (media download error), 100 con "media id"/"object" inválido.
 * Ante la duda preferimos reintentar subiendo de nuevo: cuesta una subida, no una
 * venta perdida.
 */
export function esErrorDeMediaId(data) {
  const err = data?.error
  if (!err) return false
  const code = Number(err.code)
  if (code === 131052 || code === 131053) return true
  const msg = `${err.message || ''} ${err.error_data?.details || ''}`.toLowerCase()
  return msg.includes('media') && (msg.includes('not exist') || msg.includes('invalid') || msg.includes('expired') || msg.includes('unsupported'))
}
