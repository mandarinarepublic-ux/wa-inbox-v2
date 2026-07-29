// lib/ia-canal.js — ¿Puede MANDI AGENT responder este mensaje?
//
// Dos rejas en serie, y el orden importa:
//   1. CORTAFUEGOS por número (config.ia.MANDI / .REPUBLIC) — apaga el bot entero
//      en ese canal, sin tocar el estado de ningún chat.
//   2. El interruptor por chat de siempre (conversaciones.modo_ia).
//
// Apagado global GANA: si el canal está apagado da igual que el chat esté en modo
// IA. Al volver a prenderlo, cada chat vuelve a como estaba: el cortafuegos tapa,
// no borra.
//
// Módulo PURO a propósito (sin red ni base): la decisión de si un bot le escribe a
// un cliente tiene que poder probarse.
import { canalDePhoneId } from './canales.js'

/**
 * ¿Está MANDI AGENT habilitado en el número por el que entró este mensaje?
 * Un canal DESCONOCIDO no bloquea: fallar cerrado dejaría el bot mudo en silencio
 * si el phone_id cambia (le pasó al 3326 de IND), y un bot mudo no se nota hasta
 * que se pierden ventas. Uno que gasta de más se ve en la factura.
 */
export function iaActivaEnCanal(config, phoneId) {
  const canal = canalDePhoneId(phoneId)
  if (!canal) return true
  return config?.ia?.[canal] !== false
}

/**
 * Decisión final para un mensaje concreto.
 * @param {{ config:object, phoneId:string, contacto?:{modoIA?:boolean} }} args
 *        `contacto` = la fila de la agenda ya encontrada, o undefined si no está.
 */
export function decidirIA({ config, phoneId, contacto }) {
  if (!iaActivaEnCanal(config, phoneId)) return false
  if (!contacto) return false // contacto nuevo → IA APAGADA (la prende un humano)
  return contacto.modoIA !== false
}
