// lib/ia-motivo.js — ¿Por qué la IA NO va a responder un chat que dice PRENDIDA?
//
// 20-nov-2026: el botón 🤖 del chat solo es UNA de las rejas que decide si MANDI
// AGENT contesta (ver lib/ia-canal.js). Si el NÚMERO tiene la IA apagada en AUTOS,
// el chat podía decir "IA PRENDIDA" y nadie respondía: la pantalla mentía.
//
// Devuelve null cuando no hay nada que avisar. Ante la duda (config sin cargar)
// NO avisa: un aviso falso enseña a ignorar el aviso.
//
// Módulo PURO: se prueba sin red ni base.
import { iaActivaEnCanal } from './ia-canal.js'

/**
 * @param {{ iaChat:boolean, config?:object|null, phoneId?:string, etiquetaCanal?:string }} a
 * @returns {null | { corto:string, largo:string }}
 */
export function motivoIASinResponder({ iaChat, config, phoneId, etiquetaCanal = '' } = {}) {
  if (!iaChat) return null                       // APAGADA ya se explica sola
  if (config && phoneId && !iaActivaEnCanal(config, phoneId)) {
    const n = etiquetaCanal ? ` ${etiquetaCanal}` : ''
    return {
      corto: `IA apagada en el número${n}`,
      largo: `La IA NO va a responder: está apagada para todo el número${n} en 👋 AUTOS. Préndela ahí o responde tú.`,
    }
  }
  return null
}
