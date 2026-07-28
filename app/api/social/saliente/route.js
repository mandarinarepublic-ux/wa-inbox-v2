import { NextResponse } from 'next/server'
import { guardarSocialMensajeSupabase, getTokenPagina, getFbPageId } from '@/lib/social-supabase'
import { esHiloPublico, cuerpoMensajeMeta } from '@/lib/social-envio'
import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'

// Envío saliente del Social Inbox. Cuatro casos, cada uno con su endpoint:
//   FB · DM         → Send API, recipient {id: PSID}
//   IG · DM         → Send API, recipient {id: IGSID}
//   FB · comentario → respuesta PRIVADA por /{comment_id}/private_replies
//   IG · comentario → respuesta PRIVADA por Send API, recipient {comment_id}
//   (cualquier comentario) con modo:'publico' → responde EN el hilo del comentario
// Meta permite UNA sola respuesta privada por comentario; la pública no tiene tope.
//
// El token de PÁGINA sale de env FB_PAGE_TOKEN o, si no está, de inbox.app_config
// (getFbPageToken). Usa un token de Usuario del Sistema: NO caduca. Un token de
// página normal caduca a los ~60 días y el envío muere en silencio (código 190).
export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v19.0'

async function graphPost(path, params, token) {
  const res = await fetch(`${GRAPH}/${path}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && !data.error, status: res.status, data }
}

export async function POST(req) {
  try {
    const FB_PAGE_TOKEN = await getTokenPagina()
    if (!FB_PAGE_TOKEN) {
      return NextResponse.json({ error: 'FB_PAGE_TOKEN no configurado en el servidor' }, { status: 500 })
    }
    const { sender_id, message, canal, comment_id, tipo, modo, imagen } = await req.json()
    if (!sender_id || (!message && !imagen)) {
      return NextResponse.json({ error: 'Faltan sender_id y contenido (message o imagen)' }, { status: 400 })
    }

    // Mandar a /{page-id}/messages y no a /me/messages: así sirve tanto un token de
    // página como uno de usuario del sistema. Si no hay id configurado, cae a 'me'.
    const pageId = await getFbPageId().catch(() => '')
    const RUTA_MSGS = `${pageId ? encodeURIComponent(pageId) : 'me'}/messages`

    const esIG = String(canal).toUpperCase() === 'IG'
    // Única fuente de verdad para "¿esto es un comentario?": la misma función
    // decide el ENRUTAMIENTO (abajo) y las GUARDIAS de foto/LINKPAGO (aquí).
    // Antes el enrutamiento y admiteAdjuntos(tipo) preguntaban cosas distintas
    // y podían discrepar — un IG con comment_id pero sin tipo colaba como DM en
    // la guardia y como comentario en el ruteo: el link de pago se creaba y
    // salía por la rama pública. Ver lib/social-envio.js.
    const esComentario = esHiloPublico({ tipo, canal, comment_id })
    const publico = String(modo || '') === 'publico'

    // Un comentario es PÚBLICO: una foto ahí quedaría a la vista de todos. Se
    // rechaza acá, con un mensaje que el vendedor entienda, en vez de dejar que
    // Meta conteste un error genérico sobre el adjunto.
    if (imagen && esComentario) {
      return NextResponse.json(
        { error: 'Instagram no admite fotos en un comentario. Responde en privado y mándala por el chat.' },
        { status: 400 }
      )
    }

    if (esComentario && !comment_id) {
      return NextResponse.json({ error: 'falta comment_id para responder al comentario' }, { status: 400 })
    }

    // LINKPAGO35 → link de cobro de dLocal. Mismo comando que en WhatsApp.
    // Solo en DM: un link de pago no va en un comentario público.
    let texto = String(message || '')
    const monto = parseLinkpago(texto)
    if (monto && !esComentario) {
      // Si además viene una foto, cuerpoMensajeMeta se queda con la imagen y
      // tira el texto: el link ya estaría cobrado en dLocal pero jamás se
      // manda. Mejor cortar ANTES de crear el cobro que dejar un cobro fantasma.
      if (imagen) {
        return NextResponse.json(
          { error: 'No se puede mandar una foto junto con un LINKPAGO. Mándalos en envíos separados.' },
          { status: 400 }
        )
      }
      const link = await crearLinkPago(monto, `SOCIAL-${Date.now()}`)
      texto = mensajeLinkPago(monto, link)
    }

    // Meta no admite texto y adjunto en el mismo mensaje: con imagen, el texto
    // (si vino LINKPAGO o algo más) se descarta a favor de la foto.
    const cuerpo = cuerpoMensajeMeta({ texto: imagen ? '' : texto, imagen })

    let r
    if (esComentario && publico) {
      // Respuesta pública: queda colgada del comentario, la ve todo el mundo.
      r = await graphPost(`${encodeURIComponent(comment_id)}/comments`, { message: texto }, FB_PAGE_TOKEN)
    } else if (esComentario && esIG) {
      // IG: respuesta privada al comentario (abre el DM).
      r = await graphPost(RUTA_MSGS, { recipient: { comment_id: String(comment_id) }, message: cuerpo }, FB_PAGE_TOKEN)
    } else if (esComentario) {
      // FB: respuesta privada al comentario (endpoint propio de la página).
      r = await graphPost(`${encodeURIComponent(comment_id)}/private_replies`, { message: texto }, FB_PAGE_TOKEN)
    } else {
      // DM normal (FB o IG). Ventana de 24 h.
      const body = { recipient: { id: String(sender_id) }, message: cuerpo }
      if (!esIG) body.messaging_type = 'RESPONSE'
      r = await graphPost(RUTA_MSGS, body, FB_PAGE_TOKEN)
    }

    if (!r.ok) {
      const err = r.data?.error || {}
      // Meta contesta "An unknown error has occurred" para media docena de causas
      // distintas. Sin el código y el contexto no hay forma de saber cuál fue.
      console.error('[/api/social/saliente] Meta rechazó — code=%s subcode=%s msg=%s | canal=%s tipo=%s modo=%s comment_id=%s sender=%s',
        err.code, err.error_subcode, err.message, canal, esComentario ? 'COMENTARIO' : 'DM',
        publico ? 'publico' : 'privado', comment_id || '—', String(sender_id).slice(0, 8) + '…')
      return NextResponse.json(
        { error: err.message || `Envío falló (HTTP ${r.status})`, code: err.code, subcode: err.error_subcode },
        { status: 502 }
      )
    }

    // Registra el saliente en Supabase para que aparezca en el inbox al refrescar.
    // Al responder, la conversación queda ATENDIDA. Si el log falla, el mensaje YA
    // se envió → no es fatal.
    try {
      await guardarSocialMensajeSupabase({
        canal: canal || 'FB',
        tipo: esComentario ? 'COMENTARIO' : 'DM',
        sender_id: String(sender_id),
        direccion: 'SALIENTE',
        texto: publico ? `↩️ (público) ${texto}` : texto,
        media_url: imagen || '',
        msg_id: r.data.message_id || r.data.id || '',
        comment_id: esComentario ? String(comment_id) : '',
        estado: 'ATENDIDO',
      })
    } catch (e) {
      console.error('[/api/social/saliente] no se pudo registrar en Supabase:', e.message)
    }

    return NextResponse.json({ ok: true, id: r.data.message_id || r.data.id || '' })
  } catch (err) {
    console.error('[/api/social/saliente]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
