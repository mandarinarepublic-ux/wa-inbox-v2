// ¿El mensaje vino DE VERDAD de Meta? — SOLO OBSERVA, no rechaza nada.
//
// Cuando Meta llama a nuestro webhook manda, además del cuerpo, una cabecera
// `x-hub-signature-256` con un HMAC-SHA256 de ese cuerpo hecho con el "App
// Secret" de la aplicación. Recalcularlo de nuestro lado y ver que coincide es
// la única prueba de que el mensaje lo mandó Meta y no cualquiera que conozca
// la URL. Sin eso, alguien puede inventarse mensajes de clientes que no
// existen y aparecerían en el inbox como reales.
//
// ⚠️ ESTE ARCHIVO NO RECHAZA NADA, A PROPÓSITO. No existe ni una rama que
// devuelva 401/403. Instrucción explícita de Rodrigo el 8-ago-2026:
//
//   "EXCLUSIVAMENTE modo observación, BAJO NINGÚN CONCEPTO vas a modificar
//    nada que implique dejar de recibir o enviar mensajes por 1 segundo"
//
// Y tiene razón: si la firma se calculara mal —secreto equivocado, otra app,
// el cuerpo alterado por el camino— y esto rechazara, el inbox dejaría de
// recibir mensajes de clientes. Eso ya pasó una vez por otra causa y costó 22
// horas sin despachar.
//
// Primero se mira el registro durante días. Si TODO valida, recién ahí se
// decide si se activa. Y ese cambio será otro commit, revisado aparte.

import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Compara el sello que mandó Meta contra el que calculamos nosotros.
 *
 * Devuelve un veredicto en texto, pensado para leerse en los registros:
 *   'coincide'        → la firma es válida. Es lo que queremos ver siempre.
 *   'NO-coincide'     → llegó firma pero no cuadra. Investigar ANTES de activar.
 *   'sin-cabecera'    → Meta no mandó firma (o no es Meta quien llama).
 *   'sin-secreto'     → falta META_APP_SECRET; no se puede ni comprobar.
 *   'sin-cuerpo'      → no había qué firmar.
 *   'formato-raro'    → la cabecera no viene como `sha256=<hex>`.
 *
 * Es una función pura para poder probarla sin levantar el webhook.
 */
export function evaluarFirmaMeta({ secreto, crudo, cabecera }) {
  const sec = String(secreto || '').replace(/[^\x21-\x7E]/g, '')
  if (!sec) return 'sin-secreto'
  if (!cabecera) return 'sin-cabecera'
  if (!crudo) return 'sin-cuerpo'

  const m = String(cabecera).match(/^sha256=([a-f0-9]{64})$/i)
  if (!m) return 'formato-raro'

  try {
    const esperado = createHmac('sha256', sec).update(crudo, 'utf8').digest()
    const recibido = Buffer.from(m[1], 'hex')
    // Largo constante: comparar con === delataría la firma midiendo tiempos.
    if (esperado.length !== recibido.length) return 'NO-coincide'
    return timingSafeEqual(esperado, recibido) ? 'coincide' : 'NO-coincide'
  } catch {
    return 'formato-raro'
  }
}

/**
 * Anota en el registro qué habría pasado. **Nunca lanza y nunca rechaza.**
 *
 * `crudo` tiene que ser el cuerpo EXACTO que llegó, byte por byte: si se
 * parsea y se vuelve a serializar, el sello ya no cuadra aunque el mensaje sea
 * legítimo (cambian los espacios, el orden de las claves, los acentos…).
 */
export function observarFirmaMeta(cabecera, crudo) {
  try {
    const veredicto = evaluarFirmaMeta({
      secreto: process.env.META_APP_SECRET,
      crudo,
      cabecera,
    })
    // Se busca en los registros con "[firma]". Lo esperado es 'coincide'
    // SIEMPRE; cualquier otra cosa hay que entenderla antes de activar nada.
    console.log(`[firma] ${veredicto}`)
    return veredicto
  } catch {
    // Que observar no pueda, jamás, tumbar la recepción de un mensaje.
    return 'error-al-observar'
  }
}

/**
 * ¿Este POST se descarta? (la decisión; el rechazo vive en app/api/webhook/route.js)
 *
 * Historia:
 *   · 20-nov-2026, control intermedio: solo `sin-cabecera` y `formato-raro`.
 *     Medido 17→20-nov: 2.014 de 2.014 webhooks de WhatsApp de MANDI y REPUBLIC
 *     traían firma y TODAS coincidían.
 *   · 20-nov-2026, noche, CERRADO ("sí, cierra la firma en MANDI" de Rodrigo):
 *     también `NO-coincide` y `sin-secreto`. Antes de cerrarlo se midieron las
 *     24 h previas: 1.735 veredictos y 1.750 eventos guardados, todos
 *     `coincide`. El único NO-coincide fue una prueba hecha a mano (13:58,
 *     junto a un sin-cabecera y un formato-raro en el mismo segundo), que no
 *     guardó ningún evento: no era Meta.
 *
 * ☠️ Si el secreto de Vercel cambia o se borra, ahora se rechaza TODO (falla
 * cerrado). Síntoma: `[firma] DESCARTADO NO-coincide` o `sin-secreto` en los
 * registros y el inbox sin mensajes nuevos. Arreglo inmediato: Instant Rollback
 * en Vercel, o corregir META_APP_SECRET y redesplegar.
 *
 * `error-al-observar` (un error NUESTRO al calcular) y un veredicto desconocido
 * SIGUEN PASANDO: un fallo de este código no puede dejar sin mensajes al inbox.
 */
const DESCARTABLES = new Set(['sin-cabecera', 'formato-raro', 'NO-coincide', 'sin-secreto'])
export function descartarSinFirma(veredicto) {
  return DESCARTABLES.has(String(veredicto || ''))
}
