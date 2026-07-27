import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { waitUntil } from '@vercel/functions'
import { guardarSocialMensajeSupabase, getFbPageToken } from '@/lib/social-supabase'
import { guardarEventoCrudoSupabase } from '@/lib/inbox-supabase'
import { usaSupabaseLectura } from '@/lib/supabase'

// ── Webhook de Meta para FACEBOOK e INSTAGRAM — recepción DIRECTA ─────────────
// Reemplaza a los escenarios de Make (EscuchaFacebook / EscuchaInstagram) que
// escribían en /api/social/ingest. Mismo patrón que el webhook de WhatsApp:
// le respondemos 200 a Meta AL INSTANTE y guardamos en segundo plano (waitUntil).
// Si tardáramos, Meta reintenta el mismo evento → mensajes duplicados.
//
// En Meta → App → Webhooks, Callback URL = https://wa-inbox-v2.vercel.app/api/social/webhook
// Verify Token = SOCIAL_VERIFY_TOKEN, y META_APP_SECRET (el "App Secret" de la app de
// Meta) es OBLIGATORIO: sin él se rechazan todos los eventos. Campos a suscribir:
//   Página (object "page"):      messages, messaging_postbacks, messaging_referrals, feed
//   Instagram (object "instagram"): messages, comments
// Y además hay que suscribir la app a la página:
//   POST /{page-id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_referrals,feed
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Limpia BOM (U+FEFF) y cualquier carácter no imprimible que se pueda haber colado
// al cargar la variable en Vercel. Un solo byte invisible al final del secreto
// cambia el HMAC entero y la firma no valida NUNCA, sin ninguna pista de por qué.
const limpiar = (s) => String(s || '').replace(/[^\x21-\x7E]/g, '')

const VERIFY_TOKEN = limpiar(process.env.SOCIAL_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || '')
const APP_SECRET   = limpiar(process.env.META_APP_SECRET || '')
const GRAPH = 'https://graph.facebook.com/v19.0'

