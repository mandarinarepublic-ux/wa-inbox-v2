// lib/transcripcion.js — 📝 Guarda el texto de una nota de voz (6-nov-2026).
//
// El audio NO pasa por acá ni sale a ningún servicio: Whisper corre en el navegador
// (public/transcribir/worker.js) y a este servidor solo llega el texto ya listo.
import { getSupabase, CUENTA } from './supabase.js'

export const TRANSCRIPCION_MAX = 20000

/** Texto limpio y con tope; '' si no hay nada que guardar. */
export function normalizarTranscripcion(texto) {
  if (typeof texto !== 'string') return ''
  // Whisper marca los cambios de voz con ">>" o un guion inicial: aquí solo estorban.
  return texto.replace(/>>/g, ' ').replace(/^\s*-\s*/, '').replace(/ {2,}/g, ' ').trim().slice(0, TRANSCRIPCION_MAX)
}

/**
 * Guarda la transcripción de un mensaje de la cuenta. Gana la primera: si otra
 * persona ya transcribió esa nota, no se pisa y se devuelve la que ya estaba.
 * Solo escribe esta columna: nunca toca teléfono, fecha ni bandeja del mensaje.
 */
export async function guardarTranscripcion(id, texto) {
  const limpio = normalizarTranscripcion(texto)
  if (!id || !limpio) throw new Error('Falta el mensaje o el texto')
  const sb = getSupabase()
  const { data, error } = await sb.from('mensajes')
    .update({ transcripcion: limpio })
    .eq('cuenta', CUENTA).eq('wa_message_id', id).is('transcripcion', null)
    .select('transcripcion')
  if (error) throw new Error(error.message)
  if (data?.length) return data[0].transcripcion

  const { data: ya, error: errLectura } = await sb.from('mensajes')
    .select('transcripcion').eq('cuenta', CUENTA).eq('wa_message_id', id).limit(1)
  if (errLectura) throw new Error(errLectura.message)
  if (!ya?.length) throw new Error('No encontré ese mensaje')
  return ya[0].transcripcion
}
