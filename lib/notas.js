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

// Los únicos `tipo` que puede llevar una nota: deciden el color en el panel
// (pago_ok = verde, pago_error = rojo). `null` es el neutral de siempre.
const TIPOS_VALIDOS = new Set(['pago_ok', 'pago_error'])

/**
 * Filtra el `tipo` que llega por POST /api/notas: esa ruta la llama el
 * navegador, y `tipo` maneja el color de la nota, así que cualquier valor que
 * no sea uno de los dos conocidos se cae a null (neutral) en vez de colarse.
 */
export function tipoNotaValido(tipo) {
  return TIPOS_VALIDOS.has(tipo) ? tipo : null
}

/** Las notas del chat, la más nueva primero. */
export async function listarNotas(telefono) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('notas')
    .select('id, texto, tipo, creado_at')
    .eq('cuenta', CUENTA)
    .eq('telefono', canonTel(telefono))
    .order('creado_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Agrega una nota. Devuelve la fila creada para pintarla sin recargar.
 * `tipo` es opcional y por defecto null (nota neutral, como siempre) — todos
 * los llamadores existentes que pasan solo (telefono, texto) siguen andando
 * igual.
 */
export async function crearNota(telefono, texto, tipo = null) {
  const limpio = String(texto || '').trim()
  if (!limpio) throw new Error('La nota está vacía')

  const sb = getSupabase()
  const { data, error } = await sb
    .from('notas')
    .insert({ cuenta: CUENTA, telefono: canonTel(telefono), texto: limpio, tipo })
    .select('id, texto, tipo, creado_at')
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
    .select('id, texto, tipo, creado_at')
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
