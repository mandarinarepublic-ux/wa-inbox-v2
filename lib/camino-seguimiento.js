// lib/camino-seguimiento.js — ¿Qué hace el cron con este chat?
//
// Antes el cron decidía con `seg.solo_ia_apagada && c.modoIA === true`, que mira el
// interruptor por CHAT y no el cortafuegos por NÚMERO. Con el número apagado pero el
// chat marcado en IA, se saltaba el chat creyendo que "lo maneja el bot" — y el bot
// estaba detenido. Ese lead se quedaba sin nadie.
//
// `solo_ia_apagada` pasa a ser el interruptor de la funcionalidad nueva:
//   true  (como está hoy) → los chats con el bot activo se SALTAN, igual que antes.
//   false                 → esos chats DESPIERTAN al bot.
import { decidirIA } from './ia-canal.js'

/**
 * @returns {'despertar'|'texto'|'saltar'}
 *   'despertar' → llamar al agente para que retome él la conversación
 *   'texto'     → mandar el texto automático de la regla
 *   'saltar'    → no hacer nada con este chat
 */
export function caminoDeSeguimiento({ config, contacto }) {
  const botActivo = decidirIA({
    config,
    phoneId: contacto?.phoneId,
    contacto,
  })
  if (!botActivo) return 'texto'
  // El bot va a contestar: o lo despertamos, o lo dejamos en paz.
  return config?.seguimientos?.solo_ia_apagada === false ? 'despertar' : 'saltar'
}
