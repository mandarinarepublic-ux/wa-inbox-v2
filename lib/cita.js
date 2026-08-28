// lib/cita.js — a cuál de los mensajes que salen le toca llevar la cita.
//
// Responder CITANDO ya funcionaba para el texto que se escribe a mano. Lo que no
// pasaba la cita eran las RESPUESTAS RÁPIDAS: el vendedor tocaba la burbuja del
// cliente para responderle a esa pregunta, elegía una respuesta rápida, y salía
// suelta. La cita se perdía sin aviso.
//
// El problema no es solo "pasarla": una respuesta rápida puede ser un texto y
// cinco fotos y un audio, y WhatsApp entrega cada pieza como un mensaje aparte.
// Si la cita fuera en todas, el cliente vería su misma pregunta citada siete
// veces.
//
// ⚠️ Y no puede atarse "al texto": hay respuestas rápidas que son SOLO fotos. Si
// la cita viviera en el texto, usar una de esas la perdería en silencio — la
// misma familia de bugs que este inbox lleva meses peleando. Por eso se la lleva
// la primera pieza que efectivamente PIDE salir, sea cual sea.

/**
 * Devuelve una función que entrega la cita UNA sola vez.
 *
 * Se llama una vez por cada pieza que va a salir, en orden. La primera recibe el
 * wamid citado; las demás reciben '' y salen sueltas, debajo de la citada.
 *
 * El estado es por envío, no global: dos respuestas rápidas seguidas no pueden
 * compartirlo, o la segunda saldría sin citar.
 *
 * @param citaId wamid del mensaje del cliente que se está citando ('' = ninguno)
 */
export function citaUnaVez(citaId) {
  const id = String(citaId || '')
  let usada = false
  return () => {
    if (usada || !id) return ''
    usada = true
    return id
  }
}
