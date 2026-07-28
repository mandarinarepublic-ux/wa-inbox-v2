// lib/social-supabase.js — capa de datos del Social Inbox (FB Messenger / IG) en Supabase.
// Reemplaza la hoja SOCIAL de Google Sheets. Tabla: inbox.social_mensajes.
// SOLO server-side (usa service_role vía getSupabase()).
import { getSupabase, CUENTA } from './supabase.js'
import { agruparConversaciones } from './social-agrupar.js'

const TABLA = 'social_mensajes'

/**
 * Lista de conversaciones agrupadas (canal + tipo + sender), con sus mensajes en
 * orden cronológico. Mismo shape que consumía SocialInbox.jsx desde el CSV de la
 * hoja. La agrupación en sí vive en social-agrupar.js (sin Supabase, para poder
 * probarla con node:test).
 */
export async function getSocialConversacionesSupabase(limite = 4000) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from(TABLA)
    .select('id, canal, tipo, sender_id, nombre, direccion, texto, media_url, msg_id, fecha, estado, mandi_activo, ad_id, pauta, ref')
    .eq('cuenta', CUENTA)
    .order('fecha', { ascending: true })
    .limit(limite)
  if (error) throw error
  return agruparConversaciones(data || [])
}

/**
 * Registra un evento social (entrante del cliente o saliente de MANDI).
 * Idempotente por msg_id (los entrantes traen el mid/comment de Meta).
 */
export async function guardarSocialMensajeSupabase(m) {
  const sb = getSupabase()
  const fila = {
    cuenta: CUENTA,
    canal: (m.canal || 'FB').toUpperCase() === 'IG' ? 'IG' : 'FB',
    tipo: String(m.tipo || 'DM').toUpperCase() === 'COMENTARIO' ? 'COMENTARIO' : 'DM',
    sender_id: String(m.sender_id || ''),
    nombre: m.nombre || '',
    direccion: String(m.direccion || 'ENTRANTE').toUpperCase() === 'SALIENTE' ? 'SALIENTE' : 'ENTRANTE',
    texto: m.texto || '',
    media_url: m.media_url || '',
    msg_id: m.msg_id ? String(m.msg_id) : null,
    fecha: m.fecha ? new Date(m.fecha).toISOString() : new Date().toISOString(),
    estado: m.estado || 'PENDIENTE',
    mandi_activo: m.mandi_activo !== false,
    ad_id: m.ad_id || '',
    pauta: m.pauta || '',
    ref: m.ref || '',
    comment_id: m.comment_id || '',
    raw: m.raw || null,
  }
  if (!fila.sender_id) throw new Error('sender_id requerido')
  const q = fila.msg_id
    ? sb.from(TABLA).upsert(fila, { onConflict: 'msg_id', ignoreDuplicates: true })
    : sb.from(TABLA).insert(fila)
  const { error } = await q
  if (error && !/duplicate key/i.test(error.message)) throw error
  return { ok: true }
}

// Cache simple del secreto de ingesta (evita pegarle a la DB en cada webhook).
let _secretCache = { valor: null, at: 0 }
/**
 * Secreto compartido para /api/social/ingest. Prioridad: env SOCIAL_INGEST_SECRET;
 * si no está, se lee de inbox.app_config (clave 'social_ingest_secret'). Cache 60s.
 */
export async function getIngestSecret() {
  if (process.env.SOCIAL_INGEST_SECRET) return process.env.SOCIAL_INGEST_SECRET
  const ahora = Date.now()
  if (_secretCache.valor !== null && ahora - _secretCache.at < 60000) return _secretCache.valor
  try {
    const sb = getSupabase()
    const { data } = await sb.from('app_config').select('valor').eq('clave', 'social_ingest_secret').maybeSingle()
    _secretCache = { valor: data?.valor || '', at: ahora }
  } catch {
    _secretCache = { valor: '', at: ahora }
  }
  return _secretCache.valor
}

