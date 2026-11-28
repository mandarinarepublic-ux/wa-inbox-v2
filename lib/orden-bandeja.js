// lib/orden-bandeja.js — El orden de la columna de contactos, por bandeja.
//
// Pendientes es una COLA DE TRABAJO, no un muro de novedades: arriba va quien
// lleva más rato esperando respuesta. Las demás bandejas se quedan con el orden
// de siempre (lo más reciente arriba), porque ahí el más viejo primero serían
// conversaciones de hace meses.
//
// Función pura y sin React a propósito: es la regla que decide a quién atiendes
// primero, y tiene que poder probarse sola.

const FONDO = Number.MAX_SAFE_INTEGER

/** ISO → milisegundos. Una fecha vacía o corrupta va al final, nunca al frente. */
function ms(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isNaN(t) ? FONDO : t
}

/**
 * @param {Array}  convs           conversaciones con { telefono, last: { timestamp } }
 * @param {string} bandeja         'pendiente' activa el FIFO; cualquier otra, el orden de siempre
 * @param {Function} esperandoDesde  (telefono) => ISO del último mensaje ENTRANTE, o null
 * @param {Object}  [opciones]
 * @param {boolean} [opciones.nuevosArriba]  Pendientes al revés: el que escribió último
 *                                          arriba (botón ⇅ de la lista). Una fecha rota
 *                                          sigue al FONDO en los dos sentidos.
 * @param {Function} [opciones.puntajeDe]   (conv) => número 0–100, o -1 sin puntaje.
 *                                          Si viene, Pendientes va por PROBABILIDAD DE
 *                                          COMPRA (lib/puntaje.js): el ⭐ y el más alto
 *                                          arriba; a igual puntaje, el que más espera.
 *                                          Solo cambia el orden: nadie sale de la cola.
 * @returns {Array} copia ordenada
 */
export function ordenarBandeja(convs, bandeja, esperandoDesde, { nuevosArriba = false, puntajeDe = null } = {}) {
  const lista = Array.isArray(convs) ? [...convs] : []
  if (bandeja !== 'pendiente') {
    // Orden de siempre: el mensaje más reciente arriba.
    return lista.sort((a, b) => ms(b?.last?.timestamp) - ms(a?.last?.timestamp))
  }
  const desde = typeof esperandoDesde === 'function' ? esperandoDesde : () => null
  // FIFO por el último ENTRANTE: se ordena por cuánto lleva esperando LA
  // PERSONA, no por cuándo tocamos nosotros el chat.
  //
  // Hoy las dos fechas coinciden casi siempre —medido el 8-ago-2026: las 18
  // conversaciones pendientes de MANDI tenían diferencia 0,0 h—, porque
  // contestar saca el chat de Pendientes. Se usa el entrante igual porque es
  // gratis (el campo ya viene en la ficha) y porque el día que un seguimiento
  // del cron caiga sobre un chat pendiente, ordenar por el último mensaje
  // mandaría al fondo justo a quien lleva más esperando.
  const clave = (c) => {
    const entrante = ms(desde(c?.telefono))
    return entrante === FONDO ? ms(c?.last?.timestamp) : entrante
  }
  const puntaje = (c) => {
    const v = Number(puntajeDe(c))
    return Number.isFinite(v) ? v : -1
  }
  return lista.sort((a, b) => {
    if (typeof puntajeDe === 'function') {
      const d = puntaje(b) - puntaje(a)
      if (d !== 0) return d
    }
    const ka = clave(a), kb = clave(b)
    if (ka === FONDO || kb === FONDO) return ka - kb
    return nuevosArriba ? kb - ka : ka - kb
  })
}
