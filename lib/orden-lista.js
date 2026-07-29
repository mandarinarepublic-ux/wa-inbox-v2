// lib/orden-lista.js — Mover un elemento dentro de una lista.
//
// Lo usan las flechas ↑↓ y el arrastre, que son la misma operación con distinto
// gesto. Vive aparte y es puro para poder probarlo: es la única lógica de verdad
// del reordenamiento (el resto es escribir en la base y pintar).
//
// Devuelve una lista NUEVA. No muta la que recibe, porque el que llama guarda la
// anterior para poder revertir si el guardado falla.

/**
 * @param {Array} lista
 * @param {number} desde  índice actual del elemento
 * @param {number} hacia  índice destino. Se recorta a los límites de la lista, así
 *                        que "subir el primero" o "bajar el último" no hacen nada.
 * @returns {Array} lista nueva
 */
export function moverItem(lista, desde, hacia) {
  if (!Array.isArray(lista)) return []
  const n = lista.length
  const copia = [...lista]
  if (!Number.isInteger(desde) || desde < 0 || desde >= n) return copia
  const destino = Math.max(0, Math.min(n - 1, hacia))
  if (destino === desde) return copia
  const [item] = copia.splice(desde, 1)
  copia.splice(destino, 0, item)
  return copia
}
