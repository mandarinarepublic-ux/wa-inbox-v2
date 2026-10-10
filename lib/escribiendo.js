// lib/escribiendo.js — el "escribiendo…" de WhatsApp (Cloud API, server-side).
//
// Lo usan los FLUJOS durante las pausas en segundos de las líneas: el cliente ve
// "escribiendo…" mientras el flujo espera, como si una persona le estuviera
// contestando, en vez de tres mensajes que caen solos.
//
// ⚠️ Lo que hay que saber de Meta:
//   - Va AMARRADO al "leído": el mensaje citado queda con checks azules. No hay
//     forma de mandar uno sin el otro.
//   - Dura hasta que sale nuestro mensaje o 25 s, lo que pase primero. Una pausa
//     más larga necesita renovarlo (RENOVAR_MS).
//   - Necesita el wamid de un mensaje DEL CLIENTE. Sin eso no se manda nada.
//   - No se cobra. Un fallo NUNCA frena el flujo: es adorno, no entrega.
import { CANALES } from './canales.js'

export const RENOVAR_MS = 20000

const CANALES_VALIDOS = new Set(CANALES.map((c) => String(c.phoneId)))

/** PURO: el cuerpo que espera Meta, o null si falta el mensaje del cliente. */
export function payloadEscribiendo(wamid) {
  const id = String(wamid || '').trim()
  if (!id) return null
  return { messaging_product: 'whatsapp', status: 'read', message_id: id, typing_indicator: { type: 'text' } }
}

/**
 * Manda el "escribiendo…" por el número del cliente. Devuelve { ok, status?, motivo? }
 * y nunca lanza. El phoneId se valida contra lib/canales.js, igual que en /api/saliente.
 */
export async function mandarEscribiendo({ phoneId, wamid }, { token = process.env.META_TOKEN || '', fetchFn = fetch } = {}) {
  const cuerpo = payloadEscribiendo(wamid)
  if (!cuerpo) return { ok: false, motivo: 'sin wamid' }
  if (!CANALES_VALIDOS.has(String(phoneId || ''))) return { ok: false, motivo: 'canal desconocido' }
  if (!token) return { ok: false, motivo: 'sin META_TOKEN' }
  try {
    const res = await fetchFn(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status }
  } catch (e) {
    return { ok: false, motivo: e.message }
  }
}
