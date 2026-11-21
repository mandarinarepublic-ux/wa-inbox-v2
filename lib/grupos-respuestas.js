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

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * 🔎 ¿La respuesta coincide con lo buscado? TODAS las palabras, sin tildes ni
 * mayúsculas ("tallas nino" encuentra "Tallas de NIÑO"), en el texto, los
 * botones o los productos del carrusel. Búsqueda vacía = coincide.
 */
export function coincideBusqueda(reply, q) {
  const palabras = sinTildes(q).split(/\s+/).filter(Boolean)
  if (!palabras.length) return true
  const botones = (Array.isArray(reply?.botones) ? reply.botones : []).map(b => (typeof b === 'string' ? b : b?.title || b?.texto || ''))
  const productos = (Array.isArray(reply?.carrusel) ? reply.carrusel : []).map(p => p?.nombre || '')
  const heno = sinTildes([reply?.text, ...botones, ...productos].join(' '))
  return palabras.every(w => heno.includes(w))
}

/** Índices (en la lista COMPLETA) de las respuestas visibles con ese filtro y esa búsqueda. */
export function indicesVisibles(replies, filtro, q = '') {
  const lista = Array.isArray(replies) ? replies : []
  const f = normalizarGrupo(filtro)
  const out = []
  lista.forEach((r, i) => { if ((!f || normalizarGrupo(r?.grupo) === f) && coincideBusqueda(r, q)) out.push(i) })
  return out
}

/** Cuántas hay en cada botón: { todas, datos, productos, tallas }. */
// Con búsqueda, cuenta solo las que coinciden: así se ve en qué botón están.
export function conteoPorGrupo(replies, q = '') {
  const lista = (Array.isArray(replies) ? replies : []).filter(r => coincideBusqueda(r, q))
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
