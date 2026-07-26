import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Barrera mínima: el inbox no tiene login, así que sin esto cualquiera con la URL
// podría suscribirse y recibir los mensajes de los clientes en su teléfono.
// No es seguridad de verdad — el arreglo real es un login (ver el spec).
const CLAVE = process.env.PUSH_CLAVE || ''

export async function POST(req) {
  try {
    const { subscription, clave } = await req.json().catch(() => ({}))

    if (CLAVE && String(clave || '') !== CLAVE) {
      return NextResponse.json({ ok: false, error: 'clave incorrecta' }, { status: 401 })
    }
    const endpoint = subscription?.endpoint
    const p256dh   = subscription?.keys?.p256dh
    const auth     = subscription?.keys?.auth
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: 'suscripción incompleta' }, { status: 400 })
    }

    const sb = getSupabase()
    const { error } = await sb.from('push_subs').upsert({
      endpoint, p256dh, auth,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
      fallos: 0,
    }, { onConflict: 'endpoint' })
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
