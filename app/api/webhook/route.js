import { NextResponse } from 'next/server'
import { readSheet, appendRow } from '@/lib/sheets'
import { registrarContactoEntrante, getContactos } from '@/lib/contactos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Agente IA (mandi-agent) — reemplaza el módulo HTTP que llamaba Make ────────
// El agente NO envía el WhatsApp: DEVUELVE el texto. Nosotros lo enviamos por
// /api/saliente (que además lo registra en MENSAJES). Solo se llama si el contacto
// tiene ModoIA = "IA" (igual que el filtro "IA PRENDIDA" del escenario de Make).
const AGENT_URL = process.env.MANDI_AGENT_URL || 'https://mandi-agent.vercel.app/api/agent'
const AGENT_KEY = process.env.MANDI_AGENT_KEY || 'mandi_republic_2024'

const tail9 = (s) => String(s || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)

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
    // Enviar la respuesta del agente (texto con sus URLs de foto) por nuestra ruta,
    // que maneja Meta-directo-o-Make y registra la salida en la hoja.
    await fetch(`${origin}/api/saliente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Telefono: phone, Nombre: name || '', Mensaje: reply }),
    }).catch(e => console.error('[webhook IA] envío falló:', e.message))
  } catch (e) {
    console.error('[webhook IA] agente falló:', e.message)
  }
}

// ── Webhook de Meta/WhatsApp — RECEPCIÓN directa (reemplaza a Make) ────────────
// Meta llama aquí con cada mensaje entrante. Escribimos la fila en MENSAJES y
// hacemos upsert del contacto en CONTACTOS. El inbox sigue leyendo por polling.
//
// En Meta → WhatsApp → Configuration, apunta la Callback URL a:
//   https://wa-inbox-v2.vercel.app/api/webhook
// y usa como Verify Token el valor de WHATSAPP_VERIFY_TOKEN. Suscribe el campo "messages".
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || ''

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

// ── Recepción de mensajes (POST) ──────────────────────────────────────────────
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const entries = body?.entry || []

    // Recolecta los mensajes entrantes (ignora statuses de entrega/lectura)
    const nuevos = []
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value    = change?.value || {}
        const contacts = value?.contacts || []
        const nombreDe = {}
        for (const c of contacts) nombreDe[c.wa_id] = c.profile?.name || ''

        for (const msg of value?.messages || []) {
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

    if (nuevos.length) {
      // Dedup por wamid: Meta reintenta la entrega, evita filas duplicadas
      const rows   = await readSheet('MENSAJES').catch(() => [])
      const vistos = new Set(rows.map(r => String(r[0] || '')))

      // Para decidir la auto-respuesta IA necesitamos el ModoIA del contacto.
      const contactos = await getContactos().catch(() => [])
      const modoIAde = (phone) => {
        const t = tail9(phone)
        const c = contactos.find(c => tail9(c.telefono) === t)
        return c ? c.modoIA !== false : true // contacto nuevo → IA prendida por defecto
      }
      const origin = new URL(req.url).origin

      for (const m of nuevos) {
        if (m.wamid && vistos.has(m.wamid)) continue
        vistos.add(m.wamid)
        // A=ID B=Telefono C=Nombre D=Tipo E=Contenido F=MediaURL G=Fecha
        //  H=Direccion I=MediaID J=RespuestaIA K=FotoIA L=ContextoID
        await appendRow('MENSAJES', [
          m.wamid, m.telefono, m.nombre, m.tipo, m.contenido, '',
          m.fecha, 'ENTRANTE', m.mediaId, '', '', m.contextoId,
        ])
        try { await registrarContactoEntrante(m.telefono, m.nombre, m.telefono) }
        catch (e) { console.error('[/api/webhook] contacto:', e.message) }

        // Auto-respuesta IA: solo texto y solo si el contacto tiene la IA prendida.
        if (m.tipo === 'texto' && String(m.contenido).trim() && modoIAde(m.telefono)) {
          await responderConIA(origin, m.telefono, m.nombre, m.contenido)
        }
      }
    }

    // Meta exige 200 rápido o reintenta
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/webhook]', err)
    // 200 igual para que Meta no reintente en bucle por un fallo nuestro
    return NextResponse.json({ ok: false, error: err.message })
  }
}
