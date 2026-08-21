// ¿Esta persona puede entrar a ESTE inbox?
//
// La sesión firmada solo dice QUIÉN es (`{ id, rol }`). El permiso se relee de
// `crm.usuarios` en CADA petición, a propósito: es la única forma de que quitarle
// el acceso a alguien surta efecto de inmediato. Si viajara dentro del token,
// duraría los 30 días de la sesión.
//
// Costo medido el 7-ago-2026: la tabla tiene 14 filas y 128 kB, la consulta se
// ejecuta en 0,125 ms y cabe entera en memoria. Lo que cuesta es el viaje de red,
// en rutas que ya hablan con Supabase de todos modos.

import { COOKIE_SESION, verificarSesion } from './sesion.js'

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** Permiso que exige este inbox. MANDI = INBOX_MANDARINA; IND usará INBOX_INDSTORE. */
export const PERMISO = process.env.INBOX_PERMISO || 'INBOX_MANDARINA'

export async function puedeEntrar(usuarioId) {
  if (!usuarioId) return { ok: false, motivo: 'sin-usuario' }
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, motivo: 'error-consulta' }

  const url = `${SUPABASE_URL}/rest/v1/usuarios`
    + `?usuario_id=eq.${encodeURIComponent(usuarioId)}`
    + `&select=activo,accesos&limit=1`

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        // La tabla vive en el schema `crm`, no en el `inbox` de siempre.
        'Accept-Profile': 'crm',
      },
      // ⚠️ Sin esto Next cachea el GET y devuelve el primer permiso PARA SIEMPRE:
      // revocarle el acceso a alguien no surtiría efecto nunca.
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, motivo: 'error-consulta' }

    const filas = await res.json()
    const u = Array.isArray(filas) ? filas[0] : null
    if (!u) return { ok: false, motivo: 'sin-usuario' }
    if (u.activo !== true) return { ok: false, motivo: 'inactivo' }

    const accesos = Array.isArray(u.accesos) ? u.accesos : []
    if (!accesos.includes(PERMISO)) return { ok: false, motivo: 'sin-permiso' }

    return { ok: true, motivo: 'ok' }
  } catch {
    // Si Supabase no responde, NO se deja pasar: el candado falla cerrado.
    return { ok: false, motivo: 'error-consulta' }
  }
}

// ¿Quién es el que está pidiendo? Sale de la cookie firmada, NUNCA de una
// cabecera: el camino `x-mp-usuario-id` se eliminó porque cualquiera que supiera
// un id de admin lo suplantaba (ver el encabezado de lib/sesion.js).
//
// Devuelve el id o null. Nunca lanza: quien la use decide qué hacer sin usuario,
// y en el caso del push la respuesta es "guardar igual".
export async function usuarioDeCookie(cookieHeader, secreto) {
  if (!cookieHeader || !secreto) return null

  let token = ''
  for (const parte of String(cookieHeader).split(';')) {
    const trozo = parte.trim()
    const corte = trozo.indexOf('=')
    if (corte < 0) continue
    if (trozo.slice(0, corte) !== COOKIE_SESION) continue
    // El token es `<payload>.<firma>`: se toma TODO lo que va tras el primer `=`.
    token = trozo.slice(corte + 1)
    break
  }
  if (!token) return null

  try {
    const sesion = await verificarSesion(token, secreto)
    return sesion?.id || null
  } catch {
    return null
  }
}
