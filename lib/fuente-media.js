// lib/fuente-media.js — de dónde saca el navegador una foto, audio o documento.
//
// ☠️ 25-sep-2026: 266 errores 502 en 6 h en /api/media. La burbuja le pedía CADA
// medio a Meta por su media_id aunque ya tuviéramos la copia archivada en
// Supabase Storage (5.974 de 6.021 en MANDI). Meta deja de servir un media_id a
// los ~30 días, y los de REPUBLIC murieron todos juntos cuando Meta borró el
// número viejo. La copia archivada no caduca: va PRIMERO.

const RE_META = /(^|\.)(lookaside\.fbsbx\.com|graph\.facebook\.com)$/i
const RE_CDN_META = /(^|\.)(fbcdn\.net|fbsbx\.com)$/i

function hostDe(url) {
  try { return new URL(url).hostname } catch { return '' }
}

/** URL de Meta que exige el token (no la puede pedir un <img> directo). */
export function esUrlDeMeta(url) {
  return RE_META.test(hostDe(url))
}

/**
 * Hosts a los que /api/media?url= puede ir. Fuera de esta lista la ruta no
 * descarga nada: si no, cualquiera con sesión podía mandar `?url=` a su propio
 * servidor y recibir el META_TOKEN en la cabecera.
 */
export function hostPermitidoParaProxy(url) {
  const h = hostDe(url)
  return RE_META.test(h) || RE_CDN_META.test(h)
}

/** El token solo viaja a la API de Meta, nunca a un CDN. */
export function llevaToken(url) {
  return RE_META.test(hostDe(url))
}

/**
 * `src` para pintar un medio. Orden: copia pública (Supabase, ibb, Shopify,
 * Drive) → media_id por el proxy → URL de Meta por el proxy. Vacío = nada que pintar.
 */
export function fuenteDeMedia({ mediaUrl = '', mediaId = '' } = {}) {
  const url = String(mediaUrl || '')
  if (url && !esUrlDeMeta(url)) {
    return url.includes('drive.google.com/uc') ? url.replace('export=download', 'export=view') : url
  }
  if (mediaId) return `/api/media?id=${encodeURIComponent(mediaId)}`
  if (url) return `/api/media?url=${encodeURIComponent(url)}`
  return ''
}
