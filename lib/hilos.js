// lib/hilos.js — Filtrar el caché de historiales por canal.
//
// La bandeja se arma mezclando TRES fuentes (`load()` en components/App.jsx):
// `rows` y `lista` vienen del backend ya filtradas por `phone_id`, y `hilos` —el
// caché de historiales que se llena al abrir cada chat— vive en el navegador y
// NO pasa por ningún filtro. Era el único hueco, y por ahí se coló el bug.
//
// ☠️ EL BUG QUE CIERRA (9-sep): en la pestaña de REPUBLIC aparecía una clienta
// que solo había escrito a MANDI. El caché conservaba su hilo, `buildConvs` le
// armaba fila propia —crea fila para CUALQUIER teléfono que reciba— y el pintado
// no filtra por canal en ninguna parte: `filtered` solo filtra por estado,
// temperatura o venta. Encima la fila colada no trae `estadoBandeja` (eso solo lo
// da la vista `lista_bandeja`), así que `estadoFila` caía al estado POR PERSONA y
// la conversación se sentaba en una bandeja como una más.
//
// El caché se limpia en `cambiarLinea`, pero SOLO en una de sus cuatro ramas
// (número → número). Entrar a un número desde CONTACTOS/SOCIAL/AUTO no limpia
// nada, y salir de un número hacia esas pestañas no cae en ninguna rama. Además
// `cargarHilo` escribe DESPUÉS de su `await`, así que un hilo en vuelo repuebla
// el caché ya estando en la otra pestaña. Se arregla acá, en el punto donde el
// dato SE USA, y no tapando las rutas una por una: cualquier puerta nueva al
// mismo hueco queda cerrada sola.
//
// ⚠️ POR QUÉ ACÁ SÍ SE PUEDE FILTRAR FUERTE. Dejar un hilo afuera NUNCA esconde
// una conversación: `lista` trae todas las del canal sobre TODO el historial. Lo
// único que se pierde es el historial ya descargado, que se vuelve a bajar solo
// al abrir el chat. Es lo contrario de `esPintable`, donde una lista de tipos
// permitidos sí escondía clientes enteros — por eso allá el default seguro es
// dejar pasar y acá es dejar fuera.

/**
 * Clave del caché → phone_id. La clave es `${telefono}|${phoneId}`; se parte por
 * el ÚLTIMO separador para que el teléfono no pueda morderse el canal.
 */
export function canalDeClave(clave) {
  const s = String(clave)
  const i = s.lastIndexOf('|')
  return i === -1 ? '' : s.slice(i + 1)
}

/**
 * Mensajes del caché de hilos que pertenecen a `canal` (un phone_id de Meta).
 *
 * `canal` vacío o nulo = pestaña GENERAL, que muestra los dos números: pasa todo.
 * Con un canal pedido pasa solo lo que se puede PROBAR que es de ese canal.
 */
export function hilosDelCanal(cache, canal) {
  const entradas = Object.entries(cache || {})
  const usar = canal
    ? entradas.filter(([clave]) => canalDeClave(clave) === canal)
    : entradas
  return usar.flatMap(([, msgs]) => msgs || [])
}