// Cache del token de página de FB/IG (rara vez cambia).
let _tokenCache = { valor: null, at: 0 }
/**
 * Token de página de Facebook/Instagram. Prioridad: env FB_PAGE_TOKEN; si no está,
 * se lee de inbox.app_config (clave 'fb_page_token'). Cache 5 min. Lo usan
 * /api/social/saliente (enviar) y /api/social/media (ver la publicación comentada).
 */
export async function getFbPageToken() {
  if (process.env.FB_PAGE_TOKEN) return process.env.FB_PAGE_TOKEN
  const ahora = Date.now()
  if (_tokenCache.valor !== null && ahora - _tokenCache.at < 300000) return _tokenCache.valor
  try {
    const sb = getSupabase()
    const { data } = await sb.from('app_config').select('valor').eq('clave', 'fb_page_token').maybeSingle()
    _tokenCache = { valor: data?.valor || '', at: ahora }
  } catch {
    _tokenCache = { valor: '', at: ahora }
  }
  return _tokenCache.valor
}

// Cache del id de la página (no cambia nunca).
let _pageIdCache = { valor: null, at: 0 }
/**
 * Id de la Página de Facebook. Se usa para mandar a /{page-id}/messages en vez de
 * /me/messages: así funciona TANTO con un token de página COMO con uno de usuario
 * del sistema (donde "me" es el usuario del sistema y el envío falla con el
 * críptico "Object with ID 'me' does not exist", código 100 subcódigo 33).
 * Prioridad: env FB_PAGE_ID; si no, inbox.app_config (clave 'fb_page_id').
 */
export async function getFbPageId() {
  if (process.env.FB_PAGE_ID) return process.env.FB_PAGE_ID
  const ahora = Date.now()
  if (_pageIdCache.valor !== null && ahora - _pageIdCache.at < 300000) return _pageIdCache.valor
  try {
    const sb = getSupabase()
    const { data } = await sb.from('app_config').select('valor').eq('clave', 'fb_page_id').maybeSingle()
    _pageIdCache = { valor: data?.valor || '', at: ahora }
  } catch {
    _pageIdCache = { valor: '', at: ahora }
  }
  return _pageIdCache.valor
}

// Token DE PÁGINA efectivo, derivado del que esté guardado.
// El Send API, las respuestas privadas y la lectura de un PSID exigen el token de
// la PÁGINA. Si lo guardado es un token de Usuario del Sistema, esas llamadas
// fallan con errores que no dicen nada ("An unknown error has occurred", code 1) o
// devuelven vacío. Acá lo cambiamos una vez por el de la página —que hereda el
// "no caduca" del usuario del sistema— y lo cacheamos 1 hora.
// Si ya era un token de página, el intercambio devuelve el mismo y no molesta.
let _tokenPagCache = { valor: null, at: 0 }
export async function getTokenPagina() {
  const ahora = Date.now()
  if (_tokenPagCache.valor && ahora - _tokenPagCache.at < 3600000) return _tokenPagCache.valor
  const guardado = await getFbPageToken()
  if (!guardado) return ''
  try {
    const pageId = await getFbPageId()
    if (!pageId) return guardado
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(guardado)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8000) }
    )
    const d = await res.json().catch(() => ({}))
    if (d?.error) console.error('[getTokenPagina] Meta:', d.error.message)
    const t = d?.access_token || guardado
    _tokenPagCache = { valor: t, at: ahora }
    return t
  } catch (e) {
    console.error('[getTokenPagina] falló, se usa el token guardado:', e.message)
    return guardado
  }
}

/** Cambia el estado (PENDIENTE/VENTAPROCESO/ATENDIDO/ARCHIVADO) de TODA la conversación. */
export async function updateSocialEstadoSupabase(canal, senderId, estado) {
  const sb = getSupabase()
  const est = String(estado || '').toUpperCase()
  const { error } = await sb
    .from(TABLA)
    .update({ estado: est })
    .eq('cuenta', CUENTA).eq('canal', canal).eq('sender_id', String(senderId))
  if (error) throw error
  return { ok: true }
}
