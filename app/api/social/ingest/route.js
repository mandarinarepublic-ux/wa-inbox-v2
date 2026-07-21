import { NextResponse } from 'next/server'
import { guardarSocialMensajeSupabase } from '@/lib/social-supabase'

// Ingesta de eventos ENTRANTES del Social Inbox (FB Messenger / IG).
// Lo llama el escenario de Make (EscuchaFacebook / EscuchaInstagram) en lugar de
// escribir a la hoja SOCIAL: Make sigue recibiendo el webhook de Meta y contesta el
// saludo automático; solo cambia el destino de los datos → Supabase.
//
// Seguridad: token compartido en SOCIAL_INGEST_SECRET (Vercel) que Make manda como
// ?token=... o header x-ingest-secret. Sin token válido → 401.
//
// Acepta JSON o application/x-www-form-urlencoded (Make manda urlencoded para que el
// texto del cliente —con comillas/saltos— no rompa el body).
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SECRET = process.env.SOCIAL_INGEST_SECRET || ''

async function leerBody(req) {
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return await req.json().catch(() => ({}))
  }
  // urlencoded o multipart → FormData
  try {
    const fd = await req.formData()
    const obj = {}
    for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v : ''
    return obj
  } catch {
    // último recurso: intentar parsear texto como querystring
    try {
      const txt = await req.text()
      return Object.fromEntries(new URLSearchParams(txt))
    } catch { return {} }
  }
}

export async function POST(req) {
  try {
    const url = new URL(req.url)
    const token = req.headers.get('x-ingest-secret') || url.searchParams.get('token') || ''
    if (!SECRET || token !== SECRET) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
    }

    const b = await leerBody(req)
    const sender_id = String(b.sender_id || '').trim()
    if (!sender_id) {
      return NextResponse.json({ error: 'falta sender_id' }, { status: 400 })
    }

    await guardarSocialMensajeSupabase({
      canal:     b.canal || 'FB',
      sender_id,
      nombre:    b.nombre || '',
      direccion: 'ENTRANTE',
      texto:     b.texto || b.message || '',
      msg_id:    b.msg_id || b.id || '',
      fecha:     b.fecha || '',
      estado:    'PENDIENTE',
      ad_id:     b.ad_id || '',
      pauta:     b.pauta || '',
      ref:       b.ref || '',
      comment_id: b.comment_id || '',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/social/ingest]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
