// lib/ia-ahorro.js — Cuándo NO vale la pena llamar al agente de IA (17-nov-2026).
//
// Cada llamada cuesta tokens. Tres reglas, pedidas por Rodrigo ("que se optimice
// según el tipo de consulta"):
//   1. Si una respuesta simple (reglas, gratis) ya contestó → no se llama.
//   2. Mensajes que no piden nada ("gracias", un emoji, un punto) → no se llama.
//   3. RÁFAGAS: el cliente manda 3 mensajes en 20 segundos ("Hola" · "Vi unos busos
//      de Power Rangers" · "¿Los tienen aún?"). Se espera unos segundos y contesta
//      SOLO el último; el agente igual lee la conversación entera, así que ve los tres.
//
// Módulo PURO: lo que decide si el bot le escribe a un cliente tiene que poder probarse.

/** Cuánto se espera por si el cliente sigue escribiendo. */
export const ESPERA_RAFAGA_MS = 8000

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Solo agradecimientos y cierres de cortesía. A propósito NO están "ok", "sí",
// "listo" ni "hola": dentro de una venta son respuestas ("¿te lo separo?" → "ok")
// y un "hola" solo puede ser un cliente nuevo esperando.
const CORTESIA = /^(muchas |mil |ok |okey |listo |vale |perfecto |genial |super )*(gracias|muchas gracias|mil gracias|gracias (amigo|amiga|joven|estimado|mi estimado|bro|totales)|muy amable|que amable|igualmente|bendiciones|dios le pague|buen dia igualmente|saludos)$/

/** ¿Este texto no pide nada? (gracias, emoji suelto, signos sin "?") */
export function esMensajeSinPedido(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo) return true
  // Sin ninguna letra ni número: emojis o signos. Con "?" SÍ pide algo (está esperando).
  if (!/[\p{L}\p{N}]/u.test(crudo)) return !crudo.includes('?')
  const t = quitarTildes(crudo.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return CORTESIA.test(t)
}

/**
 * ¿`mio` es el ÚLTIMO mensaje del cliente? `entrantes` = sus mensajes con fecha
 * igual o posterior ({ id, fecha }). Empate en el mismo segundo → gana el id mayor,
 * para que de dos mensajes simultáneos conteste exactamente uno.
 */
export function esElUltimo(mio, entrantes = []) {
  const tm = Date.parse(mio?.fecha)
  for (const e of entrantes) {
    if (!e || e.id === mio.id) continue
    const te = Date.parse(e.fecha)
    if (te > tm) return false
    if (te === tm && String(e.id) > String(mio.id)) return false
  }
  return true
}
