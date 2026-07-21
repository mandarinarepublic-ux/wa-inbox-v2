import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { registrarContactoEntrante, getContactos, updateEstado, updateModoIA } from '@/lib/contactos'
import { usaSupabaseLectura } from '@/lib/supabase'
import { guardarMensajeSupabase, existeWamidSupabase, guardarEventoCrudoSupabase, actualizarEstadoEntregaSupabase } from '@/lib/inbox-supabase'
import { archivarFoto } from '@/lib/media-archive'
import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'
import { getAutomatizaciones } from '@/lib/automatizaciones'

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

// Regex de URLs de imagen (mismas extensiones que extrae el agente).
const RE_IMG = /https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi

// Envía un mensaje (texto o imagen) por /api/saliente, que lo manda a Meta y lo
// registra en MENSAJES.
async function enviarSaliente(origin, body) {
  return fetch(`${origin}/api/saliente`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => console.error('[webhook IA] envío falló:', e.message))
}

// Mensaje de espera cuando el cliente manda algo que MANDI no procesa (una foto).
const MSG_ESPERA = 'Permíteme un momento por favor 🧡'

// Handoff invisible: el cliente mandó una imagen → MANDI no vende ni identifica.
// Marcamos el contacto SOPORTE + HUMANO (la IA se apaga y un ejecutivo lo toma)
// y respondemos SOLO con el mensaje de espera, en la voz de MANDI.
async function escalarASoporte(origin, phone, name) {
  await Promise.all([
    updateEstado(phone, 'SOPORTE').catch(e => console.error('[webhook IA] estado SOPORTE:', e.message)),
    updateModoIA(phone, 'HUMANO').catch(e => console.error('[webhook IA] modoIA HUMANO:', e.message)),
  ])
  await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: MSG_ESPERA })
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

    // Fotos que MANDI incluyó en su respuesta. El agente las devuelve en
    // data.imagenes; si no vinieran, las extraemos del propio texto.
    let imagenes = Array.isArray(data?.imagenes) ? data.imagenes.filter(Boolean) : []
    if (!imagenes.length) imagenes = reply.match(RE_IMG) || []
    // Dedup preservando el orden.
    imagenes = [...new Set(imagenes)]

    // Quitamos las URLs de imagen del texto para NO mandar links crudos al
    // cliente: cada una se envía aparte como foto real.
    let texto = reply
    for (const u of imagenes) texto = texto.split(u).join('')
    texto = texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

    if (!texto && !imagenes.length) return

    // 1) Primero el texto (descripción, precios, tallas).
    if (texto) await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: texto })
    // 2) Luego cada foto, en orden.
    for (const url of imagenes) {
      await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', ImagenURL: url })
    }
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

// Normaliza el objeto `referral` de Meta (mensajes que entran desde un anuncio
// Click-to-WhatsApp). Devuelve null si no viene de una pauta.
function normalizarReferral(r) {
  if (!r || typeof r !== 'object') return null
  const out = {
    source_type:   r.source_type || '',   // 'ad' | 'post'
    source_id:     r.source_id || '',      // ID del anuncio (o del post)
    source_url:    r.source_url || '',     // link de la pauta
    headline:      r.headline || '',       // titular del anuncio
    body:          r.body || '',           // texto del anuncio
    media_type:    r.media_type || '',     // 'image' | 'video'
    image_url:     r.image_url || '',      // creativo (imagen)
    video_url:     r.video_url || '',      // creativo (video)
    thumbnail_url: r.thumbnail_url || '',  // miniatura del creativo
    ctwa_clid:     r.ctwa_clid || '',      // click id (Conversions API)
  }
  return Object.values(out).some(Boolean) ? out : null
}

