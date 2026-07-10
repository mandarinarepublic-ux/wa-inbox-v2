import { NextResponse } from 'next/server'
import { appendRow } from '@/lib/sheets'

// Envío saliente del Social Inbox (FB Messenger / IG).
// Reemplaza al escenario Make SOCIAL_SALIENTE (que dependía de una conexión rota).
// El token de PÁGINA vive server-side en process.env.FB_PAGE_TOKEN. Usa preferentemente
// un token de Usuario del Sistema (no expira); un token de página normal caduca ~60 días.
export const dynamic = 'force-dynamic'

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v19.0'

export async function POST(req) {
  try {
    if (!FB_PAGE_TOKEN) {
      return NextResponse.json({ error: 'FB_PAGE_TOKEN no configurado en el servidor' }, { status: 500 })
    }
    const { sender_id, message, canal, comment_id } = await req.json()
    if (!message || !sender_id) {
      return NextResponse.json({ error: 'Faltan sender_id o message' }, { status: 400 })
    }

    // FB: DM normal por PSID (ventana 24h). IG: los "chats" son comentarios, así que
    // se responde con un DM privado al comentario (recipient.comment_id) — Meta permite
    // 1 respuesta privada por comentario. JSON.stringify escapa comillas/saltos de línea.
    const esIG = String(canal).toUpperCase() === 'IG'
    const recipient = esIG && comment_id ? { comment_id: String(comment_id) } : { id: String(sender_id) }
    const body = { recipient, message: { text: String(message) } }
    if (!esIG) body.messaging_type = 'RESPONSE'

    const res = await fetch(`${GRAPH}/me/messages?access_token=${encodeURIComponent(FB_PAGE_TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      return NextResponse.json(
        { error: data.error?.message || `Envío falló (HTTP ${res.status})`, code: data.error?.code },
        { status: 502 }
      )
    }

    // Registra el saliente en la hoja SOCIAL para que aparezca en el inbox al refrescar
    // (col G = MensajeSalida). Si falla el log, el mensaje YA se envió → no es fatal.
    try {
      const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ')
      await appendRow('SOCIAL', ['', canal || '', String(sender_id), String(sender_id), '', fecha, String(message), 'ATENDIDO', 'TRUE'])
    } catch (e) {
      console.error('[/api/social/saliente] no se pudo registrar en SOCIAL:', e.message)
    }

    return NextResponse.json({ ok: true, id: data.message_id || '' })
  } catch (err) {
    console.error('[/api/social/saliente]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
