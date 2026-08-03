// lib/notas.js — Las notas internas de una conversación.
//
// Antes había UNA sola nota por chat: la columna `inbox.conversaciones.notas`.
// Guardar la pisaba entera, así que agregar algo significaba abrir lo anterior,
// bajar al final y escribir ahí. Con dos personas atendiendo, la última en
// guardar borraba lo de la otra sin enterarse — y nunca se supo cuándo se había
// escrito cada cosa.
//
// Ahora cada nota es una fila de `inbox.notas` con su fecha. NO se guarda quién
// la escribió: el inbox no tiene login y no hay de dónde sacarlo (decisión del
// 2-ago-2026, si algún día hay login se agrega la columna y listo).
import { getSupabase, CUENTA, canonTel } from './supabase.js'

/** Las notas del chat, la más nueva primero. */
export async function listarNotas(telefono) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('notas')
    .select('id, texto, creado_at')
    .eq('cuenta', CUENTA)
    .eq('telefono', canonTel(telefono))
    .order('creado_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

/** Agrega una nota. Devuelve la fila creada para pintarla sin recargar. */
export async function crearNota(telefono, texto) {
  const limpio = String(texto || '').trim()
  if (!limpio) throw new Error('La nota está vacía')

  const sb = getSupabase()
  const { data, error } = await sb
    .from('notas')
    .insert({ cuenta: CUENTA, telefono: canonTel(telefono), texto: limpio })
    .select('id, texto, creado_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}

/** Cambia el texto de una nota. NO toca `creado_at`: la fecha es cuándo se escribió. */
export async function editarNota(id, texto) {
  const limpio = String(texto || '').trim()
  if (!limpio) throw new Error('La nota está vacía')

  const sb = getSupabase()
  const { data, error } = await sb
    .from('notas')
    .update({ texto: limpio })
    .eq('id', id)
    .eq('cuenta', CUENTA)   // que un id de otra cuenta no alcance para editar
    .select('id, texto, creado_at')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function borrarNota(id) {
  const sb = getSupabase()
  const { error } = await sb.from('notas').delete().eq('id', id).eq('cuenta', CUENTA)
  if (error) throw new Error(error.message)
  return { ok: true }
}
