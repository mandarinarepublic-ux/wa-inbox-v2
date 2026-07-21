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

// Sube una imagen a Meta DESDE EL SERVIDOR y devuelve el media id.
// Motivo: mandar `image.link` obliga a Meta a descargar la foto del hosting
// (imgbb). Cuando ese hosting le responde 500 a Meta, el mensaje se acepta con
// 200 pero luego muere con el status `failed` code 131053 "Media upload error"
// → la foto nunca llega y el vendedor no se entera. Subiendo los bytes nosotros,
// Meta ya no depende de terceros.
// Descarga la imagen con User-Agent de navegador, timeout y reintentos.
// imgbb (i.ibb.co) y algunos CDNs responden lento o con 5xx/403 a los fetch
// server-side "pelados": un único intento hacía que la conversión a media id
// fallara y cayéramos al envío por LINK, que Meta luego NO podía bajar y el
// mensaje moría con status `failed` (131053). Con reintentos la conversión casi
// siempre gana, así el envío va por media id (que nunca falla).
async function descargarImagen(url, intentos = 3) {
  let ultimoError
  for (let i = 0; i < intentos; i++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 15000)
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MandarinaInbox/1.0)', Accept: 'image/*' },
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t))
      if (res.ok) return res
      ultimoError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      ultimoError = e
    }
    if (i < intentos - 1) await new Promise(r => setTimeout(r, 400 * (i + 1))) // backoff 400ms, 800ms
  }
  throw new Error(`no se pudo descargar la imagen (${ultimoError?.message || 'desconocido'})`)
}

async function subirImagenAMeta(url) {
  const img = await descargarImagen(url)
  const buf  = await img.arrayBuffer()
  const mime = img.headers.get('content-type') || 'image/jpeg'
  const ext  = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'

  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: mime }), `imagen.${ext}`)
  fd.append('messaging_product', 'whatsapp')

  const res  = await fetch(`https://graph.facebook.com/v19.0/${META_PHONE_ID}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${META_TOKEN}` },
    body: fd,
  })
  const data = await res.json().catch(() => ({}))
  if (!data?.id) throw new Error(data?.error?.message || `upload a Meta falló (HTTP ${res.status})`)
  return data.id
}

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

  // Plantilla (HSM) — único formato permitido FUERA de la ventana de 24h.
  // El cliente manda: TemplateName, TemplateLang, y (según la plantilla) los
  // parámetros de body/header. TemplatePreview = texto ya renderizado para el hilo.
  if (body.TipoMensaje === 'template') {
    const name = body.TemplateName
    const code = body.TemplateLang || 'es'
    let bodyParams = [], headerParams = []
    try { bodyParams   = JSON.parse(body.TemplateBodyParams   || '[]') } catch {}
    try { headerParams = JSON.parse(body.TemplateHeaderParams || '[]') } catch {}
    const headerImage = body.TemplateHeaderImage || ''
    const components = []
    if (headerImage) {
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImage } }] })
    } else if (headerParams.length) {
      components.push({ type: 'header', parameters: headerParams.map((t) => ({ type: 'text', text: String(t) })) })
    }
    if (bodyParams.length) {
      components.push({ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) })
    }
    return {
      tipo: 'texto', // se registra como texto para que se vea en el hilo del chat
      contenido: body.TemplatePreview || `📋 Plantilla: ${name}`,
      mediaUrl: '', mediaId: '',
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name, language: { code }, ...(components.length ? { components } : {}) },
      },
    }
  }

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

  // Video por URL pública (Supabase Storage). El navegador sube el archivo DIRECTO
  // a Supabase (sin el muro de 4.5 MB de Vercel) y Meta lo descarga del link.
  // Permite hasta 16 MB. Supabase es un host confiable → Meta no falla al bajarlo.
  if (body.VideoURL) {
    return {
      tipo: 'video',
      contenido: body.Caption || '', mediaUrl: body.VideoURL, mediaId: '',
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'video',
        video: body.Caption ? { link: body.VideoURL, caption: body.Caption } : { link: body.VideoURL },
      },
    }
  }

  // Imagen por MediaID (subida antes vía /api/media/upload — camino sin terceros)
  if (body.ImagenMediaId) {
    return {
      tipo: 'imagen',
      contenido: body.Caption || '',
      mediaUrl: body.ImagenURL || '',   // url pública solo para pintar el hilo
      mediaId: body.ImagenMediaId,
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: body.Caption
          ? { id: body.ImagenMediaId, caption: body.Caption }
          : { id: body.ImagenMediaId },
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
    if (!body.TipoMensaje && !body.ImagenURL && !body.VideoMediaId && !body.VideoURL) {
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

    const construido = construir(body)
    const { payload, tipo, contenido, mediaUrl, botones } = construido
    let mediaId = construido.mediaId

    // Imagen por link (respuestas rápidas, catálogo, fotos ya subidas a imgbb):
    // la convertimos a media id ANTES de enviar, así Meta no descarga de terceros.
    // Si la conversión falla, seguimos con el link de siempre (mejor eso que nada).
    if (payload.type === 'image' && payload.image?.link) {
      try {
        const id = await subirImagenAMeta(payload.image.link)
        payload.image = payload.image.caption ? { id, caption: payload.image.caption } : { id }
        mediaId = id
      } catch (e) {
        console.error('[/api/saliente] no se pudo subir la imagen a Meta, se envía por link:', e.message)
      }
    }

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
