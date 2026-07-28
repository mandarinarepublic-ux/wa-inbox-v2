// lib/social-ventana.js — la ventana de 24 h de Meta. Puro, sin red.
//
// Se cuenta desde el ÚLTIMO MENSAJE DEL CLIENTE. Mientras esté abierta se mandan
// los mensajes que haga falta, seguidos, sin esperar respuesta. Cuando se cierra,
// en Facebook e Instagram no hay plantillas para reabrirla: la conversación
// terminó.

const VENTANA_MS = 24 * 60 * 60 * 1000

/**
 * @param {string} ultimoEntranteISO fecha del último mensaje del cliente
 * @param {number} ahoraMs           Date.now(), inyectable para poder probarlo
 */
export function estadoVentana(ultimoEntranteISO, ahoraMs = Date.now()) {
  const cerrada = { abierta: false, horasRestantes: 0, etiqueta: '🔒 Cerrada' }
  if (!ultimoEntranteISO) return cerrada
  const t = new Date(ultimoEntranteISO).getTime()
  if (!Number.isFinite(t)) return cerrada
  const restanteMs = t + VENTANA_MS - ahoraMs
  if (restanteMs <= 0) return cerrada
  const horasRestantes = Math.floor(restanteMs / 3_600_000)
  return {
    abierta: true,
    horasRestantes,
    etiqueta: `⏳ ${horasRestantes} h para responder`,
  }
}
