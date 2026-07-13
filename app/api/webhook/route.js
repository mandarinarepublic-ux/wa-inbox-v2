import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { readSheet, appendRow } from '@/lib/sheets'
import { registrarContactoEntrante, getContactos } from '@/lib/contactos'
import { dualWrite, usaSupabaseLectura } from '@/lib/supabase'
import { guardarMensajeSupabase, existeWamidSupabase } from '@/lib/inbox-supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Webhook de Meta/WhatsApp — RECEPCIÓN directa (reemplaza a Make) ────────────
// CLAVE: le respondemos 200 a Meta AL INSTANTE y hacemos el trabajo pesado
// (escribir en la hoja + auto-respuesta IA) en segundo plano con waitUntil. Si
// bloqueáramos la respuesta esperando a la IA (~10s), Meta creería que fallamos y
// REINTENTARÍA el mismo mensaje → respuestas duplicadas al cliente.
//
// En Meta → WhatsApp → Configuration, Callback URL = https://wa-inbox-v2.vercel.app/api/webhook
// Verify Token = WHATSAPP_VERIFY_TOKEN. Suscribir el campo "messages".
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || ''

// ── Agente IA (mandi-agent) — reemplaza el módulo HTTP que llamaba Make ────────
// El agente NO envía el WhatsApp: DEVUELVE el texto. Nosotros lo enviamos por
// /api/saliente (que además lo registra en MENSAJES). Solo si el contacto tiene ModoIA="IA".
const AGENT_URL = process.env.MANDI_AGENT_URL || 'https://mandi-agent.vercel.app/api/agent'
const AGENT_KEY = process.env.MANDI_AGENT_KEY || 'mandi_republic_2024'

const tail9 = (s) => String(s || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)

// Dedup en memoria (sobrevive entre invocaciones en una instancia tibia): atrapa los
// reintentos rápidos de Meta al mismo servidor antes de tocar la hoja.
const procesados = new Set()
function marcarNuevo(wamid) {
  if (!wamid) return true
  if (procesados.has(wamid)) return false
  procesados.add(wamid)
  if (procesados.size > 600) procesados.delete(procesados.values().next().value)
  return true
}

