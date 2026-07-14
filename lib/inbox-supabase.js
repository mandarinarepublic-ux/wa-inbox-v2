// lib/inbox-supabase.js — Implementaciones Supabase de la capa de datos del inbox.
// Mismo SHAPE de retorno que lib/mensajes.js / lib/contactos.js / lib/respuestas.js,
// para que las rutas no cambien. Modelo normalizado: conversaciones (=CONTACTOS) +
// mensajes (=MENSAJES) + respuestas_rapidas. Cuenta fija = CUENTA ('MANDI').
import { getSupabase, CUENTA, soloDigitos, canonTel } from './supabase.js'

// ─── Conversación (contacto) ─────────────────────────────────────────────────

/** Devuelve el conversacion_id para (CUENTA, telefono), creándolo si no existe. */
async function getConvId(telefono, nombre = '', waId = '') {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  // upsert por (cuenta, telefono canónico): no pisa estado/alias/nombre editados.
  const { data, error } = await sb
    .from('conversaciones')
    .upsert({ cuenta: CUENTA, telefono: tel }, { onConflict: 'cuenta,telefono' })
    .select('conversacion_id')
    .single()
  if (error) throw error
  return data.conversacion_id
}

/** Fila conversaciones → shape de mapContactRow. */
function toContacto(c) {
  return {
    telefono: String(c.telefono || ''),
    nombre:   c.nombre_contacto || '',
    alias:    c.alias || '',
    estado:   String(c.estado || 'PENDIENTE').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente',
    waId:     c.wa_id || '',
    modoIA:   String(c.modo_ia || 'IA').toUpperCase() !== 'HUMANO',
    idVenta:  String(c.id_venta || '').trim(),
    notas:    c.notas || '',
  }
}

export async function getContactosSupabase() {
  const sb = getSupabase()
  const { data, error } = await sb.from('conversaciones').select('*').eq('cuenta', CUENTA)
  if (error) throw error
  return (data || []).map(toContacto)
}

/** Upsert del contacto que acaba de escribir (webhook). No pisa nombre/waId no vacíos. */
export async function registrarContactoEntranteSupabase(telefono, nombre, waId) {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const { data: exist } = await sb
    .from('conversaciones').select('conversacion_id, nombre_contacto, wa_id')
    .eq('cuenta', CUENTA).eq('telefono', tel).maybeSingle()

  if (!exist) {
    const { error } = await sb.from('conversaciones').insert({
      cuenta: CUENTA, telefono: tel, nombre_contacto: nombre || '', wa_id: waId || '',
      estado: 'PENDIENTE', modo_ia: 'IA',
    })
    if (error && !/duplicate key/i.test(error.message)) throw error
    return { ok: true, creado: true }
  }
  const patch = {}
  if (nombre && !String(exist.nombre_contacto || '').trim()) patch.nombre_contacto = nombre
  if (waId && !String(exist.wa_id || '').trim()) patch.wa_id = waId
  if (Object.keys(patch).length) {
    await sb.from('conversaciones').update(patch).eq('conversacion_id', exist.conversacion_id)
  }
  return { ok: true, creado: false }
}

/** Setea un campo de la conversación por teléfono (crea la conversación si falta). */
async function setCampoContacto(telefono, campo, valor) {
  const sb = getSupabase()
  const tel = String(telefono)
  const convId = await getConvId(tel)
  const { error } = await sb.from('conversaciones').update({ [campo]: valor }).eq('conversacion_id', convId)
  if (error) throw error
  return { ok: true }
}

export const updateEstadoSupabase   = (tel, estado) => setCampoContacto(tel, 'estado', String(estado).toUpperCase())
export const updateModoIASupabase   = (tel, modo)   => setCampoContacto(tel, 'modo_ia', modo)
export const updateNotasSupabase    = (tel, notas)  => setCampoContacto(tel, 'notas', notas)
export const updateAliasSupabase    = (tel, alias)  => setCampoContacto(tel, 'alias', alias)
export const updateIdVentaSupabase  = (tel, idV)    => setCampoContacto(tel, 'id_venta', idV)

/** Lookup rápido de modo IA (para el webhook), por últimos 9 dígitos. */
export async function getModoIASupabase(telefono) {
  const contactos = await getContactosSupabase()
  const t9 = soloDigitos(telefono).slice(-9)
  const c = contactos.find((x) => soloDigitos(x.telefono).slice(-9) === t9)
  return c ? c.modoIA : true // nuevo → IA
}

// ─── Mensajes ────────────────────────────────────────────────────────────────

/** Fila mensajes → shape de mapMensajeRow. */
function toMensaje(m) {
  return {
    id:             m.wa_message_id || '',
    telefono:       String(m.telefono || ''),
    nombre:         m.nombre || String(m.telefono || '') || 'Sin nombre',
    tipo:           m.tipo || 'texto',
    mensaje:        m.texto || '',
    mediaUrl:       m.media_url || '',
    timestamp:      m.fecha || '',
    direccion:      m.direccion || 'ENTRANTE',
    mediaId:        m.media_id || '',
    respuestaIA:    m.respuesta_ia || '',
    imagenProducto: m.foto_ia || '',
    contextoId:     m.contexto_id || '',
    botones:        m.botones || '',   // botones interactivos que enviamos (JSON)
  }
}

/** Últimos N mensajes (equivale a getMensajes de la hoja, ya filtrado). */
export async function getMensajesSupabase(limite = 3000) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('mensajes').select('*').eq('cuenta', CUENTA)
    .order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || [])
    .reverse() // cronológico asc, como el tail de Sheets
    .map(toMensaje)
    .filter((m) => soloDigitos(m.telefono).length >= 9)
    .filter((m) => String(m.tipo).toLowerCase() !== 'system' && (String(m.mensaje).trim() || String(m.mediaUrl).trim()))
}

