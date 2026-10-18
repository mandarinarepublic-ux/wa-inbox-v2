// lib/social-nombre.js — nombre real del cliente de un DM de FB/IG.
// Meta no lo manda en el webhook del DM: hay que pedirlo. SOLO server-side.
//
// ☠️ Los 19 DMs de Facebook de ago-oct 2026 quedaron SIN nombre: el perfil
// (`GET /{PSID}?fields=name`) devolvía error y el error se tiraba sin log. Ahora
// hay un segundo camino (la conversación de la página, que trae a los
// participantes con su nombre) y el error de Meta se devuelve para poder verlo.

const GRAPH = 'https://graph.facebook.com/v19.0'

async function graphGet(ruta, token) {
  const sep = ruta.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}/${ruta}${sep}access_token=${encodeURIComponent(token)}`,
    { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  const d = await res.json().catch(() => ({}))
  return d
}

const describir = (e) => e ? `code=${e.code} ${e.message || ''}`.trim() : ''

/**
 * Devuelve { nombre, error }. `error` junta lo que contestó Meta en cada camino
 * fallido; viene vacío si salió el nombre.
 */
export async function resolverNombreSocial({ id, canal, token, pageId }) {
  if (!token || !id) return { nombre: '', error: 'sin token o sin id' }
  const esIG = String(canal || '').toUpperCase() === 'IG'
  const errores = []
  try {
    // 1) El perfil del usuario (PSID / IGSID).
    const d = await graphGet(`${encodeURIComponent(id)}?fields=${esIG ? 'name,username' : 'name'}`, token)
    const nombre = d?.name || d?.username || ''
    if (nombre) return { nombre, error: '' }
    errores.push('perfil: ' + (describir(d?.error) || 'sin nombre'))

    // 2) La conversación de la página con ese usuario: trae a los participantes.
    if (pageId) {
      const plataforma = esIG ? 'instagram' : 'messenger'
      const c = await graphGet(`${encodeURIComponent(pageId)}/conversations?platform=${plataforma}&user_id=${encodeURIComponent(id)}&fields=participants`, token)
      const parts = c?.data?.[0]?.participants?.data || []
      const p = parts.find(x => String(x.id) === String(id))
      const n2 = p?.name || p?.username || ''
      if (n2) return { nombre: n2, error: '' }
      errores.push('conversación: ' + (describir(c?.error) || 'sin participante'))
    }
  } catch (e) {
    errores.push(e.message)
  }
  return { nombre: '', error: errores.join(' | ') }
}
