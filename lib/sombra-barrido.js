// lib/sombra-barrido.js — Barrido de PENDIENTES en modo sombra (17-nov-2026).
//
// El modo sombra del webhook solo mira mensajes que ENTRAN desde que se prendió.
// Los chats que ya estaban esperando nunca pasaban por el agente ("tengo 10
// pendientes, ¿por qué no barre esos primero?"). Este barrido toma el ÚLTIMO
// mensaje del cliente en cada chat de Pendientes y le pregunta al agente qué
// contestaría, SIN enviar nada.
//
// Módulo PURO: decide a quién se le pregunta. La ruta (/api/ia-sombra) hace el resto.

import { esMensajeSinPedido } from './ia-ahorro.js'

/** Tope por clic: cada llamada cuesta tokens y la ruta tiene tiempo limitado. */
export const MAX_BARRIDO = 15

/**
 * @param {Array<{telefono, nombre, wamid, tipo, texto, fecha}>} ultimos
 *        último mensaje ENTRANTE de cada chat pendiente
 * @param {Set<string>} yaRevisados wamids que ya tienen una respuesta en sombra SIN error
 * @returns los que vale la pena preguntarle al agente, del más nuevo al más viejo
 */
export function elegirParaSombra(ultimos = [], yaRevisados = new Set(), max = MAX_BARRIDO) {
  return ultimos
    .filter(u => u && u.wamid && u.telefono)
    // El agente solo lee texto: fotos y audios no se le mandan (mismo criterio que el webhook).
    .filter(u => u.tipo === 'texto' && String(u.texto || '').trim())
    // "gracias", un emoji… no piden nada: el webhook tampoco llama por eso.
    .filter(u => !esMensajeSinPedido(u.texto))
    // Ya revisado con éxito → no se gasta otra vez. Uno que falló SÍ se reintenta.
    .filter(u => !yaRevisados.has(u.wamid))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    .slice(0, max)
}

/** Corre `fn` sobre `items` con a lo más `n` a la vez. Devuelve los resultados en orden. */
export async function enParalelo(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  const trabajador = async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k], k)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador))
  return out
}
