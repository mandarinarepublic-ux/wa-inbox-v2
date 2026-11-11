// lib/notas-vista.js — Qué notas se ven de entrada en el panel Ventas.
//
// Pedido de Rodrigo (10-nov-2026): un cliente que compra seguido junta decenas de
// notas (links de pago, "Link expirado", PAGADO, pedidos...) y la lista empujaba
// el historial de pedidos fuera de la pantalla. Ahora se ven solo las más
// recientes y el resto queda detrás de un botón "Ver N notas anteriores".

// Cuántas notas se ven sin tocar nada. Tres alcanzan para lo que se está
// atendiendo hoy: el link recién mandado, su resultado y una nota a mano.
export const NOTAS_VISIBLES = 3

/**
 * Parte la lista (que llega de la más nueva a la más vieja) en las que se ven y
 * las que quedan escondidas. No reordena ni filtra nada más.
 */
export function partirNotas(notas, visibles = NOTAS_VISIBLES) {
  const lista = Array.isArray(notas) ? notas : []
  const n = Math.max(0, Math.floor(Number(visibles) || 0))
  return { recientes: lista.slice(0, n), antiguas: lista.slice(n) }
}
