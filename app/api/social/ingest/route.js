import { NextResponse } from 'next/server'
import { guardarSocialMensajeSupabase, getIngestSecret } from '@/lib/social-supabase'

// Ingesta de eventos ENTRANTES del Social Inbox (FB Messenger / IG).
// Lo llama el escenario de Make (EscuchaFacebook / EscuchaInstagram) en lugar de
// escribir a la hoja SOCIAL. Acepta JSON o application/x-www-form-urlencoded.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req) {
  try {
    const url = new URL(req.url)
    const token = req.headers.get('x-ingest-secret') || url.searchParams.get('token') || ''
    const secret = await getIngestSecret()
    if (!secret || token !== secret) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
    }

    // Leer el cuerpo crudo (una sola vez) y parsear según content-type.
    const ct = req.headers.get('content-type') || ''
    const raw = await req.text()
    let b = {}
    if (ct.includes('application/json')) {
      try { b = JSON.parse(raw || '{}') } catch {}
    } else {
      b = Object.fromEntries(new URLSearchParams(raw))
    }
    console.log('[ingest] ct=%s body=%s', ct, (raw || '').slice(0, 400))

    const canal = (b.canal || 'FB')
    const nombre = String(b.nombre || '').trim()
    // IG a veces NO manda el id del que comenta (from.id), solo el username → usamos
    // el username como identidad de la conversación para no perder el mensaje.
    let sender_id = String(b.sender_id || '').trim()
    if (!sender_id) sender_id = nombre
    if (!sender_id) {
      console.log('[ingest] SIN sender_id ni nombre — descartado')
      return NextResponse.json({ error: 'falta sender_id' }, { status: 400 })
    }

    await guardarSocialMensajeSupabase({
      canal,
      sender_id,
      nombre,
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