/** Un mensaje por wamid (para citas). */
export async function getMensajeByIdSupabase(id) {
  const sb = getSupabase()
  const { data } = await sb.from('mensajes').select('*').eq('wa_message_id', id).maybeSingle()
  return data ? toMensaje(data) : null
}

/**
 * Guarda un mensaje (entrante o saliente). Idempotente por wamid (ON CONFLICT).
 * Asegura la conversación y actualiza ultimo_mensaje_at.
 * @param m { id(wamid), telefono, nombre, tipo, mensaje, mediaUrl, timestamp,
 *           direccion('ENTRANTE'|'SALIENTE'), mediaId, respuestaIA, imagenProducto, contextoId, botones }
 */
export async function guardarMensajeSupabase(m) {
  const sb = getSupabase()
  const tel = String(m.telefono || '')
  const convId = await getConvId(tel, m.nombre, tel)
  const fila = {
    conversacion_id: convId,
    cuenta: CUENTA,
    telefono: tel,
    nombre: m.nombre || '',
    direccion: m.direccion || 'ENTRANTE',
    tipo: m.tipo || 'texto',
    texto: m.mensaje || '',
    media_url: m.mediaUrl || null,
    media_id: m.mediaId || null,
    respuesta_ia: m.respuestaIA || null,
    foto_ia: m.imagenProducto || null,
    contexto_id: m.contextoId || null,
    botones: m.botones || null,   // requiere columna `botones` (text/jsonb) en inbox.mensajes
    wa_message_id: m.id || null,
    fecha: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
  }
  // Idempotente: si el wamid ya existe, no duplica.
  const q = m.id
    ? sb.from('mensajes').upsert(fila, { onConflict: 'wa_message_id', ignoreDuplicates: true })
    : sb.from('mensajes').insert(fila)
  const { error } = await q
  if (error && !/duplicate key/i.test(error.message)) throw error
  // Refrescar ultimo_mensaje_at + nombre si estaba vacío.
  await sb.from('conversaciones').update({ ultimo_mensaje_at: fila.fecha }).eq('conversacion_id', convId)
  return { ok: true }
}

/** ¿Ya existe un mensaje con ese wamid? (dedup del webhook). */
export async function existeWamidSupabase(wamid) {
  if (!wamid) return false
  const sb = getSupabase()
  const { data } = await sb.from('mensajes').select('mensaje_id').eq('wa_message_id', wamid).maybeSingle()
  return Boolean(data)
}

/** Historial [{role,content}] para el bot IA (equivale a /api/conversacion). */
export async function getConversacionSupabase(telefono, limite = 40) {
  const sb = getSupabase()
  const t9 = soloDigitos(telefono).slice(-9)
  const { data, error } = await sb
    .from('mensajes').select('telefono, direccion, texto, fecha').eq('cuenta', CUENTA)
    .order('fecha', { ascending: true })
  if (error) throw error
  const delTel = (data || []).filter((m) => soloDigitos(m.telefono).slice(-9) === t9 && String(m.texto || '').trim())
  const turnos = []
  for (const m of delTel) {
    const role = String(m.direccion).toUpperCase() === 'SALIENTE' ? 'assistant' : 'user'
    if (turnos.length && turnos[turnos.length - 1].role === role) {
      turnos[turnos.length - 1].content += '\n' + m.texto
    } else {
      turnos.push({ role, content: m.texto })
    }
  }
  const recorte = turnos.slice(-limite)
  if (recorte.length && recorte[recorte.length - 1].role === 'user') recorte.pop() // el último user es el actual
  return recorte
}

// ─── Respuestas rápidas ──────────────────────────────────────────────────────

function toRespuesta(r) {
  const imgs = Array.isArray(r.imagenes) ? r.imagenes : []
  const obj = { id: r.id, text: r.texto || '', imageUrl: imgs[0] || '' }
  for (let k = 2; k <= 10; k++) obj[`imageUrl${k}`] = imgs[k - 1] || ''
  obj.botones = (Array.isArray(r.botones) ? r.botones : []).slice(0, 3)
  return obj
}

export async function getRespuestasSupabase() {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('respuestas_rapidas').select('*').eq('cuenta', CUENTA).eq('activo', true)
  if (error) throw error
  return (data || []).filter((r) => String(r.texto || '').trim()).map(toRespuesta)
}

function imgsFromExtras(imagenUrl, extras = {}) {
  const imgs = [imagenUrl || '']
  for (let k = 2; k <= 10; k++) imgs.push(extras[`imagenUrl${k}`] || '')
  return imgs.map((s) => String(s || '')).filter((s, i) => i === 0 || s) // conserva pos1 aunque vacía
}
function botonesFrom(extras = {}) {
  const b = Array.isArray(extras.botones) ? extras.botones : (extras.botones ? String(extras.botones).split('|') : [])
  return b.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
}

export async function addRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  const sb = getSupabase()
  const { error } = await sb.from('respuestas_rapidas').upsert({
    cuenta: CUENTA, id, texto, imagenes: imgsFromExtras(imagenUrl, extras), botones: botonesFrom(extras), activo: true,
  }, { onConflict: 'cuenta,id' })
  if (error) throw error
  return { ok: true }
}
export async function editRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  return addRespuestaSupabase(id, texto, imagenUrl, extras) // upsert
}
export async function deleteRespuestaSupabase(id) {
  const sb = getSupabase()
  const { error } = await sb.from('respuestas_rapidas').delete().eq('cuenta', CUENTA).eq('id', id)
  if (error) throw error
  return { ok: true }
}
