// lib/push.js — Web push de avisos de mensajes nuevos (línea MANDI).
//
// Sin claves VAPID configuradas, enviarPush() es un NO-OP silencioso: así se puede
// desplegar el código antes de configurar nada, sin riesgo para el webhook.
//
// Config (Vercel, cargar desde el PANEL WEB — por PowerShell les pega un BOM que
// revienta solo en producción):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import webpush from 'web-push'
import { getSupabase, CUENTA } from './supabase.js'

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:mandarinarepublic@outlook.com'

/** Un aviso por conversación cada 5 minutos. */
export const ENFRIAMIENTO_MS = 5 * 60 * 1000

export function pushConfigurado() {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE)
}

let _listo = false
function configurar() {
  if (_listo) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  _listo = true
}

/** Texto en una línea y acotado: el payload de un push tiene límite de tamaño. */
export function recortar(texto, max = 120) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).trimEnd() + '…'
}

const DESCRIPTOR = {
  imagen:    '📷 Foto',
  video:     '🎥 Video',
  audio:     '🎤 Audio',
  documento: '📄 Documento',
  sticker:   '💟 Sticker',
}

/** Cuerpo legible del aviso a partir del mensaje entrante. Nunca vacío. */
export function cuerpoDeMensaje({ tipo, contenido }) {
  const txt = recortar(contenido)
  if (tipo === 'texto') return txt || 'Mensaje nuevo'
  const d = DESCRIPTOR[tipo]
  if (!d) return txt || 'Mensaje nuevo'
  return txt ? `${d} · ${txt}` : d
}

/**
 * ¿Toca avisar de esta conversación? Bloquea si ya avisamos hace menos de la
 * ventana. Una fecha nula o corrupta deja pasar: mejor un aviso de más que perder
 * un lead.
 */
export function debeNotificar(ultimoPushAt, ahoraMs, ventanaMs = ENFRIAMIENTO_MS) {
  if (!ultimoPushAt) return true
  const prev = Date.parse(ultimoPushAt)
  if (Number.isNaN(prev)) return true
  return ahoraMs - prev >= ventanaMs
}

/**
 * Manda el aviso a todos los aparatos suscritos. NUNCA lanza.
 * Las suscripciones muertas (404/410) se borran solas.
 */
export async function enviarPush({ titulo, cuerpo, url, tag, tel }) {
  if (!pushConfigurado()) return { ok: false, motivo: 'sin-vapid', enviados: 0 }
  try {
    configurar()
    const sb = getSupabase()
    // Filtrar por cuenta es OBLIGATORIO: MANDI e IND comparten la tabla y cada uno
    // tiene su propio par de claves VAPID. Enviar a una suscripción de la otra cuenta
    // lo rechaza el servicio de push, y no es 404/410, así que no se limpiaría sola.
    const { data, error } = await sb.from('push_subs').select('*').eq('cuenta', CUENTA)
    if (error) { console.error('[push] leer subs:', error.message); return { ok: false, enviados: 0 } }
    const subs = data || []
    if (!subs.length) return { ok: true, enviados: 0 }

    const payload = JSON.stringify({
      titulo: String(titulo || 'Mensaje nuevo'),
      cuerpo: recortar(cuerpo, 120),
      url:    url || '/inbox',
      tag:    tag || '',
      tel:    tel || '',   // para que la pestaña abra ESE chat al tocar el aviso
    })

    const muertas = []
    let enviados = 0
    await Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        enviados++
      } catch (e) {
        const code = e?.statusCode
        // 404/410 = el navegador tiró la suscripción (datos limpiados, app desinstalada).
        if (code === 404 || code === 410) muertas.push(s.endpoint)
        else console.error('[push] envío falló:', code, e?.message)
      }
    }))

    if (muertas.length) {
      const { error: errDel } = await sb.from('push_subs').delete().in('endpoint', muertas)
      if (errDel) console.error('[push] limpiar muertas:', errDel.message)
    }
    return { ok: true, enviados, borradas: muertas.length }
  } catch (e) {
    console.error('[push] error inesperado:', e?.message || e)
    return { ok: false, enviados: 0 }
  }
}
