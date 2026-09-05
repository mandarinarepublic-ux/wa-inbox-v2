// Las ÚNICAS rutas del inbox que nunca piden sesión, porque quien las llama no
// puede tener una. Salen del inventario medido del 7-ago-2026
// (docs/INVENTARIO-RUTAS-2026-08-07.md), no de la memoria de nadie.
//
// Cada una se defiende sola:
//   /api/webhook          → firma de Meta con META_APP_SECRET
//   /api/social/webhook   → firma de Meta con META_APP_SECRET
//   /api/cron/seguimientos→ CRON_SECRET
//   /api/cron/pendientes  → CRON_SECRET
//   /api/cron/entregas    → CRON_SECRET
//   /api/pago-dlocal      → secreto compartido en la URL (verificado: 401 sin él)
//
// ⚠️ Agregar algo acá es abrir una puerta al internet entero. Si alguna vez hay
// que hacerlo, que sea con tráfico medido en la mano, como se hizo con esta lista.
export const RUTAS_PUBLICAS = [
  '/api/webhook',
  '/api/social/webhook',
  '/api/cron/seguimientos',
  '/api/cron/pendientes',
  '/api/cron/entregas',
  // Aviso diario de posibles pagos sin pedido. Va acá por lo MISMO que los de
  // arriba: un cron detrás del candado devuelve 401 y se ve igual que uno sano —
  // la tarea no corre nunca y nadie se entera. Ya pasó con `entregas` en MANDI.
  '/api/cron/pagos',
  '/api/pago-dlocal',
]

/**
 * ¿Esta ruta queda fuera del candado?
 *
 * Compara la ruta completa o una subruta con separador, NUNCA con `startsWith`
 * a secas: si no, `/api/webhook-falso` pasaría por ser `/api/webhook`.
 */
export function esRutaPublica(pathname) {
  const p = String(pathname || '')
  return RUTAS_PUBLICAS.some((r) => p === r || p.startsWith(r + '/'))
}
