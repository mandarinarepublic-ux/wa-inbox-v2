// lib/whatsapp.js — utilidades WhatsApp Cloud API (server-side).
// Descubre el WABA ID (cuenta de WhatsApp Business) SIN pedir env: lo deriva del
// mismo token que ya usamos para enviar. Con override por META_WABA_ID si se setea.
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const ENV_WABA      = process.env.META_WABA_ID || ''
export const GRAPH  = 'https://graph.facebook.com/v22.0'

let _waba = ENV_WABA || null   // cache en memoria (instancia tibia)
let _lastErr = ''

/**
 * Devuelve { id, error }. Intenta, en orden:
 *  1) env META_WABA_ID (override).
 *  2) nodo del phone number → campo whatsapp_business_account.
 *  3) debug_token → granular_scopes de whatsapp_business_management/messaging.
 * Cachea el primer id que encuentre.
 */
export async function getWabaId() {
  if (_waba) return { id: _waba }
  if (!META_TOKEN) return { id: null, error: 'META_TOKEN ausente' }

  // 2) phone number node → whatsapp_business_account { id }
  try {
    const r = await fetch(`${GRAPH}/${META_PHONE_ID}?fields=whatsapp_business_account&access_token=${encodeURIComponent(META_TOKEN)}`)
    const d = await r.json().catch(() => ({}))
    const id = d?.whatsapp_business_account?.id
    if (id) { _waba = String(id); return { id: _waba } }
    if (d?.error?.message) _lastErr = `phone_node: ${d.error.message}`
  } catch (e) { _lastErr = `phone_node: ${e.message}` }

  // 3) debug_token → granular_scopes[].target_ids
  try {
    const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(META_TOKEN)}&access_token=${encodeURIComponent(META_TOKEN)}`)
    const d = await r.json().catch(() => ({}))
    const scopes = d?.data?.granular_scopes || []
    const wab = scopes.find((s) => /whatsapp_business_(management|messaging)/.test(String(s.scope)))
    const id = wab?.target_ids?.[0]
    if (id) { _waba = String(id); return { id: _waba } }
    if (d?.error?.message) _lastErr = `debug_token: ${d.error.message}`
    else if (scopes.length) _lastErr = `debug_token: sin target_ids de WhatsApp (scopes: ${scopes.map((s) => s.scope).join(',')})`
  } catch (e) { _lastErr = `debug_token: ${e.message}` }

  return { id: null, error: _lastErr || 'no se pudo descubrir el WABA ID' }
}
