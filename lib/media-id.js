// lib/media-id.js — convertir la URL de una foto en un media_id de Meta.
//
// Vivía dentro de app/api/saliente/route.js. Se movió acá porque ahora lo usan
// DOS rutas: el envío de siempre y /api/media/precache, que resuelve todas las
// fotos de una respuesta rápida EN PARALELO antes de empezar a mandarlas.
//
// Encima de la subida hay una caché (lib/media-cache.js): la misma foto no se
// vuelve a descargar ni a subir mientras su media_id siga vivo en Meta.
import { getMediaIdCache, setMediaIdCache, invalidarMediaId, esErrorDeMediaId } from './media-cache.js'

export { invalidarMediaId, esErrorDeMediaId }

const META_TOKEN = process.env.META_TOKEN || ''
export const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'

// Descarga la imagen con User-Agent de navegador, timeout y reintentos.
// imgbb (i.ibb.co) y algunos CDNs responden lento o con 5xx/403 a los fetch
// server-side "pelados": un único intento hacía que la conversión a media id
// fallara y cayéramos al envío por LINK, que Meta luego NO podía bajar y el
// mensaje moría con status `failed` (131053). Con reintentos la conversión casi
// siempre gana, así el envío va por media id (que nunca falla).
async function descargarImagen(url, intentos = 3) {
  let ultimoError
  for (let i = 0; i < intentos; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MandarinaInbox/1.0)', Accept: 'image/*' },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t))
      if (res.ok) return res
      ultimoError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      ultimoError = e
    }
    if (i < intentos - 1) await new Promise(r => setTimeout(r, 400 * (i + 1))) // backoff 400ms, 800ms
  }
  throw new Error(`no se pudo descargar la imagen (${ultimoError?.message || 'desconocido'})`)
}

// WhatsApp acepta imágenes de hasta 5 MB, y las fotos de producto de Shopify son
// PNG de 8 MB: fallaban SIEMPRE y por los dos caminos —la subida a Meta las
// rechaza por tamaño, caemos al envío por link, y Meta las baja y las rechaza
// igual (status `failed`, 131053)—, así que el vendedor creía haberlas mandado.
// El CDN de Shopify redimensiona solo: pidiéndole `width` devuelve la misma foto
// mucho más liviana (los 8,07 MB de REDRANGER quedan en 3,78 MB a 1600px).
const LIMITE_META = 5 * 1024 * 1024

export function urlLiviana(url, ancho = 1600) {
  try {
    const u = new URL(url)
    if (!u.hostname.endsWith('shopify.com')) return url
    if (u.searchParams.has('width')) return url // ya viene pedida en un tamaño
    u.searchParams.set('width', String(ancho))
    return u.toString()
  } catch {
    return url // si no es una URL válida, que siga el camino de siempre
  }
}

// `phoneId`: el media_id que devuelve Meta pertenece AL NÚMERO que lo subió. Si
// se sube por un número y se manda por otro, Meta lo rechaza. Por eso viaja el
// canal hasta acá y no se asume el principal.
export async function subirImagenAMeta(url, phoneId = META_PHONE_ID) {
  // Escalera de tamaños: 1600px deja la foto en 3,78 MB (pasa, pero con poco
  // margen) y 1000px en 1,76 MB. Si la primera no entra, se prueba la más chica
  // antes de rendirse. Lo que no es de Shopify tiene un solo intento: no hay
  // forma de pedirlo más liviano.
  const versiones = urlLiviana(url) === url
    ? [url]
    : [urlLiviana(url, 1600), urlLiviana(url, 1000)]

  let ultimoTamano = 0
  for (const version of versiones) {
    const img = await descargarImagen(version)
    const buf = await img.arrayBuffer()
    ultimoTamano = buf.byteLength
    if (buf.byteLength > LIMITE_META) continue

    const mime = img.headers.get('content-type') || 'image/jpeg'
    const ext  = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'

    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: mime }), `imagen.${ext}`)
    fd.append('messaging_product', 'whatsapp')

    const res  = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}` },
      body: fd,
    })
    const data = await res.json().catch(() => ({}))
    if (!data?.id) throw new Error(data?.error?.message || `upload a Meta falló (HTTP ${res.status})`)
    return data.id
  }

  // Ninguna versión entró en el límite. Mandarla por link solo cambia el momento
  // del fracaso, no el resultado: mejor decirlo ahora.
  const mb = (ultimoTamano / 1048576).toFixed(1)
  const e = new Error(`la foto pesa ${mb} MB y WhatsApp acepta hasta 5 MB`)
  e.demasiadoGrande = true
  throw e
}

// Subidas en vuelo, por URL. Sin esto, mandar la misma foto a dos clientes al
// mismo tiempo (o dos fotos repetidas en la misma respuesta rápida) dispara dos
// subidas idénticas en paralelo, y la segunda no se ahorra nada.
const enVuelo = new Map()

/**
 * media_id para esa URL: de la caché si existe, y si no la sube a Meta y la guarda.
 * Lanza si no se pudo (con `demasiadoGrande` cuando el problema es el peso).
 */
export async function resolverMediaId(url, phoneId) {
  phoneId = phoneId || META_PHONE_ID
  // La caché ya estaba indexada por (phone_id, url), así que cada número tiene
  // sus propios ids sin tocar el esquema.
  const cacheado = await getMediaIdCache(phoneId, url)
  if (cacheado) return cacheado

  // La clave incluye el número: la misma foto para dos canales son dos subidas
  // distintas y no se pueden compartir.
  const clave = `${phoneId}|${url}`
  if (enVuelo.has(clave)) return enVuelo.get(clave)

  const promesa = (async () => {
    const id = await subirImagenAMeta(url, phoneId)
    await setMediaIdCache(phoneId, url, id)
    return id
  })().finally(() => enVuelo.delete(clave))

  enVuelo.set(clave, promesa)
  return promesa
}
