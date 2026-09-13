// lib/coexistencia.js — El enganche celular ↔ Cloud API hecho desde el inbox.
//
// Un número en coexistencia vive en la app de WhatsApp Business de un celular y
// Meta le copia todo a la API. Cuando ese enlace se cae (REPUBLIC el 6-sep, el
// 9804 de IND el 11-sep) el celular sigue perfecto y el inbox se queda ciego.
// "Vincular" desde Business Suite no manda el código; el camino que sí lo manda
// es el registro insertado (Embedded Signup) de NUESTRA app con la opción de
// coexistencia. Este módulo es la parte PURA de ese camino:
//
//   - `datosDeSesionES`      → qué dijo Meta al terminar el diálogo (waba_id, etc.)
//   - `extraerHistorial`     → el webhook `history` → filas para guardarMensaje
//   - `extraerContactosSync` → el webhook `smb_app_state_sync` → nombres de la agenda
//
// Nada de acá escribe en la base ni llama a Meta: eso vive en el webhook y en
// la ruta /api/admin/conectar-whatsapp, donde se puede mirar `res.ok`.
import { extraer } from './wa-mensaje.js'

/** La coexistencia se pide con este `featureType` al abrir el diálogo de Meta. */
export const FEATURE_COEXISTENCIA = 'whatsapp_business_app_onboarding'

/** El evento con el que Meta cierra un enganche de coexistencia. */
export const EVENTO_FIN_COEXISTENCIA = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'

/**
 * Interpreta un `message` del navegador durante el diálogo de Meta.
 *
 * Meta manda por `window.postMessage` un JSON con `type: 'WA_EMBEDDED_SIGNUP'`.
 * Solo se acepta si viene de facebook.com: cualquier pestaña podría mandar un
 * mensaje con esa forma. Devuelve null si no es de Meta o no es de este flujo.
 */
export function datosDeSesionES(origin, data) {
  if (!/\.facebook\.com$/.test(String(origin || ''))) return null
  let obj = data
  if (typeof data === 'string') {
    try { obj = JSON.parse(data) } catch { return null }
  }
  if (!obj || obj.type !== 'WA_EMBEDDED_SIGNUP') return null
  const d = obj.data || {}
  return {
    evento: String(obj.event || ''),
    wabaId: String(d.waba_id || ''),
    phoneId: String(d.phone_number_id || ''),
    businessId: String(d.business_id || ''),
    paso: String(d.current_step || ''),
    coexistencia: obj.event === EVENTO_FIN_COEXISTENCIA,
    terminado: obj.event === 'FINISH' || obj.event === EVENTO_FIN_COEXISTENCIA,
    cancelado: obj.event === 'CANCEL',
    error: obj.event === 'ERROR' ? String(d.error_message || d.error_id || 'error') : '',
  }
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

/** Texto con el que se pinta un medio del celular que Meta ya no puede entregar. */
export const TEXTO_PLACEHOLDER = '📎 Archivo del celular (anterior a 14 días)'

/**
 * Webhook `history` → filas listas para guardarMensajeSupabase.
 *
 * Meta manda el historial del celular en tandas (`chunk_order`) por fases
 * (0 = hoy, 1 = hasta 90 días, 2 = hasta 180). Cada `thread` es un cliente y
 * trae sus mensajes con `from`; el nuestro es el número visible del canal.
 *
 * ☠️ La dirección se decide comparando `from` con `metadata.display_phone_number`,
 * NO con el phone_id: en el historial `from` es un número visible.
 * ☠️ Los medios de hace más de 14 días llegan como `media_placeholder`, sin id:
 * se guardan como mensaje sin adjunto, nunca se descartan ("sin texto" no es
 * "no pasó nada").
 */
export function extraerHistorial(value) {
  const phoneId = String(value?.metadata?.phone_number_id || '')
  const nuestro = soloDigitos(value?.metadata?.display_phone_number)
  const filas = []
  for (const tanda of value?.history || []) {
    const fase = tanda?.metadata?.phase
    const orden = tanda?.metadata?.chunk_order
    for (const hilo of tanda?.threads || []) {
      const cliente = soloDigitos(hilo?.id)
      for (const msg of hilo?.messages || []) {
        const wamid = String(msg?.id || '')
        if (!wamid) continue
        const from = soloDigitos(msg?.from)
        const esNuestro = Boolean(nuestro) && from === nuestro
        const telefono = esNuestro ? (soloDigitos(msg?.to) || cliente) : (from || cliente)
        if (!telefono) continue
        const esPlaceholder = msg?.type === 'media_placeholder'
        const { tipo, contenido, mediaId, contextoId } = extraer(msg)
        filas.push({
          wamid, telefono, phoneId,
          direccion: esNuestro ? 'SALIENTE' : 'ENTRANTE',
          tipo: esPlaceholder ? 'media_placeholder' : tipo,
          contenido: esPlaceholder ? TEXTO_PLACEHOLDER : contenido,
          mediaId, contextoId,
          estado: String(msg?.history_context?.status || '').toLowerCase(),
          raw: { ...msg, _historial: { fase, orden } },
          fecha: msg?.timestamp
            ? new Date(Number(msg.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        })
      }
    }
  }
  return filas
}

/**
 * Webhook `smb_app_state_sync` → nombres de la agenda del celular.
 * Solo `add` trae nombre; `remove` se ignora (borrar un contacto del celular no
 * debe borrar nada del inbox).
 */
export function extraerContactosSync(value) {
  const out = []
  for (const s of value?.state_sync || []) {
    if (s?.type !== 'contact' || s?.action !== 'add') continue
    const telefono = soloDigitos(s?.contact?.phone_number)
    const nombre = String(s?.contact?.full_name || s?.contact?.first_name || '').trim()
    if (!telefono || !nombre) continue
    out.push({ telefono, nombre })
  }
  return out
}
