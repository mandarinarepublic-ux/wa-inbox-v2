// lib/pestana.js — recordar en qué número quedó el vendedor al recargar.
//
// Hasta el 30-ago la pestaña arrancaba SIEMPRE en el número principal: estaba
// fija en el código y no se guardaba en ningún lado.
//
// ☠️ POR QUÉ NO ES UN `localStorage.getItem` Y YA. La pestaña no solo pinta una
// lista: decide POR CUÁL NÚMERO SALEN LOS MENSAJES. Restaurar un valor que no
// corresponde a un canal real dejaría la pantalla mostrando una cosa y el módulo
// de envíos apuntando a otra — o a ninguna. Ese es el bug del número equivocado,
// que en estos inbox ya llegó a producción cinco veces.
//
// Y hay un segundo cuidado que NO vive acá pero es igual de importante: al
// restaurar hay que pasar por la MISMA función que usa el clic
// (`cambiarCanal` / `cambiarLinea`), nunca tocando el estado a mano. Esa función
// es la que además mueve el canal del módulo de envíos. Pintar la pestaña sin
// eso es exactamente cómo se reintroduce el bug.

/**
 * Valida lo que hay guardado contra los canales que existen de verdad.
 *
 * Devuelve el id solo si es exactamente uno de la lista; en cualquier otro caso
 * devuelve `''` y quien llame arranca como siempre.
 *
 * La asimetría es deliberada: arrancar en el número por defecto es aburrido pero
 * correcto; arrancar en uno inventado manda mensajes por donde no es.
 */
export function pestanaGuardada(valor, validas) {
  if (!Array.isArray(validas) || validas.length === 0) return ''
  const v = String(valor || '').trim()
  return validas.includes(v) ? v : ''
}