// ── Verificación del webhook (GET) ────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Firma de Meta (x-hub-signature-256). SIEMPRE se exige: esta URL es pública y sin
// firma cualquiera podría meter conversaciones falsas en el inbox. Si falta
// META_APP_SECRET rechazamos todo — es preferible a quedarnos abiertos en silencio.
function firmaValida(rawBody, cabecera) {
  if (!APP_SECRET) {
    console.error('[social webhook] falta META_APP_SECRET — se rechaza el evento')
    return false
  }
  if (!cabecera?.startsWith('sha256=')) return false
  const esperada = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(cabecera), b = Buffer.from(esperada)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Adjuntos (foto, video, audio, sticker, respuesta a historia). Meta manda una URL
// firmada temporal: la guardamos igual para no perder el mensaje.
function deAdjuntos(adjuntos) {
  const a = adjuntos?.[0]
  if (!a) return { etiqueta: '', url: '' }
  const url  = a.payload?.url || ''
  const tipo = String(a.type || '').toLowerCase()
  const etiqueta = {
    image: '📷 Foto', video: '🎥 Video', audio: '🎤 Audio',
    file: '📎 Archivo', share: '🔗 Enlace', story_mention: '📸 Te mencionó en su historia',
  }[tipo] || `📎 ${tipo || 'adjunto'}`
  return { etiqueta, url }
}

// Datos de pauta de un referral de Meta (anuncio Click-to-Messenger o enlace m.me).
function dePauta(ref) {
  if (!ref) return { ad_id: '', pauta: '', ref: '' }
  return {
    ad_id: String(ref.ad_id || ''),
    pauta: String(ref.ads_context_data?.ad_title || ''),
    ref:   String(ref.ref || ref.source || ref.type || ''),
  }
}

// ── entry[].messaging[] — DM de Messenger y DM de Instagram (misma forma) ──────
function deMensajeDirecto(item, canal) {
  const msg = item?.message || {}
  if (msg.is_deleted) return null

  // En un "echo" el que habla es la página: el cliente es el destinatario.
  const esEcho = !!msg.is_echo
  const sender_id = String((esEcho ? item?.recipient?.id : item?.sender?.id) || '')
  if (!sender_id) return null

  const { etiqueta, url } = deAdjuntos(msg.attachments)
  let texto = msg.text || ''
  let msg_id = msg.mid || ''

  // Botón de un anuncio / "Enviar mensaje": llega como postback, no como message.
  if (!msg_id && item?.postback) {
    texto = item.postback.title || item.postback.payload || ''
    msg_id = item.postback.mid || ''
  }
  const referral = item?.referral || msg.referral || item?.postback?.referral
  // Nada que registrar: ni texto, ni adjunto, ni origen de pauta (p.ej. un "read").
  if (!texto && !url && !referral) return null
  // Referral suelto: entró desde un anuncio/enlace pero todavía no escribió. Se
  // registra igual (para no perder la pauta) con un id propio, estable si Meta
  // reintenta el mismo evento.
  if (!msg_id && !texto && !url) {
    texto = '📢 Entró desde un anuncio'
    msg_id = `ref-${sender_id}-${item?.timestamp || ''}`
  }

  const pauta = dePauta(referral)

  return {
    canal,
    tipo: 'DM',
    sender_id,
    nombre: '',
    direccion: esEcho ? 'SALIENTE' : 'ENTRANTE',
    texto: texto || etiqueta,
    media_url: url,
    msg_id,
    fecha: item?.timestamp ? new Date(Number(item.timestamp)).toISOString() : new Date().toISOString(),
    estado: esEcho ? 'ATENDIDO' : 'PENDIENTE',
    ...pauta,
    comment_id: '',
    raw: item,
  }
}

// ── changes[] field "feed" — comentarios en publicaciones de FACEBOOK ──────────
function deComentarioFB(value, pageId) {
  if (value?.item !== 'comment') return null
  if (value?.verb && !['add', 'edited'].includes(String(value.verb))) return null
  const fromId = String(value?.from?.id || '')
  if (!fromId || fromId === String(pageId)) return null // comentario nuestro

  const foto = value?.photo || ''
  return {
    canal: 'FB',
    tipo: 'COMENTARIO',
    sender_id: fromId,
    nombre: value?.from?.name || '',
    direccion: 'ENTRANTE',
    texto: value?.message || (foto ? '📷 Foto' : ''),
    media_url: foto || '',
    msg_id: String(value?.comment_id || ''),
    fecha: value?.created_time ? new Date(Number(value.created_time) * 1000).toISOString() : new Date().toISOString(),
    estado: 'PENDIENTE',
    ad_id: String(value?.post_id || ''),
    pauta: '',
    ref: 'FEED',
    comment_id: String(value?.comment_id || ''),
    raw: value,
  }
}

// ── changes[] field "comments" — comentarios en publicaciones de INSTAGRAM ─────
function deComentarioIG(value, igId) {
  const fromId = String(value?.from?.id || '')
  const usuario = value?.from?.username || ''
  // IG a veces no manda el id de quien comenta: usamos el username como identidad
  // para no perder el mensaje (mismo criterio que traía /api/social/ingest).
  const sender_id = fromId || usuario
  if (!sender_id) return null
  if (fromId && fromId === String(igId)) return null // comentario nuestro

  const media = value?.media || {}
  return {
    canal: 'IG',
    tipo: 'COMENTARIO',
    sender_id,
    nombre: usuario,
    direccion: 'ENTRANTE',
    texto: value?.text || '',
    media_url: '',
    msg_id: String(value?.id || ''),
    fecha: value?.timestamp ? new Date(value.timestamp).toISOString() : new Date().toISOString(),
    estado: 'PENDIENTE',
    // ad_id guarda el id del media comentado → /api/social/media muestra la publicación.
    ad_id: String(media.id || ''),
    pauta: '',
    // AD / REELS / FEED / STORY — lo que ya interpreta pautaInfo() en SocialInbox.
    ref: media.ad_id ? 'AD' : String(media.media_product_type || ''),
    comment_id: String(value?.id || ''),
    raw: value,
  }
}

// Nombre real del cliente en un DM. Sin esto la conversación se ve como un número
// (PSID), que es como quedaban los chats de Facebook hasta ahora.
const nombreCache = new Map()
async function resolverNombre(id, canal, token) {
  if (!token || !id) return ''
  const clave = `${canal}:${id}`
  if (nombreCache.has(clave)) return nombreCache.get(clave)
  try {
    const campos = canal === 'IG' ? 'name,username' : 'name'
    const res = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=${campos}&access_token=${encodeURIComponent(token)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    const d = await res.json().catch(() => ({}))
    const nombre = d?.name || d?.username || ''
    if (nombreCache.size > 500) nombreCache.clear()
    nombreCache.set(clave, nombre)
    return nombre
  } catch (e) {
    console.error('[social webhook] nombre no resuelto:', e.message)
    return ''
  }
}

// ── Guardado en segundo plano ─────────────────────────────────────────────────
async function procesar(eventos) {
  const token = await getFbPageToken().catch(() => '')
  for (const ev of eventos) {
    try {
      // Los comentarios ya traen el nombre en el payload; los DM no.
      if (!ev.nombre && ev.tipo === 'DM') {
        ev.nombre = await resolverNombre(ev.sender_id, ev.canal, token)
      }
      await guardarSocialMensajeSupabase(ev)
    } catch (e) {
      console.error('[social webhook] no se pudo guardar:', e.message, ev.canal, ev.msg_id)
    }
  }
}

// ── Recepción (POST) ──────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const raw = await req.text()
    if (!firmaValida(raw, req.headers.get('x-hub-signature-256'))) {
      // Diagnóstico sin exponer el secreto: un App Secret de Meta son 32 caracteres
      // hexadecimales. Si acá NO dice 32/hex=true, el valor guardado está mal (BOM,
      // recortado, pegado a medias). Si dice 32/hex=true y aun así falla, entonces
      // el secreto es de OTRA app y hay que copiarlo de la que manda los eventos.
      console.error('[social webhook] firma inválida — secreto: %d chars, hex=%s, cabecera=%s',
        APP_SECRET.length, /^[0-9a-f]+$/i.test(APP_SECRET),
        req.headers.get('x-hub-signature-256') ? 'sí' : 'NO')
      return new NextResponse('Forbidden', { status: 403 })
    }

    let body = {}
    try { body = JSON.parse(raw || '{}') } catch {}
    const objeto  = String(body?.object || '')
    const entries = body?.entry || []
    if (!['page', 'instagram'].includes(objeto)) {
      return NextResponse.json({ ok: true, ignorado: objeto })
    }

    // Respaldo crudo del POST completo (mismo histórico que el webhook de WhatsApp).
    if (usaSupabaseLectura() && entries.length) waitUntil(guardarEventoCrudoSupabase(body))

    const canal = objeto === 'instagram' ? 'IG' : 'FB'
    const eventos = []

    for (const entry of entries) {
      const propioId = entry?.id || '' // id de la página (FB) o de la cuenta (IG)

      // DM — Messenger e Instagram usan la misma estructura.
      for (const item of entry?.messaging || entry?.standby || []) {
        const ev = deMensajeDirecto(item, canal)
        if (ev) eventos.push(ev)
      }

      // Comentarios.
      for (const change of entry?.changes || []) {
        const value = change?.value || {}
        const campo = String(change?.field || '')
        let ev = null
        if (canal === 'FB' && campo === 'feed') ev = deComentarioFB(value, propioId)
        else if (canal === 'IG' && (campo === 'comments' || campo === 'live_comments')) ev = deComentarioIG(value, propioId)
        // IG también puede mandar los DM dentro de changes[field="messages"].
        else if (campo === 'messages' && value?.sender) ev = deMensajeDirecto(value, canal)
        if (ev) eventos.push(ev)
      }
    }

    if (eventos.length) waitUntil(procesar(eventos))
    return NextResponse.json({ ok: true, eventos: eventos.length })
  } catch (err) {
    console.error('[/api/social/webhook]', err)
    // 200 igual: si devolvemos error, Meta reintenta y puede duplicar.
    return NextResponse.json({ ok: false, error: err.message })
  }
}
