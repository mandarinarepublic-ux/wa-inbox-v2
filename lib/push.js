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

/**
 * Cuánto esperar antes de que el aviso de una misma conversación VUELVA A SONAR.
 * Ojo: esto NO decide si se manda el aviso — se manda siempre. Solo decide si
 * suena, igual que WhatsApp: la ráfaga de una misma persona colapsa en un aviso
 * que se actualiza callado, y el sonido vuelve recién cuando la ráfaga terminó.
 */
export const VENTANA_SONIDO_MS = 60 * 1000

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
 * ¿Este aviso tiene que SONAR? Falso solo si ya sonó por esta conversación hace
 * menos de la ventana. Una fecha nula o corrupta hace sonar: mejor un ruido de
 * más que un lead perdido.
 *
 * ⚠️ Esto NO es una guarda de envío. Antes SÍ lo era (esta misma función, con otro
 * nombre), y ese era el bug: una clienta que escribía una vez y esperaba generaba
 * un solo aviso en toda su vida. El aviso ahora se manda SIEMPRE; esta función
 * solo apaga el sonido.
 */
export function debeSonar(ultimoPushAt, ahoraMs, ventanaMs = VENTANA_SONIDO_MS) {
  if (!ultimoPushAt) return true
  const prev = Date.parse(ultimoPushAt)
  if (Number.isNaN(prev)) return true
  return ahoraMs - prev >= ventanaMs
}

/**
 * Arma el aviso de un mensaje entrante. SIEMPRE devuelve un objeto — nunca null,
 * nunca undefined, pase lo que pase con la ventana de sonido.
 *
 * ⚠️ Esa es LA garantía de este módulo, y existe como función aparte justamente
 * para poder probarla: la decisión de sonar no puede volver a convertirse en una
 * decisión de no avisar. Si algún día este archivo devuelve algo falsy acá, el
 * test de abajo se cae antes de que el bug llegue a producción.
 *
 * El armado del `tag` replica a propósito la lógica de `tail9` del webhook
 * (quita el 593 y los ceros a la izquierda antes de tomar los últimos 9
 * dígitos): un `tag` distinto rompería el colapso de avisos por chat.
 */
export function avisoDeEntrante({ telefono, nombre, tipo, contenido }, ultimoPushAt, ahoraMs) {
  const t9 = String(telefono || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)
  return {
    titulo: `💬 ${nombre || telefono}`,
    cuerpo: cuerpoDeMensaje({ tipo, contenido }),
    url:    `/inbox?tel=${encodeURIComponent(telefono)}`,
    tag:    `chat-${t9}`,
    tel:    telefono,
    renotify: debeSonar(ultimoPushAt, ahoraMs),
  }
}

/**
 * Manda el aviso a todos los aparatos suscritos. NUNCA lanza.
 * Las suscripciones muertas (404/410) se borran solas.
 */
export async function enviarPush({ titulo, cuerpo, url, tag, tel, renotify = true }) {
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
      renotify: renotify !== false,  // false = actualiza el aviso sin sonar
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

/**
 * La fila que se guarda al suscribir un aparato a los avisos.
 *
 * Vive acá y no dentro de la ruta para poder probar la regla que importa:
 * ⚠️ SIN sesión la suscripción se guarda IGUAL, con `usuario_id` null. Este
 * cambio es de REGISTRO (saber quién está cubierto), no de reparto. Rechazar
 * por falta de sesión dejaría sin avisos a quien tenga el token vencido — justo
 * el daño que se quiere evitar.
 */
export function cuerpoDeSuscripcion({ subscription, cuenta, userAgent, usuarioId }) {
  return {
    endpoint: subscription?.endpoint,
    p256dh:   subscription?.keys?.p256dh,
    auth:     subscription?.keys?.auth,
    cuenta,   // MANDI e IND comparten tabla y tienen claves VAPID distintas
    usuario_id: usuarioId || null,
    user_agent: (userAgent || '').slice(0, 300),
    fallos: 0,
  }
}
