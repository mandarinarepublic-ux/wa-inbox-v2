// lib/social-supabase.js — capa de datos del Social Inbox (FB Messenger / IG) en Supabase.
// Reemplaza la hoja SOCIAL de Google Sheets. Tabla: inbox.social_mensajes.
// SOLO server-side (usa service_role vía getSupabase()).
import { getSupabase, CUENTA } from './supabase.js'

const TABLA = 'social_mensajes'

// Fila social_mensajes → mensaje plano para agrupar.
function toRow(r) {
  return {
    id:        r.msg_id || String(r.id),
    canal:     r.canal || 'FB',
    sender_id: String(r.sender_id || ''),
    nombre:    r.nombre || '',
    direccion: r.direccion || 'ENTRANTE',
    texto:     r.texto || '',
    fecha:     r.fecha || '',
    estado:    r.estado || 'PENDIENTE',
    mandi_activo: r.mandi_activo !== false,
    ad_id:     r.ad_id || '',
    pauta:     r.pauta || '',
    ref:       r.ref || '',
  }
}

/**
 * Lista de conversaciones agrupadas (canal + sender), con sus mensajes en orden
 * cronológico. Mismo shape que consumía SocialInbox.jsx desde el CSV de la hoja.
 */
export async function getSocialConversacionesSupabase(limite = 4000) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from(TABLA)
    .select('id, canal, sender_id, nombre, direccion, texto, msg_id, fecha, estado, mandi_activo, ad_id, pauta, ref')
    .eq('cuenta', CUENTA)
    .order('fecha', { ascending: true })
    .limit(limite)
  if (error) throw error

  const map = {}
  for (const raw of data || []) {
    const r = toRow(raw)
    if (!r.sender_id) continue
    const key = `${r.canal}__${r.sender_id}`
    if (!map[key]) {
      map[key] = {
        sender_id: r.sender_id,
        nombre: r.nombre || r.sender_id,
        canal: r.canal,
        status: r.estado || 'PENDIENTE',
        mandi_active: r.mandi_activo,
        messages: [],
        last_time: r.fecha || '',
        unread: 0,
        pautaAdId: '', pautaTitle: '', pautaRef: '',
      }
    }
    const conv = map[key]
    // Captura la primera pauta no vacía de la conversación.
    if (!conv.pautaAdId  && r.ad_id) conv.pautaAdId  = r.ad_id
    if (!conv.pautaTitle && r.pauta) conv.pautaTitle = r.pauta
    if (!conv.pautaRef   && r.ref)   conv.pautaRef   = r.ref
    const esSalida = String(r.direccion).toUpperCase() === 'SALIENTE'
    if (String(r.texto || '').trim()) {
      conv.messages.push({
        id: r.id,
        from: esSalida ? 'mandi' : 'user',
        text: r.texto,
        time: r.fecha || '',
      })
    }
    conv.last_time = r.fecha || conv.last_time
    // El estado "vigente" es el último registrado (entrante o edición manual).
    if (r.estado) conv.status = r.estado
    if (r.nombre && r.nombre.trim()) conv.nombre = r.nombre.trim()
  }

  return Object.values(map).sort((a, b) => new Date(b.last_time) - new Date(a.last_time))
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
    sender_id: String(m.sender_id || ''),
    nombre: m.nombre || '',
    direccion: String(m.direccion || 'ENTRANTE').toUpperCase() === 'SALIENTE' ? 'SALIENTE' : 'ENTRANTE',
    texto: m.texto || '',
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
