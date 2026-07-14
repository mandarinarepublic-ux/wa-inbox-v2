import { NextResponse } from 'next/server'
import { appendRow } from '@/lib/sheets'
import { dualWrite } from '@/lib/supabase'
import { guardarMensajeSupabase } from '@/lib/inbox-supabase'
import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Envío DIRECTO a la Cloud API de Meta (sin Make) ───────────────────────────
// Recibe el mismo body que ya manda lib/api-client.js y App.jsx, y lo traduce al
// payload de la Graph API. Luego registra la salida en la hoja MENSAJES (lo que
// antes hacía Make con un "Add Row"). Token y phone id viven SOLO server-side.
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const GRAPH_URL     = `https://graph.facebook.com/v19.0/${META_PHONE_ID}/messages`

// Fallback temporal a Make: mientras META_TOKEN NO esté configurado en Vercel,
// seguimos enviando por Make para no cortar el servicio. En cuanto agregues el
// token, esta ruta pasa sola a enviar DIRECTO a Meta y Make queda bypasseado.
const MAKE_SEND_WEBHOOK = process.env.MAKE_SEND_WEBHOOK || 'https://hook.us2.make.com/2j5dzq4gjqkjjnyxiyb46bons15awy2k'

async function enviarPorMake(body) {
  try {
    const res = await fetch(MAKE_SEND_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return NextResponse.json({ ok: res.ok, via: 'make' })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message, via: 'make' }, { status: 502 })
  }
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// Traduce el body del cliente → { payload Graph, tipo, contenido, mediaUrl, mediaId }
function construir(body) {
  const to = soloDigitos(body.Telefono)

  // Botones interactivos
  if (body.TipoMensaje === 'interactive_buttons') {
    let buttons = []
    try { buttons = JSON.parse(body.Botones || '[]') } catch {}
    // Botones en forma simple para la UI/persistencia: [{ id, title }].
    // (El payload de Meta usa { type:'reply', reply:{ id, title } }.)
    const botones = buttons.map(b => (b?.reply ? { id: b.reply.id, title: b.reply.title } : b))
    return {
      tipo: 'interactive',
      contenido: body.Cuerpo || '',
      botones,
      mediaUrl: '', mediaId: '',
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body.Cuerpo || '' },
          action: { buttons },
        },
      },
    }
  }

  // Video por MediaID (subido antes vía /api/media/upload)
  if (body.VideoMediaId) {
    return {
      tipo: 'video',
      contenido: '', mediaUrl: '', mediaId: body.VideoMediaId,
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'video',
        video: { id: body.VideoMediaId },
      },
    }
  }

  // Imagen por URL pública
  if (body.ImagenURL) {
    return {
      tipo: 'imagen',
      contenido: body.Caption || '', mediaUrl: body.ImagenURL, mediaId: '',
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: body.Caption ? { link: body.ImagenURL, caption: body.Caption } : { link: body.ImagenURL },
      },
    }
  }

  // Texto (por defecto)
  return {
    tipo: 'texto',
    contenido: body.Mensaje || '',
    mediaUrl: '', mediaId: '',
    payload: {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.Mensaje || '', preview_url: true },
    },
  }
}

export async function POST(req) {
  try {
    const body = await req.json()

    // ── LINKPAGO<monto> ───────────────────────────────────────────────────────
    // Si el ejecutivo escribe "LINKPAGO35" en el chat, NO enviamos ese texto:
    // generamos un link de cobro dLocal por ese monto y enviamos el mensaje de
    // pago al cliente. (Recupera la herramienta que vivía en Make.)
    if (!body.TipoMensaje && !body.ImagenURL && !body.VideoMediaId) {
      const monto = parseLinkpago(body.Mensaje)
      if (monto) {
        try {
          const link = await crearLinkPago(monto, `${soloDigitos(body.Telefono)}-${Date.now()}`)
          body.Mensaje = mensajeLinkPago(monto, link)   // seguimos el flujo normal de texto
        } catch (e) {
          console.error('[/api/saliente] LINKPAGO falló:', e.message)
          return NextResponse.json({ ok: false, error: `No se pudo generar el link de pago: ${e.message}` }, { status: 502 })
        }
      }
    }

    // Sin token todavía → no cortamos el servicio: enviamos por Make (temporal).
    if (!META_TOKEN) return enviarPorMake(body)

    const { payload, tipo, contenido, mediaUrl, mediaId, botones } = construir(body)

    const res  = await fetch(GRAPH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok || !data?.messages?.[0]?.id) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      console.error('[/api/saliente] Meta rechazó el envío:', msg)
      return NextResponse.json({ ok: false, error: msg }, { status: 502 })
    }

    const wamid = data.messages[0].id

    // Registrar en MENSAJES (A=ID B=Telefono C=Nombre D=Tipo E=Contenido F=MediaURL
    //  G=Fecha H=Direccion I=MediaID J=RespuestaIA K=FotoIA L=ContextoID M=Botones)
    const telSal = soloDigitos(body.Telefono)
    const fechaSal = new Date().toISOString()
    // Botones (interactivos) serializados para la columna M / campo Supabase.
    const botonesStr = botones && botones.length ? JSON.stringify(botones) : ''
    try {
      // Dual-write del saliente (Sheets 13 cols + Supabase idempotente por wamid).
      await dualWrite(
        () => appendRow('MENSAJES', [
          wamid, telSal, body.Nombre || '', tipo, contenido, mediaUrl,
          fechaSal, 'SALIENTE', mediaId, '', '', '', botonesStr,
        ]),
        () => guardarMensajeSupabase({
          id: wamid, telefono: telSal, nombre: body.Nombre || '', tipo,
          mensaje: contenido, mediaUrl, timestamp: fechaSal, direccion: 'SALIENTE', mediaId,
          botones: botonesStr,
        }),
        'msg.saliente',
      )
    } catch (e) {
      // El mensaje YA se envió por WhatsApp; si falla el log no revertimos.
      console.error('[/api/saliente] Enviado pero no se pudo registrar:', e.message)
    }

    return NextResponse.json({ ok: true, wamid })
  } catch (err) {
    console.error('[/api/saliente]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
