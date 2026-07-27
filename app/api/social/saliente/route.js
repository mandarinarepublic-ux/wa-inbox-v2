import { NextResponse } from 'next/server'
import { guardarSocialMensajeSupabase, getFbPageToken, getFbPageId } from '@/lib/social-supabase'

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
    const FB_PAGE_TOKEN = await getFbPageToken()
    if (!FB_PAGE_TOKEN) {
      return NextResponse.json({ error: 'FB_PAGE_TOKEN no configurado en el servidor' }, { status: 500 })
    }
    const { sender_id, message, canal, comment_id, tipo, modo } = await req.json()
    if (!message || !sender_id) {
      return NextResponse.json({ error: 'Faltan sender_id o message' }, { status: 400 })
    }

    // Mandar a /{page-id}/messages y no a /me/messages: así sirve tanto un token de
    // página como uno de usuario del sistema. Si no hay id configurado, cae a 'me'.
    const pageId = await getFbPageId().catch(() => '')
    const RUTA_MSGS = `${pageId ? encodeURIComponent(pageId) : 'me'}/messages`

    const esIG = String(canal).toUpperCase() === 'IG'
    const esComentario = String(tipo || '').toUpperCase() === 'COMENTARIO' || (esIG && !!comment_id)
    const publico = String(modo || '') === 'publico'
    const texto = String(message)

    if (esComentario && !comment_id) {
      return NextResponse.json({ error: 'falta comment_id para responder al comentario' }, { status: 400 })
    }

    let r
    if (esComentario && publico) {
      // Respuesta pública: queda colgada del comentario, la ve todo el mundo.
      r = await graphPost(`${encodeURIComponent(comment_id)}/comments`, { message: texto }, FB_PAGE_TOKEN)
    } else if (esComentario && esIG) {
      // IG: respuesta privada al comentario (abre el DM).
      r = await graphPost(RUTA_MSGS, { recipient: { comment_id: String(comment_id) }, message: { text: texto } }, FB_PAGE_TOKEN)
    } else if (esComentario) {
      // FB: respuesta privada al comentario (endpoint propio de la página).
      r = await graphPost(`${encodeURIComponent(comment_id)}/private_replies`, { message: texto }, FB_PAGE_TOKEN)
    } else {
      // DM normal (FB o IG). Ventana de 24 h.
      const body = { recipient: { id: String(sender_id) }, message: { text: texto } }
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
