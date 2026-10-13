// lib/etiquetas.js — 🏷️ Etiquetas de chats (diseño 13-oct-2026, docs/sql/2026-10-13-etiquetas.sql).
//
// La Cloud API NO tiene etiquetas (solo existen en la app WhatsApp Business y la
// API no las lee ni las escribe), así que viven en `inbox.etiquetas` +
// `inbox.conversacion_etiquetas`. Son POR PERSONA (cuenta + teléfono), igual que
// la temperatura: una clienta que escribe a MANDI y a REPUBLIC tiene UNA lista.
//
// La regla "Pauta" la pone un trigger de la base (entrante con referral), no este
// archivo: así no frena el webhook y cubre la reentrega de Meta.
import { getSupabase, CUENTA, canonTel } from './supabase.js'

const COLOR_OK = /^#[0-9a-fA-F]{6}$/
const NOMBRE_MAX = 30

/** Valida nombre y color de una etiqueta. Devuelve el texto del error o ''. */
export function errorEtiqueta({ nombre, color } = {}) {
  const n = String(nombre ?? '').trim()
  if (!n) return 'La etiqueta necesita un nombre'
  if (n.length > NOMBRE_MAX) return `Máximo ${NOMBRE_MAX} letras`
  if (color != null && !COLOR_OK.test(String(color))) return 'Color inválido'
  return ''
}

function toEtiqueta(e) {
  return {
    id: Number(e.etiqueta_id),
    nombre: e.nombre,
    color: e.color,
    activa: e.activa !== false,
    clave: e.clave || '',   // 'pauta' | 'productos' → la pone una regla automática
  }
}

/** Todas las etiquetas de la cuenta, también las desactivadas (la pantalla de administrar las muestra). */
export async function listarEtiquetas() {
  const { data, error } = await getSupabase()
    .from('etiquetas')
    .select('etiqueta_id, nombre, color, activa, clave')
    .eq('cuenta', CUENTA)
    .order('etiqueta_id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(toEtiqueta)
}

const nombreRepetido = (error) => error?.code === '23505' ? 'Ya existe una etiqueta con ese nombre' : error?.message

export async function crearEtiqueta({ nombre, color = '#25d366' }) {
  const malo = errorEtiqueta({ nombre, color })
  if (malo) throw new Error(malo)
  const { data, error } = await getSupabase()
    .from('etiquetas')
    .insert({ cuenta: CUENTA, nombre: String(nombre).trim(), color })
    .select('etiqueta_id, nombre, color, activa, clave')
    .single()
  if (error) throw new Error(nombreRepetido(error))
  return toEtiqueta(data)
}

/** Renombrar, cambiar color, activar o desactivar. Desactivar la esconde de todos los chats sin borrar el historial. */
export async function editarEtiqueta(id, { nombre, color, activa } = {}) {
  const cambios = {}
  if (nombre !== undefined) cambios.nombre = String(nombre).trim()
  if (color !== undefined) cambios.color = color
  if (activa !== undefined) cambios.activa = activa === true
  const malo = errorEtiqueta({ nombre: cambios.nombre ?? 'x', color: cambios.color })
  if (malo) throw new Error(malo)
  if (!Object.keys(cambios).length) throw new Error('Nada que cambiar')
  const { data, error } = await getSupabase()
    .from('etiquetas')
    .update(cambios)
    .eq('cuenta', CUENTA)          // nunca tocar una de IND
    .eq('etiqueta_id', Number(id))
    .select('etiqueta_id, nombre, color, activa, clave')
    .maybeSingle()
  if (error) throw new Error(nombreRepetido(error))
  if (!data) throw new Error('Etiqueta no encontrada')
  return toEtiqueta(data)
}

async function convIdDe(telefono) {
  const { data, error } = await getSupabase()
    .from('conversaciones')
    .select('conversacion_id')
    .eq('cuenta', CUENTA)
    .eq('telefono', canonTel(telefono) || String(telefono))
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Chat no encontrado')
  return data.conversacion_id
}

async function etiquetaDeLaCuenta(id) {
  const { data, error } = await getSupabase()
    .from('etiquetas').select('etiqueta_id')
    .eq('cuenta', CUENTA).eq('etiqueta_id', Number(id)).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Etiqueta no encontrada')
}

/** Pone una etiqueta en el chat. Idempotente: si ya la tenía, no hace nada. */
export async function ponerEtiqueta(telefono, etiquetaId, puestaPor = 'inbox') {
  await etiquetaDeLaCuenta(etiquetaId)
  const conversacion_id = await convIdDe(telefono)
  const { error } = await getSupabase()
    .from('conversacion_etiquetas')
    .upsert({ conversacion_id, etiqueta_id: Number(etiquetaId), puesta_por: String(puestaPor || 'inbox') },
            { onConflict: 'conversacion_id,etiqueta_id', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function quitarEtiqueta(telefono, etiquetaId) {
  await etiquetaDeLaCuenta(etiquetaId)
  const conversacion_id = await convIdDe(telefono)
  const { error } = await getSupabase()
    .from('conversacion_etiquetas')
    .delete()
    .eq('conversacion_id', conversacion_id)
    .eq('etiqueta_id', Number(etiquetaId))
  if (error) throw new Error(error.message)
  return { ok: true }
}

/**
 * Pone la etiqueta automática de `clave` ('productos', …) si la cuenta la tiene
 * activa. NUNCA lanza: la llama un envío que ya salió, y una etiqueta que falla
 * no puede convertir ese envío en error.
 */
export async function ponerEtiquetaAuto(telefono, clave) {
  try {
    const { data } = await getSupabase()
      .from('etiquetas').select('etiqueta_id')
      .eq('cuenta', CUENTA).eq('clave', clave).eq('activa', true).maybeSingle()
    if (!data) return { ok: false }
    return await ponerEtiqueta(telefono, data.etiqueta_id, 'auto')
  } catch (e) {
    console.error('[etiquetas] auto', clave, e.message)
    return { ok: false }
  }
}

/**
 * { telefono: [etiqueta_id, …] } de los chats que tienen alguna etiqueta ACTIVA.
 * Viaja en /api/inbox-sync. Solo trae chats etiquetados (no uno por contacto), y
 * pagina igual: PostgREST corta en 1000 filas sin avisar.
 */
export async function mapaEtiquetasChats() {
  const sb = getSupabase()
  const mapa = {}
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('etiquetas_por_telefono')
      .select('telefono, etiquetas')
      .eq('cuenta', CUENTA)
      .order('telefono', { ascending: true })   // orden TOTAL: un teléfono por fila
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const f of data || []) mapa[f.telefono] = (f.etiquetas || []).map(Number)
    if (!data || data.length < 1000) break
  }
  return mapa
}
