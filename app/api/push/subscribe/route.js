import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { cuerpoDeSuscripcion } from '@/lib/push'
import { usuarioDeCookie } from '@/lib/acceso'
import { secretoSesion } from '@/lib/sesion'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Antes esto pedía PUSH_CLAVE porque el inbox no tenía login y cualquiera con la
// URL podía suscribirse y recibir los mensajes de las clientas en su teléfono.
// Desde el 7-ago-2026 hay login de verdad (middleware.js, AUTH_MODO=bloquear) y
// esta ruta queda dentro del candado, así que la clave sobraba — y era peor que
// inútil: en el celular su error salía por un `title=`, que al tacto no se ve.

export async function POST(req) {
  try {
    const { subscription } = await req.json().catch(() => ({}))

    const endpoint = subscription?.endpoint
    const p256dh   = subscription?.keys?.p256dh
    const auth     = subscription?.keys?.auth
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: 'suscripción incompleta' }, { status: 400 })
    }

    // Quién se suscribe, para poder responder '¿está cubierto el equipo?' sin
    // preguntarle a la gente. Sale de la cookie firmada, nunca de una cabecera.
    // ⚠️ Si no hay sesión NO se rechaza: se guarda con null. Ver cuerpoDeSuscripcion.
    const usuarioId = await usuarioDeCookie(req.headers.get('cookie'), secretoSesion())

    const sb = getSupabase()
    const { error } = await sb.from('push_subs').upsert(
      cuerpoDeSuscripcion({
        subscription,
        cuenta: CUENTA,
        userAgent: req.headers.get('user-agent'),
        usuarioId,
      }),
      { onConflict: 'endpoint' },
    )
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[/api/push/subscribe] POST:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'error interno' }, { status: 500 })
  }
}

// Darse de baja NO pide clave: siempre debe poder hacerse.
export async function DELETE(req) {
  try {
    const { endpoint } = await req.json().catch(() => ({}))
    if (!endpoint) return NextResponse.json({ ok: false, error: 'falta endpoint' }, { status: 400 })
    const sb = getSupabase()
    const { error } = await sb.from('push_subs').delete().eq('endpoint', endpoint)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[/api/push/subscribe] DELETE:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'error interno' }, { status: 500 })
  }
}
