// lib/anuncios-meta.js — el nombre del anuncio, su campaña y su estado, leídos de Meta.
//
// El referral de WhatsApp solo trae titular/texto/foto: el titular casi siempre es
// "Mandarina Republic" y la lista del disparador de FLUJOS era una fila de anuncios
// idénticos. El `source_id` del referral ES el id del anuncio en el Administrador
// de anuncios, así que se le pregunta a la Graph API su nombre y su campaña.
//
// Best-effort y acotado: solo anuncios sin nombre o leídos hace más de 12 h, 10
// por llamada. Si el token no tiene permiso de anuncios, se anota la lectura igual
// para no volver a preguntar en cada carga, y la pantalla cae al titular/texto.
import { getSupabase } from './supabase.js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const LOTE = 10

export async function completarAnunciosDesdeMeta(cuenta, token = process.env.META_TOKEN || '') {
  if (!token) return { leidos: 0 }
  const sb = getSupabase()
  const hace12h = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
  const { data } = await sb.from('anuncios').select('source_id')
    .eq('cuenta', cuenta)
    .or(`nombre_anuncio.is.null,meta_leido_at.is.null,meta_leido_at.lt.${hace12h}`)
    .limit(LOTE)
  let leidos = 0
  await Promise.allSettled((data || []).map(async ({ source_id }) => {
    const r = await fetch(`${GRAPH}/${source_id}?fields=name,effective_status,campaign{name},adset{name}&access_token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    const patch = { meta_leido_at: new Date().toISOString() }
    if (r.ok && j?.name) {
      Object.assign(patch, {
        nombre_anuncio: j.name,
        campana: j.campaign?.name || null,
        conjunto: j.adset?.name || null,
        estado_anuncio: j.effective_status || null,
      })
      leidos++
    }
    await sb.from('anuncios').update(patch).eq('cuenta', cuenta).eq('source_id', source_id)
  }))
  return { leidos }
}
