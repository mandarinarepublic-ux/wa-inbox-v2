import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { registrarContactoEntrante, getContactos, updateEstado, updateModoIA, marcarPush } from '@/lib/contactos'
import { usaSupabaseLectura } from '@/lib/supabase'
import { guardarMensajeSupabase, existeWamidSupabase, guardarEventoCrudoSupabase, actualizarEstadoEntregaSupabase, asegurarConversacionSalienteSupabase } from '@/lib/inbox-supabase'
import { archivarMedia } from '@/lib/media-archive'
import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { enviarPush, cuerpoDeMensaje, debeNotificar } from '@/lib/push'
import { decidirIA } from '@/lib/ia-canal'
import { extraer } from '@/lib/wa-mensaje'
import { extraerEchoes } from '@/lib/echoes'
import { enviarSaliente, responderConIA } from '@/lib/responder-ia'
import { capturarCtwaClid, revisarLeadAutomatico } from '@/lib/capi'

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

// Tipos de medio (según lo devuelve extraer() en lib/wa-mensaje.js) que hay que
// archivar a Supabase Storage: el media_id que da Meta es temporal (~30 dias) y sin
// esto el medio queda colgado del id de Meta y deja de reproducirse. Agregar un tipo
// nuevo aqui alcanza para que empiece a archivarse.
const TIPOS_MEDIA_ARCHIVABLES = ['imagen', 'sticker', 'audio', 'video', 'documento']

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

// Mensaje de espera cuando el cliente manda algo que MANDI no procesa (una foto).
const MSG_ESPERA = 'Permíteme un momento por favor 🧡'

