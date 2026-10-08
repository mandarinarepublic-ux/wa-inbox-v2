// lib/reacciones.js — reaccionar con un emoji a un mensaje del cliente, como en
// WhatsApp (❤️ debajo de su burbuja). Módulo PURO: decide, no manda nada.
//
// Cómo viaja: /api/saliente con `TipoMensaje: 'reaction'` → Meta recibe
// { type: 'reaction', reaction: { message_id, emoji } }. Un emoji VACÍO quita la
// reacción. Meta lo cuenta como un mensaje más: necesita la ventana abierta
// (24 h o la de pauta) y el mensaje no puede tener más de 30 días.
//
// Cómo se guarda: una fila SALIENTE con tipo 'reaction', el emoji en el texto y
// el wamid del mensaje reaccionado en `contexto_id` — la MISMA forma en que ya
// se guardan las reacciones que nos manda el cliente (lib/wa-mensaje.js).
//
// Cómo se ve: esas filas NO se pintan como burbuja propia; el emoji se pega
// debajo del mensaje al que reaccionan. Solo si ese mensaje no está cargado en
// pantalla la fila se pinta como siempre: esconderla sin su destino sería perder
// algo que sí pasó (la regla de `esPintable`: "sin texto" ≠ "no pasó nada").

export const EMOJIS_REACCION = ['❤️', '👍', '😂', '😮', '😢', '🙏']

const MAX_EDAD_MS = 30 * 24 * 60 * 60 * 1000

const esSaliente = (m) => String(m?.direccion || '').toUpperCase() === 'SALIENTE'
const esReaccion = (m) => String(m?.tipo || '').toLowerCase() === 'reaction'

/** Una reacción NUESTRA (fila saliente de tipo reaction con destino). */
export function esReaccionNuestra(m) {
  return esSaliente(m) && esReaccion(m) && Boolean(m?.contextoId)
}

/**
 * wamid del mensaje → emoji que le pusimos ('' si la quitamos). Gana la ÚLTIMA
 * por fecha, igual que en WhatsApp: cambiar de ❤️ a 👍 deja solo el 👍.
 */
export function reaccionesNuestras(msgs) {
  const filas = (Array.isArray(msgs) ? msgs : []).filter(esReaccionNuestra)
  filas.sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0))
  const mapa = new Map()
  for (const f of filas) {
    // Quitar la reacción se guarda con texto vacío, y al LEER una fila vacía se
    // pinta con la etiqueta "Reaccionó a un mensaje" (lib/wa-mensaje.js, para que
    // nunca quede vacía). Un emoji no tiene letras: si hay letras, es la etiqueta.
    const e = String(f.mensaje || '')
    mapa.set(String(f.contextoId), /\p{L}/u.test(e) ? '' : e)
  }
  return mapa
}

/**
 * ¿Se pinta esta fila como burbuja? Una reacción nuestra NO, si su mensaje
 * destino está en pantalla (ahí se ve pegada). Todo lo demás, sí.
 */
export function seMuestraComoBurbuja(m, idsEnPantalla) {
  if (!esReaccionNuestra(m)) return true
  return !(idsEnPantalla && idsEnPantalla.has(String(m.contextoId)))
}

/**
 * ¿Se le puede reaccionar a este mensaje? Solo a los del CLIENTE, con un wamid
 * real de Meta (no burbujas optimistas ni ids inventados), que no sean ellos
 * mismos una reacción y con menos de 30 días.
 */
export function puedeReaccionar(m, ahoraMs = Date.now()) {
  if (!m || esSaliente(m) || esReaccion(m)) return false
  if (!String(m.id || '').startsWith('wamid.')) return false
  const t = Date.parse(m.timestamp)
  if (!Number.isFinite(t)) return false
  return ahoraMs - t < MAX_EDAD_MS
}

/** Tocar el mismo emoji que ya está puesto lo QUITA (''); otro lo reemplaza. */
export function siguienteReaccion(actual, elegido) {
  return String(actual || '') === String(elegido || '') ? '' : String(elegido || '')
}
