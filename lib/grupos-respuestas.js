// lib/grupos-respuestas.js — agrupar las respuestas rápidas con botones
// (Datos · Productos · Tallas) en el panel derecho. Módulo PURO.
//
// El grupo vive en `inbox.respuestas_rapidas.grupo` (nulo = sin grupo). Una
// respuesta sin grupo, o con un grupo que ya no existe, se ve en "Todas": nunca
// desaparece de la lista por no encajar en un botón.

export const GRUPOS_RESPUESTA = [
  { id: 'datos',     emoji: '📋', nombre: 'Datos' },
  { id: 'productos', emoji: '🛍️', nombre: 'Productos' },
  { id: 'tallas',    emoji: '📐', nombre: 'Tallas' },
]
export const TODAS = 'todas'

const IDS = new Set(GRUPOS_RESPUESTA.map(g => g.id))

/** El grupo guardable: uno de los conocidos o '' (sin grupo). */
export function normalizarGrupo(g) {
  const s = String(g || '').trim().toLowerCase()
  return IDS.has(s) ? s : ''
}

/** Índices (en la lista COMPLETA) de las respuestas visibles con ese filtro. */
export function indicesVisibles(replies, filtro) {
  const lista = Array.isArray(replies) ? replies : []
  const f = normalizarGrupo(filtro)
  const out = []
  lista.forEach((r, i) => { if (!f || normalizarGrupo(r?.grupo) === f) out.push(i) })
  return out
}

/** Cuántas hay en cada botón: { todas, datos, productos, tallas }. */
export function conteoPorGrupo(replies) {
  const lista = Array.isArray(replies) ? replies : []
  const c = { [TODAS]: lista.length }
  for (const g of GRUPOS_RESPUESTA) c[g.id] = 0
  for (const r of lista) { const g = normalizarGrupo(r?.grupo); if (g) c[g]++ }
  return c
}

/**
 * Vecina VISIBLE para las flechas ↑↓ con un filtro puesto: subir una respuesta
 * de Tallas la cambia de lugar con la Talla de arriba, no con una de Productos
 * que no se ve. Devuelve el índice en la lista completa, o -1 si no hay.
 */
export function vecinaVisible(visibles, idx, paso) {
  const pos = visibles.indexOf(idx)
  if (pos < 0) return -1
  const otra = visibles[pos + paso]
  return otra === undefined ? -1 : otra
}