// Handoff invisible: el cliente mandó una imagen → MANDI no vende ni identifica.
// Marcamos el contacto SOPORTE + HUMANO (la IA se apaga y un ejecutivo lo toma)
// y respondemos SOLO con el mensaje de espera, en la voz de MANDI.
async function escalarASoporte(origin, phone, name, canal) {
  await Promise.all([
    updateEstado(phone, 'SOPORTE').catch(e => console.error('[webhook IA] estado SOPORTE:', e.message)),
    updateModoIA(phone, 'HUMANO').catch(e => console.error('[webhook IA] modoIA HUMANO:', e.message)),
  ])
  await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: MSG_ESPERA, Canal: canal })
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

  // `null` = TODOS los números. El webhook NO es una bandeja: atiende lo que entre
  // por cualquier canal, así que su agenda tiene que ser completa.
  //
  // Con el default (solo el número principal) un contacto del OTRO número no
  // aparecía nunca en esta lista, y de ahí salían tres mentiras seguidas:
  // esNuevoDe() daba siempre true → lo saludaba como nuevo EN CADA MENSAJE;
  // estadoDe() nunca veía 'atendido' → no lo reabría a PENDIENTE; y modoIAde()
  // y ultimoEntranteAtDe() lo trataban como si no tuviera historia.
  const contactos = await getContactos(null).catch(() => [])
  // Config de automatizaciones (saludos). Un fetch por ciclo. Si falla → sin saludos.
  const auto = await getAutomatizaciones().catch(() => null)
  // El CORTAFUEGOS por número se aplica ACA y no en cada sitio que llama al
  // agente: una sola fuente. Es la leccion de los 4 bugs del 27-29 jul, donde
  // habia cuatro caminos hacia /api/saliente y solo uno inyectaba el canal.
  const modoIAde = (phone, phoneId) => {
    const t = tail9(phone)
    const contacto = contactos.find(c => tail9(c.telefono) === t)
    return decidirIA({ config: auto, phoneId, contacto })
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

  // Último aviso push enviado por conversación (del snapshot de este ciclo).
  const ultimoPushAtDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c?.ultimoPushAt || null
  }
  // Anti doble-aviso dentro del mismo lote: el snapshot no se entera de lo que
  // acabamos de mandar hace dos mensajes.
  const avisados = new Set()

  // Aviso de mensaje nuevo al equipo (web push). Nunca lanza: un fallo acá no puede
  // tocar el webhook. Sin claves VAPID, enviarPush es un no-op silencioso.
  async function avisarSiCorresponde(m) {
    const t = tail9(m.telefono)
    if (avisados.has(t)) return
    if (!debeNotificar(ultimoPushAtDe(m.telefono), Date.now())) return
    avisados.add(t)
    const nombre = m.nombre || m.telefono
    await enviarPush({
      titulo: `💬 ${nombre}`,
      cuerpo: cuerpoDeMensaje({ tipo: m.tipo, contenido: m.contenido }),
      url:    `/inbox?tel=${encodeURIComponent(m.telefono)}`,
      tag:    `chat-${t}`,
      tel:    m.telefono,
    })
    await marcarPush(m.telefono)
  }

  // Saludo automático. Solo cuando la IA está APAGADA para el contacto (si está
  // prendida, el propio agente saluda → evitamos doble mensaje). Nuevo → saludo de
  // bienvenida; reactivación tras N horas de silencio → "hola de vuelta".
  async function saludarSiCorresponde(phone, name, canal) {
    if (!auto || modoIAde(phone, canal)) return
    const t = tail9(phone)
    if (saludados.has(t)) return
    const nuevo = esNuevoDe(phone)
    if (nuevo) {
      const s = auto.saludo_nuevo
      if (s?.activo && String(s.texto || '').trim()) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim(), Canal: canal })
      }
      return
    }
    const s = auto.saludo_reactivacion
    if (s?.activo && String(s.texto || '').trim()) {
      const horas  = Number(s.horas) || 12
      const prevMs = ultimoEntranteAtDe(phone)
      if (prevMs && Date.now() - prevMs >= horas * 3600 * 1000) {
        saludados.add(t)
        await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: s.texto.trim(), Canal: canal })
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
      phoneId: m.phoneId,
    }).catch(e => console.error('[/api/webhook] guardar entrante:', e.message))

    // Archivar el medio entrante (foto, sticker, audio, video o documento) a Supabase
    // Storage (URL estable → media_url). Solo en modo supabase, donde la fila ya quedó
    // insertada por guardarMensajeSupabase arriba.
    if (usaSupabaseLectura() && TIPOS_MEDIA_ARCHIVABLES.includes(m.tipo) && m.mediaId) {
      archivos.push(archivarMedia({ mediaId: m.mediaId, wamid: m.wamid }))
    }

    try { await registrarContactoEntrante(m.telefono, m.nombre, m.telefono) }
    catch (e) { console.error('[/api/webhook] contacto:', e.message) }

    // ── Señales a Meta (Conversions API) ─────────────────────────────────────
    // 1) Guardar de qué anuncio vino, si vino de uno. Va DESPUÉS de
    //    registrarContactoEntrante: la conversación tiene que existir para
    //    poder escribirle el clid.
    // 2) Avisarle a Meta cuando el chat ya se ganó el nombre de Lead.
    // Ninguna de las dos lanza nunca (ver lib/capi.js): Meta tiene que recibir
    // su 200 pase lo que pase, o reintenta y nos mete en rate limit (#131056).
    await capturarCtwaClid({ telefono: m.telefono, referral: m.referral, phoneId: m.phoneId })
      .catch(e => console.error('[/api/webhook] ctwa:', e.message))
    await revisarLeadAutomatico(m.telefono)
      .catch(e => console.error('[/api/webhook] lead capi:', e.message))

    // Aviso al equipo. Va DESPUÉS de registrarContactoEntrante para que la
    // conversación exista y se le pueda escribir ultimo_push_at.
    await avisarSiCorresponde(m)
      .catch(e => console.error('[/api/webhook] aviso push:', e.message))

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
    await saludarSiCorresponde(m.telefono, m.nombre, m.phoneId)
      .catch(e => console.error('[/api/webhook] saludo:', e.message))

    // LINKPAGO<monto> entrante → genera link dLocal y lo devuelve al remitente.
    // Funciona SIEMPRE (independiente del modo IA), como el flujo viejo de Make.
    if (m.tipo === 'texto') {
      const monto = parseLinkpago(m.contenido)
      if (monto) {
        try {
          const link = await crearLinkPago(monto, `${m.telefono}-${Date.now()}`)
          await enviarSaliente(origin, { Telefono: m.telefono, Nombre: m.nombre || '', Mensaje: mensajeLinkPago(monto, link), Canal: m.phoneId })
        } catch (e) {
          console.error('[webhook LINKPAGO] falló:', e.message)
        }
        continue // no seguir con la IA para este mensaje
      }
    }

    // Auto-respuesta IA (solo si el contacto tiene la IA prendida):
    if (modoIAde(m.telefono, m.phoneId)) {
      if (m.tipo === 'texto' && String(m.contenido).trim()) {
        // Texto → MANDI responde normalmente.
        await responderConIA(origin, m.telefono, m.nombre, m.contenido, m.phoneId)
      } else if (m.tipo === 'imagen') {
        // Foto del cliente → NO vender/identificar: mensaje de espera + handoff a
        // SOPORTE (apaga la IA para que un ejecutivo tome el chat).
        await escalarASoporte(origin, m.telefono, m.nombre, m.phoneId)
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

// Echoes: lo que se responde DESDE EL CELULAR llega de vuelta por el webhook.
// Carril MÍNIMO a propósito: guardar y archivar el medio. Nada de saludos, IA,
// LINKPAGO, push ni cambios de estado — un echo no es un cliente escribiendo, es
// nuestra propia respuesta. Por eso no pasa por procesar(), que es donde vive
// todo eso: así no hay nada que acordarse de excluir.
async function procesarEchoes(echoes) {
  for (const e of echoes) {
    try {
      if (await existeWamidSupabase(e.wamid).catch(() => false)) continue
      await asegurarConversacionSalienteSupabase(e.telefono)
      await guardarMensajeSupabase({
        id: e.wamid, telefono: e.telefono, nombre: '', tipo: e.tipo,
        mensaje: e.contenido, mediaUrl: '', timestamp: e.fecha,
        direccion: 'SALIENTE', mediaId: e.mediaId, contextoId: e.contextoId,
        raw: e.raw, phoneId: e.phoneId,
      })
      if (e.mediaId) await archivarMedia({ mediaId: e.mediaId, wamid: e.wamid }).catch(() => {})
    } catch (err) {
      console.error('[/api/webhook echo]', e.wamid, err.message)
    }
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
    const echoes = []
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value    = change?.value || {}

        // Lo que se manda desde el CELULAR viene en value.message_echoes, no en
        // value.messages, y con `to`/`from` al revés. Carril aparte: el `continue`
        // garantiza que no toque nada del camino de los entrantes.
        if (change?.field === 'smb_message_echoes') {
          for (const fila of extraerEchoes(value)) {
            if (marcarNuevo(fila.wamid)) echoes.push(fila)
          }
          continue
        }

        // Por cuál de NUESTROS números entró esto. Con un solo número daba igual;
        // con dos (MANDI y REPUBLIC) es lo único que permite separar las bandejas
        // y saber por dónde responder. Meta ya lo manda y se tiraba.
        const phoneId  = value?.metadata?.phone_number_id || ''
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
            tipo, contenido, mediaId, contextoId, referral, phoneId,
            raw: msg, // respaldo: objeto crudo del mensaje tal cual de Meta
            fecha: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          })
        }
      }
    }

    // Meta exige un 200 rápido: lo damos YA y hacemos hoja+IA en segundo plano.
    if (nuevos.length) waitUntil(procesar(nuevos, origin))
    if (statuses.length) waitUntil(procesarStatuses(statuses))
    if (echoes.length && usaSupabaseLectura()) waitUntil(procesarEchoes(echoes))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/webhook]', err)
    return NextResponse.json({ ok: false, error: err.message })
  }
}
