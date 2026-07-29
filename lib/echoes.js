// lib/echoes.js — Lo que el dueño responde DESDE EL CELULAR.
//
// El número de REPUBLIC está en coexistencia: vive a la vez en Cloud API y en la
// app de WhatsApp Business del teléfono. Cuando se contesta desde el celular,
// Meta nos avisa por el campo `smb_message_echoes`, y ese mensaje NO existía para
// el inbox: la bandeja no se enteraba, el chat seguía pendiente y otro vendedor
// lo volvía a contestar.
//
// Dos trampas del payload, las dos comprobadas contra datos reales:
//   - `from` somos NOSOTROS y `to` es el cliente. Al revés que en un entrante.
//   - `from` viene como número visible (593979104167), NO como phone_id, así que
//     el canal hay que sacarlo de metadata.phone_number_id.
//
// Módulo PURO: traduce y nada más. No decide estados ni escribe en la base.
import { extraer } from './wa-mensaje.js'

/** Payload de un evento `smb_message_echoes` → filas listas para guardar. */
export function extraerEchoes(value) {
  const phoneId = value?.metadata?.phone_number_id || ''
  const filas = []
  for (const eco of value?.message_echoes || []) {
    const telefono = String(eco?.to || '')
    const wamid = String(eco?.id || '')
    if (!telefono || !wamid) continue // sin destinatario o sin id no se puede guardar
    const { tipo, contenido, mediaId, contextoId } = extraer(eco)
    filas.push({
      wamid, telefono, tipo, contenido, mediaId, contextoId, phoneId,
      raw: eco,
      fecha: eco.timestamp
        ? new Date(Number(eco.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    })
  }
  return filas
}
