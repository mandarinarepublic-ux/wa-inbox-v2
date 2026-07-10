// lib/cache.js
// Capa de caché de lecturas de Google Sheets.
//
// PROBLEMA que resuelve: el inbox hace polling cada 8s. Cada pestaña abierta
// leía Sheets EN VIVO (force-dynamic), y como todas comparten la MISMA cuenta de
// servicio, se reventaba la cuota de Google Sheets ("Read requests per minute per
// user" = 60/min por la Service Account). Con 3+ pestañas → 429 Quota exceeded.
//
// SOLUCIÓN: como todas las pestañas quieren EXACTAMENTE los mismos datos globales,
// cacheamos la lectura ~8s con unstable_cache (Vercel Data Cache, compartido entre
// instancias). Resultado: UNA sola lectura a Sheets por ventana, sin importar
// cuántas pestañas/usuarios haya. Reduce las lecturas 10–30×.
//
// IMPORTANTE: esto SOLO cachea el camino de LECTURA (polling). El camino de
// ESCRITURA (cambiar estado, notas, respuestas) sigue leyendo Sheets en vivo para
// localizar la fila exacta y no escribir sobre datos obsoletos.
import { unstable_cache } from 'next/cache'
import { readSheet, readSheetTail } from './sheets.js'

// TTL corto = datos casi en vivo. El frontend además tiene overrides optimistas
// (localStatusRef) que enmascaran esta ventana, así que 8s es imperceptible.
const TTL = 8

// MENSAJES (tail) — la lectura MÁS caliente: la golpea el polling cada 8s.
export const readMensajesTail = unstable_cache(
  async (lastN = 3000) => readSheetTail('MENSAJES', lastN),
  ['sheets:mensajes-tail'],
  { revalidate: TTL, tags: ['mensajes'] }
)

// CONTACTOS (completo) — segunda lectura más caliente del polling.
export const readContactos = unstable_cache(
  async () => readSheet('CONTACTOS'),
  ['sheets:contactos'],
  { revalidate: TTL, tags: ['contactos'] }
)

// RESPUESTAS_RAPIDAS — cambia poco; TTL más largo.
export const readRespuestas = unstable_cache(
  async () => readSheet('RESPUESTAS_RAPIDAS'),
  ['sheets:respuestas'],
  { revalidate: 30, tags: ['respuestas'] }
)

// MENSAJES (completo) — solo para resolver mensajes citados fuera del tail. Es raro
// y los mensajes viejos no cambian → TTL largo para no pagar la lectura pesada.
export const readMensajesFull = unstable_cache(
  async () => readSheet('MENSAJES'),
  ['sheets:mensajes-full'],
  { revalidate: 30, tags: ['mensajes'] }
)
