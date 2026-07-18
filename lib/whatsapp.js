// lib/whatsapp.js — utilidades WhatsApp Cloud API (server-side).
// Descubre el WABA ID (cuenta de WhatsApp Business) SIN pedir env: lo deriva del
// mismo token que ya usamos para enviar. Con override por META_WABA_ID si se setea.
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const ENV_WABA      = process.env.META_WABA_ID || ''
// Negocio(s) conocido(s) — el system user 'mandarina_bot' vive en "Mandarina Lab".
// Fallback hardcodeado (como META_PHONE_ID) para descubrir la WABA sin env.
const NEGOCIOS_CONOCIDOS = (process.env.META_BUSINESS_ID || '114968056344676').split(',').map(s => s.trim()).filter(Boolean)
export const GRAPH  = 'https://graph.facebook.com/v22.0'

let _waba = ENV_WABA || null   // cache en memoria (instancia tibia)

const tok = () => encodeURIComponent(META_TOKEN)
const getJson = async (url) => {
  const r = await fetch(url)
  return r.json().catch(() => ({}))
}

// ¿Esta WABA contiene nuestro phone id? (para elegir la correcta si hay varias)
async function wabaTienePhone(wabaId) {
  const d = await getJson(`${GRAPH}/${wabaId}/phone_numbers?access_token=${tok()}`)
  return (d?.data || []).some((n) => String(n.id) === String(META_PHONE_ID))
}

/**
 * Devuelve { id, error }. Intenta, en orden:
 *  1) env META_WABA_ID (override).
 *  2) debug_token → WABA directo (granular_scopes whatsapp) o ids de negocio candidatos.
 *  3) por cada negocio candidato → owned/client WhatsApp Business Accounts, matcheando
 *     el phone id (o la única que haya).
 * Cachea el primer id que encuentre.
 */
export async function getWabaId() {
  if (_waba) return { id: _waba }
  if (!META_TOKEN) return { id: null, error: 'META_TOKEN ausente' }
  const errs = []
  const negocios = new Set()

  // Fuente A: debug_token → WABA directo o ids de negocio candidatos.
  try {
    const d = await getJson(`${GRAPH}/debug_token?input_token=${tok()}&access_token=${tok()}`)
    const scopes = d?.data?.granular_scopes || []
    for (const s of scopes) {
      const ids = s?.target_ids || []
      if (/whatsapp_business_(management|messaging)/.test(String(s.scope)) && ids.length) {
        for (const id of ids) if (await wabaTienePhone(id)) { _waba = String(id); return { id: _waba } }
        if (ids.length === 1) { _waba = String(ids[0]); return { id: _waba } } // única WABA
      }
      for (const id of ids) negocios.add(String(id)) // candidatos de negocio
    }
    if (d?.error?.message) errs.push(`debug_token: ${d.error.message}`)
  } catch (e) { errs.push(`debug_token: ${e.message}`) }

  // Fuente B: /me/businesses (el token tiene business_management).
  try {
    const d = await getJson(`${GRAPH}/me/businesses?access_token=${tok()}`)
    for (const b of (d?.data || [])) negocios.add(String(b.id))
    errs.push(d?.error?.message ? `me/businesses: ${d.error.message}` : `me/businesses: ${(d?.data || []).length}`)
  } catch (e) { errs.push(`me/businesses: ${e.message}`) }

  // Fuente C: WABAs a las que el token tiene acceso directo (system user).
  try {
    const d = await getJson(`${GRAPH}/me/assigned_whatsapp_business_accounts?access_token=${tok()}`)
    const wabas = d?.data || []
    for (const w of wabas) { if (await wabaTienePhone(w.id)) { _waba = String(w.id); return { id: _waba } } }
    if (wabas.length === 1) { _waba = String(wabas[0].id); return { id: _waba } }
    errs.push(d?.error?.message ? `assigned_waba: ${d.error.message}` : `assigned_waba: ${wabas.length}`)
  } catch (e) { errs.push(`assigned_waba: ${e.message}`) }

  // Negocios conocidos (fallback) — se prueban además de los descubiertos.
  for (const b of NEGOCIOS_CONOCIDOS) negocios.add(b)

  // Por cada negocio candidato → WhatsApp Business Accounts (owned + client).
  let vistas = 0, unica = null
  for (const biz of negocios) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      const d = await getJson(`${GRAPH}/${biz}/${edge}?access_token=${tok()}`)
      const wabas = d?.data || []
      for (const w of wabas) {
        vistas++; unica = String(w.id)
        if (await wabaTienePhone(w.id)) { _waba = String(w.id); return { id: _waba } }
      }
    }
  }
  // Si no matcheó por phone pero solo vimos una WABA en total, úsala.
  if (vistas === 1 && unica) { _waba = unica; return { id: _waba } }

  return {
    id: null,
    error: (errs.join(' | ') || '') + ` (negocios probados: ${negocios.size}, WABAs vistas: ${vistas})`,
  }
}