async function responderConIA(origin, phone, name, message) {
  try {
    const r = await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mandi-key': AGENT_KEY },
      body: JSON.stringify({ phone, name: name || '', message, source: 'webhook' }),
      signal: AbortSignal.timeout(22000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { console.error('[webhook IA] agente', r.status, data?.error || ''); return }
    const reply = String(data?.reply_clean || data?.reply || '').trim()
    if (!reply) return
    await fetch(`${origin}/api/saliente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Telefono: phone, Nombre: name || '', Mensaje: reply }),
    }).catch(e => console.error('[webhook IA] envío falló:', e.message))
  } catch (e) {
    console.error('[webhook IA] agente falló:', e.message)
  }
}

// ── Verificación del webhook (GET) ────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// Extrae { tipo, contenido, mediaId, contextoId } según el tipo de mensaje de Meta
function extraer(msg) {
  const contextoId = msg.context?.id || ''
  const base = (o) => ({ ...o, contextoId })
  switch (msg.type) {
    case 'text':     return base({ tipo: 'texto',     contenido: msg.text?.body || '',        mediaId: '' })
    case 'image':    return base({ tipo: 'imagen',    contenido: msg.image?.caption || '',    mediaId: msg.image?.id || '' })
    case 'video':    return base({ tipo: 'video',     contenido: msg.video?.caption || '',    mediaId: msg.video?.id || '' })
    case 'audio':    return base({ tipo: 'audio',     contenido: '',                          mediaId: msg.audio?.id || '' })
    case 'document': return base({ tipo: 'documento', contenido: msg.document?.filename || '', mediaId: msg.document?.id || '' })
    case 'sticker':  return base({ tipo: 'sticker',   contenido: '',                          mediaId: msg.sticker?.id || '' })
    case 'button':   return base({ tipo: 'texto',     contenido: msg.button?.text || '',      mediaId: '' })
    case 'interactive': {
      const i = msg.interactive || {}
      const title = i.button_reply?.title || i.list_reply?.title || ''
      return base({ tipo: 'texto', contenido: title, mediaId: '' })
    }
    case 'location': {
      const l = msg.location || {}
      return base({ tipo: 'texto', contenido: `📍 ${l.latitude},${l.longitude} ${l.name || ''}`.trim(), mediaId: '' })
    }
    default:         return base({ tipo: msg.type || 'texto', contenido: '', mediaId: '' })
  }
}

// ── Trabajo pesado en segundo plano (fuera del ciclo de respuesta a Meta) ──────
async function procesar(nuevos, origin) {
  // Dedup por wamid contra el backend activo (2ª capa, además del set en memoria).
  // En 'sheets'/'dual' = Set de la hoja; en 'supabase' = existeWamid (+ UNIQUE en BD).
  const enSupabase = usaSupabaseLectura()
  let vistos = new Set()
  if (!enSupabase) {
    const rows = await readSheet('MENSAJES').catch(() => [])
    vistos = new Set(rows.map(r => String(r[0] || '')))
  }
  const yaVisto = async (wamid) => {
    if (!wamid) return false
    if (vistos.has(wamid)) return true
    if (enSupabase && (await existeWamidSupabase(wamid).catch(() => false))) return true
    return false
  }

  const contactos = await getContactos().catch(() => [])
  const modoIAde = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c ? c.modoIA !== false : true // contacto nuevo → IA prendida por defecto
  }

  for (const m of nuevos) {
    if (await yaVisto(m.wamid)) continue
    vistos.add(m.wamid)
    // Escritura dual del entrante (Sheets 12 cols + Supabase idempotente por wamid).
    // A=ID B=Tel C=Nombre D=Tipo E=Contenido F=MediaURL G=Fecha H=Direccion I=MediaID J K L=ContextoID
    await dualWrite(
      () => appendRow('MENSAJES', [
        m.wamid, m.telefono, m.nombre, m.tipo, m.contenido, '',
        m.fecha, 'ENTRANTE', m.mediaId, '', '', m.contextoId,
      ]),
      () => guardarMensajeSupabase({
        id: m.wamid, telefono: m.telefono, nombre: m.nombre, tipo: m.tipo,
        mensaje: m.contenido, mediaUrl: '', timestamp: m.fecha, direccion: 'ENTRANTE',
        mediaId: m.mediaId, contextoId: m.contextoId,
      }),
      'msg.entrante',
    ).catch(e => console.error('[/api/webhook] guardar entrante:', e.message))

    try { await registrarContactoEntrante(m.telefono, m.nombre, m.telefono) }
    catch (e) { console.error('[/api/webhook] contacto:', e.message) }

    // Auto-respuesta IA: solo texto y solo si el contacto tiene la IA prendida.
    if (m.tipo === 'texto' && String(m.contenido).trim() && modoIAde(m.telefono)) {
      await responderConIA(origin, m.telefono, m.nombre, m.contenido)
    }
  }
}

// ── Recepción de mensajes (POST) — responde 200 YA, procesa en background ──────
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const entries = body?.entry || []
    const origin = new URL(req.url).origin

    const nuevos = []
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value    = change?.value || {}
        const contacts = value?.contacts || []
        const nombreDe = {}
        for (const c of contacts) nombreDe[c.wa_id] = c.profile?.name || ''

        for (const msg of value?.messages || []) {
          if (!marcarNuevo(msg.id)) continue // reintento rápido de Meta → ignorar
          const telefono = String(msg.from || '')
          const { tipo, contenido, mediaId, contextoId } = extraer(msg)
          nuevos.push({
            wamid: msg.id || '',
            telefono,
            nombre: nombreDe[telefono] || '',
            tipo, contenido, mediaId, contextoId,
            fecha: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          })
        }
      }
    }

    // Meta exige un 200 rápido: lo damos YA y hacemos hoja+IA en segundo plano.
    if (nuevos.length) waitUntil(procesar(nuevos, origin))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/webhook]', err)
    return NextResponse.json({ ok: false, error: err.message })
  }
}
