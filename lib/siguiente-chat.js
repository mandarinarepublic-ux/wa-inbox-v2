// lib/siguiente-chat.js — moverse por la lista de chats sin volver a ella.
// Módulo PURO (20-nov-2026, paso 7 de la revisión de UX): decide a qué chat ir,
// no abre nada.
//
// Una fila se identifica por teléfono Y número (`phoneId`): en GENERAL el mismo
// cliente tiene dos filas, una por número, y abrir la equivocada es responder
// por el número donde la ventana está cerrada (Meta 131047).

const misma = (a, b) => !!a && !!b && String(a.telefono) === String(b.telefono) &&
  (!a.phoneId || !b.phoneId || String(a.phoneId) === String(b.phoneId))

/** Posición de la fila `actual` en `lista`, -1 si no está. */
export function posicionEnLista(lista, actual) {
  return (Array.isArray(lista) ? lista : []).findIndex(c => misma(c, actual))
}

/**
 * La fila a `paso` posiciones (+1 la de abajo, -1 la de arriba), o null si no
 * hay. Sin chat abierto, +1 da la primera (para empezar con la tecla J).
 */
export function vecinoEnLista(lista, actual, paso) {
  const l = Array.isArray(lista) ? lista : []
  const i = posicionEnLista(l, actual)
  if (i < 0) return paso > 0 && l.length ? l[0] : null
  return l[i + paso] || null
}

/**
 * Después de marcar ATENDIDO: el pendiente que sigue (el de abajo; si era el
 * último, el de arriba). null si no queda otro, si el chat no está en la lista
 * o si hay algo escrito en la caja.
 *
 * ☠️ `hayBorrador`: la caja de texto NO se vacía al cambiar de chat. Saltar con
 * un borrador escrito lo dejaría listo para salir hacia OTRO cliente. Con algo
 * escrito no se salta: te quedas donde estás.
 */
export function siguienteTrasAtender(lista, actual, { hayBorrador = false } = {}) {
  if (hayBorrador) return null
  const l = Array.isArray(lista) ? lista : []
  const i = posicionEnLista(l, actual)
  if (i < 0) return null
  return l[i + 1] || l[i - 1] || null
}

/**
 * ¿Se puede festejar "0 pendientes"? Solo con la bandeja de Pendientes vacía de
 * verdad: sin búsqueda, sin pendientes en la cuenta y con una sincronización
 * BUENA reciente. Una lista vacía porque falló la carga no es "respondiste a
 * todos": sería la pantalla mintiendo.
 */
export function hayLogroPendientes({ bandeja, buscando, totalPendientes, lastSyncMs, ahoraMs = Date.now() }) {
  if (bandeja !== 'pendiente' || buscando) return false
  if (Number(totalPendientes) !== 0) return false
  return Number.isFinite(lastSyncMs) && ahoraMs - lastSyncMs >= 0 && ahoraMs - lastSyncMs < 2 * 60 * 1000
}
