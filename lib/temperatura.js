// lib/temperatura.js — la temperatura es CUÁNTO HACE QUE HABLÓ EL CLIENTE.
//
// Diseño 2026-09-22 (docs/superpowers/specs/2026-09-22-gestion-chats-ind-design.md §2.2):
// antes era un botón manual que también disparaba mensajes y la señal a Meta, y
// nunca bajaba (56 🔥 ya tenían pedido). Ahora se CALCULA al pintar desde
// `ultimo_entrante_at` —el mismo reloj que la ventana de 24 h de Meta— y no se
// guarda en ningún lado: no hay cron que la mueva ni forma de que se quede pegada.
//
// Los cortes salen de 7.026 respuestas reales de IND (30 días): el 88,7 % de los
// clientes contesta en menos de 1 h y el 94 % en menos de 6 h.
//
// Módulo PURO: sin red, sin base, sin relojes escondidos (`ahoraMs` entra de afuera).

export const HORA_MS = 60 * 60 * 1000

export const TEMPERATURAS = {
  caliente: { icon: '🔥', label: 'Caliente' },
  tibio:    { icon: '🌤️', label: 'Tibio' },
  frio:     { icon: '❄️', label: 'Frío' },
  dormido:  { icon: '💤', label: 'Dormido' },
}

/** Horas desde `iso` (nunca negativas), o null si no hay fecha válida. */
export function horasDesde(iso, ahoraMs = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, (ahoraMs - t) / HORA_MS)
}

/** 'caliente' <1 h · 'tibio' 1–6 h · 'frio' 6–24 h · 'dormido' ≥24 h · '' sin dato. */
export function temperaturaDe(ultimoEntranteAt, ahoraMs = Date.now()) {
  const h = horasDesde(ultimoEntranteAt, ahoraMs)
  if (h === null) return ''
  if (h < 1) return 'caliente'
  if (h < 6) return 'tibio'
  if (h < 24) return 'frio'
  return 'dormido'
}

/** Texto corto para el chip: 'ahora', '8 h', '2 días'. */
export function textoHoras(h) {
  if (h === null || h === undefined || !Number.isFinite(h)) return ''
  if (h < 1) return 'ahora'
  if (h < 24) return `${Math.floor(h)} h`
  const d = Math.floor(h / 24)
  return `${d} día${d === 1 ? '' : 's'}`
}