// Extrae { tipo, contenido, mediaId, contextoId, referral } según el tipo de mensaje de Meta
function extraer(msg) {
  const contextoId = msg.context?.id || ''
  const referral   = normalizarReferral(msg.referral)
  const base = (o) => ({ ...o, contextoId, referral })
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
  // Dedup por wamid contra Supabase (2ª capa, además del set en memoria + UNIQUE en BD).
  const vistos = new Set()
  const yaVisto = async (wamid) => {
    if (!wamid) return false
    if (vistos.has(wamid)) return true
    if (await existeWamidSupabase(wamid).catch(() => false)) return true
    return false
  }

  const contactos = await getContactos().catch(() => [])
  // Config de automatizaciones (saludos). Un fetch por ciclo. Si falla → sin saludos.
  const auto = await getAutomatizaciones().catch(() => null)
  const modoIAde = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c ? c.modoIA !== false : false // contacto nuevo → IA APAGADA (la prende un humano)
  }
  // Estado de flujo actual del contacto (snapshot de este ciclo). Contacto nuevo → 'pendiente'.
  const estadoDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c ? String(c.estado || 'pendiente').toLowerCase().trim() : 'pendiente'
  }
  // ¿Contacto NUEVO? El mensaje ya se guardó (creando la conversación), así que no
  // sirve el "creado" del registro: usamos el SNAPSHOT leído al inicio del ciclo —
  // si no está ahí, es su primer mensaje de la historia.
  const esNuevoDe = (phone) => !contactos.find(c => tail9(c.telefono) === tail9(phone))
  // Marca de tiempo del ÚLTIMO entrante ANTERIOR (del snapshot) → detecta reactivación.
  const ultimoEntranteAtDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c?.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
  }
  // Anti doble-saludo dentro del mismo lote de webhook.
  const saludados = new Set()

  // Saludo automático. Solo cuando la IA está APAGADA para el contacto (si está
  // prendida, el propio agente saluda → evitamos doble mensaje). Nuevo → saludo de
  // bienvenida; reactivación tras N horas de silencio → "hola de vuelta".
  async function saludarSiCorresponde(phone, name) {
    if (!auto || modoIAde(phone)) return
    const t = tail9(phone)
    if (saludados.has(t)) return
    const nuevo = esNuevoDe(phone)
    if (nuevo) {
      const s = auto.saludo_nuevo
      if (s?.activo && String(s.texto || '').trim()) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim() })
      }
      return
    }
    const s = auto.saludo_reactivacion
    if (s?.activo && String(s.texto || '').trim()) {
      const horas  = Number(s.horas) || 12
      const prevMs = ultimoEntranteAtDe(phone)
      if (prevMs && Date.now() - prevMs >= horas * 3600 * 1000) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim() })
      }
    }
  }

  // Archivado de fotos entrantes a Supabase Storage (URL estable en media_url).
  // Corre concurrente con la IA; lo esperamos al final para que waitUntil no mate
  // la función antes de terminar. Solo en modo supabase (la fila ya está insertada).
  const archivos = []

  for (const m of nuevos) {
    if (await yaVisto(m.wamid)) continue
    vistos.add(m.wamid)
    // Registro del entrante en Supabase (idempotente por wamid).
    await guardarMensajeSupabase({
      id: m.wamid, telefono: m.telefono, nombre: m.nombre, tipo: m.tipo,
      mensaje: m.contenido, mediaUrl: '', timestamp: m.fecha, direccion: 'ENTRANTE',
      mediaId: m.mediaId, contextoId: m.contextoId, referral: m.referral, raw: m.raw,
    }).catch(e => console.error('[/api/webhook] guardar entrante:', e.message))

    // Archivar la foto entrante a Supabase Storage (URL estable → media_url). Solo
    // en modo supabase, donde la fila ya quedó insertada por guardarMensajeSupabase arriba.
    if (usaSupabaseLectura() && (m.tipo === 'imagen' || m.tipo === 'sticker') && m.mediaId) {
      archivos.push(archivarFoto({ mediaId: m.mediaId, wamid: m.wamid }))
    }

    try { await registrarContactoEntrante(m.telefono, m.nombre, m.telefono) }
    catch (e) { console.error('[/api/webhook] contacto:', e.message) }

    // REABRIR: un cliente que ya estaba ATENDIDO y vuelve a escribir debe regresar
    // a PENDIENTES (necesita atención). Esto lo hacía Make en la recepción; al pasar
    // al webhook directo se perdió y los chats se quedaban "atascados" en Atendidos.
    // No tocamos ventaproceso/venta/soporte/archivado: son estados deliberados.
    if (estadoDe(m.telefono) === 'atendido') {
      await updateEstado(m.telefono, 'PENDIENTE')
        .catch(e => console.error('[/api/webhook] reabrir a PENDIENTE:', e.message))
    }

    // Saludo automático (bienvenida a nuevo / "hola de vuelta" al reactivarse).
    // Va antes de LINKPAGO/IA y solo dispara con la IA apagada.
    await saludarSiCorresponde(m.telefono, m.nombre)
      .catch(e => console.error('[/api/webhook] saludo:', e.message))

    // LINKPAGO<monto> entrante → genera link dLocal y lo devuelve al remitente.
    // Funciona SIEMPRE (independiente del modo IA), como el flujo viejo de Make.
    if (m.tipo === 'texto') {
      const monto = parseLinkpago(m.contenido)
      if (monto) {
        try {
          const link = await crearLinkPago(monto, `${m.telefono}-${Date.now()}`)
          await enviarSaliente(origin, { Telefono: m.telefono, Nombre: m.nombre || '', Mensaje: mensajeLinkPago(monto, link) })
        } catch (e) {
          console.error('[webhook LINKPAGO] falló:', e.message)
        }
        continue // no seguir con la IA para este mensaje
      }
    }

    // Auto-respuesta IA (solo si el contacto tiene la IA prendida):
    if (modoIAde(m.telefono)) {
      if (m.tipo === 'texto' && String(m.contenido).trim()) {
        // Texto → MANDI responde normalmente.
        await responderConIA(origin, m.telefono, m.nombre, m.contenido)
      } else if (m.tipo === 'imagen') {
        // Foto del cliente → NO vender/identificar: mensaje de espera + handoff a
        // SOPORTE (apaga la IA para que un ejecutivo tome el chat).
        await escalarASoporte(origin, m.telefono, m.nombre)
      }
    }
  }

  // Esperar el archivado de fotos: mantiene viva la función (waitUntil) hasta que
  // todas las subidas a Storage + updates de media_url terminen. No bloquea la IA
  // (corrió concurrente durante el loop).
  if (archivos.length) await Promise.allSettled(archivos)
}

