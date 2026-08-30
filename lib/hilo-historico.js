// lib/hilo-historico.js — traer más historial al subir en un chat.
//
// El hilo carga los últimos 800 mensajes. Antes no había forma de pedir más: lo
// anterior quedaba en la base sin que nadie lo mirara. Se notó en un chat de
// 1.793 mensajes donde el inbox mostraba desde julio y el primero era de mayo.
//
// ☠️ EL BORDE ES DONDE ESTÁ EL PELIGRO. Al pedir "los 800 anteriores a esta
// fecha", dos mensajes pueden compartir el mismo segundo — WhatsApp da la hora
// al segundo y una persona manda tres seguidos. Entonces:
//
//   · pedir "estrictamente ANTERIOR" pierde a los que empatan en ese segundo,
//     para siempre y sin que nadie se entere;
//   · pedir "anterior O IGUAL" trae algunos dos veces.
//
// Se elige repetir y deduplicar acá. Un duplicado es invisible; un hueco es un
// mensaje de un cliente que desaparece, que es la familia de bugs más cara de
// este inbox.

/**
 * Une el tramo viejo recién traído con lo que ya está en pantalla.
 *
 * - Deduplica por id (el wamid), quedándose con la versión que ya estaba: puede
 *   traer datos que el tramo histórico no tiene.
 * - Devuelve todo en orden cronológico.
 * - **Nunca devuelve menos de lo que había**: traer historial jamás puede hacer
 *   desaparecer un mensaje que el vendedor ya estaba viendo.
 *
 * Un mensaje sin id (burbuja optimista, tipo raro) se conserva tal cual: no se
 * puede deduplicar, pero perderlo sería peor.
 */
export function fusionarHilo(viejos, actuales) {
  const base = Array.isArray(actuales) ? actuales : []
  const previos = Array.isArray(viejos) ? viejos : []
  if (!previos.length) return base

  const vistos = new Set(base.map((m) => m && m.id).filter(Boolean))
  const nuevos = previos.filter((m) => !(m && m.id && vistos.has(m.id)))

  const t = (m) => {
    const n = Date.parse(m && m.timestamp)
    return Number.isFinite(n) ? n : 0
  }
  // `concat` y no un sort del arreglo original: mutar lo que ya está en pantalla
  // es cómo se pierde una burbuja optimista a mitad de un envío.
  return [...nuevos, ...base].sort((a, b) => t(a) - t(b))
}