// Read receipts: procesa los value.statuses[] de Meta (sent/delivered/read/failed)
// y actualiza estado_entrega del mensaje saliente por wamid. Solo en modo supabase.
async function procesarStatuses(statuses) {
  if (!usaSupabaseLectura()) return
  for (const s of statuses) {
    await actualizarEstadoEntregaSupabase(s.wamid, s.estado)
      .catch(e => console.error('[webhook status]', e.message))
  }
}

// ── Recepción de mensajes (POST) — responde 200 YA, procesa en background ──────
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const entries = body?.entry || []
    const origin = new URL(req.url).origin

    // Respaldo crudo (histórico tipo Make): guarda el POST COMPLETO tal cual llegó,
    // antes de parsear. En background: Meta recibe su 200 al instante. Best-effort.
    if (usaSupabaseLectura() && entries.length) {
      waitUntil(guardarEventoCrudoSupabase(body))
    }

    const nuevos = []
    const statuses = [] // read receipts: {wamid, estado}
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value    = change?.value || {}
        const contacts = value?.contacts || []
        const nombreDe = {}
        for (const c of contacts) nombreDe[c.wa_id] = c.profile?.name || ''

        // Estados de entrega (✓✓) de mensajes que ENVIAMOS.
        for (const st of value?.statuses || []) {
          if (st?.id && st?.status) statuses.push({ wamid: String(st.id), estado: String(st.status).toLowerCase() })
        }

        for (const msg of value?.messages || []) {
          if (!marcarNuevo(msg.id)) continue // reintento rápido de Meta → ignorar
          const telefono = String(msg.from || '')
          const { tipo, contenido, mediaId, contextoId, referral } = extraer(msg)
          nuevos.push({
            wamid: msg.id || '',
            telefono,
            nombre: nombreDe[telefono] || '',
            tipo, contenido, mediaId, contextoId, referral,
            raw: msg, // respaldo: objeto crudo del mensaje tal cual de Meta
            fecha: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          })
        }
      }
    }

    // Meta exige un 200 rápido: lo damos YA y hacemos hoja+IA en segundo plano.
    if (nuevos.length) waitUntil(procesar(nuevos, origin))
    if (statuses.length) waitUntil(procesarStatuses(statuses))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/webhook]', err)
    return NextResponse.json({ ok: false, error: err.message })
  }
}
