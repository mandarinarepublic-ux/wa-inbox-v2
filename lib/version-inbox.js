// lib/version-inbox.js — "¿cambió algo desde tu última pregunta?"
//
// ⚠️ POR QUÉ EXISTE, con números. El polling pide el ciclo completo (~370 KB)
// cada 10 s. Medido el 28-ago sobre 24 h en horario de atención:
//
//   IND    4.654 preguntas/día · 3 de cada 4 NO traen nada nuevo (74,8%)
//   MANDI  1.052 preguntas/día · 9 de cada 10 tampoco (93,6%)
//
// Eso es Fast Origin Transfer: el 63% de la factura de Vercel, a $0,41/GB desde
// São Paulo. Contestar "sin novedad" sin cuerpo devuelve el consumo al plan.
//
// ⚠️ NO es un "sync incremental". Un delta por cursor perdería mensajes en
// silencio (`inbox.mensajes` no tiene columna monótona: `fecha` es de Meta y en
// IND llega hasta 2 h 38 tarde). Acá, si cambió CUALQUIER cosa, se manda TODO
// igual que siempre. Lo único que se ahorra es repetir lo idéntico.
//
// La versión sale de dos marcas de tiempo:
//   · inbox.bandeja.actualizado_en    → mensajes y estado de bandeja, POR CANAL
//   · inbox.conversaciones.updated_at → alias, notas, temperatura, modo IA, venta
//
// La segunda hace falta de verdad: sin ella, cambiar la temperatura en una
// pestaña no se vería en otra.

/**
 * Arma el etag a partir de las marcas de tiempo que definen "el estado de esta
 * bandeja". Devuelve `''` cuando NO se pudo determinar — que es distinto de
 * "no cambió nada" y se trata distinto (ver `sinCambios`).
 *
 * Se usa la MÁS RECIENTE, así que el orden de las partes da igual: si dependiera
 * del orden, agregar una tercera fuente mañana invalidaría el caché de todos en
 * silencio.
 *
 * Una fecha corrupta se ignora en vez de envenenar el resultado.
 */
export function etagDe(partes) {
  if (!Array.isArray(partes)) return ''
  let max = -Infinity
  for (const p of partes) {
    const t = Date.parse(p)
    if (Number.isFinite(t) && t > max) max = t
  }
  return max === -Infinity ? '' : `w/"${max}"`
}

/**
 * ¿Se le puede contestar "sin novedad" a este cliente?
 *
 * ☠️ LA ASIMETRÍA QUE SOSTIENE TODO ESTE ARCHIVO. Equivocarse tiene dos precios
 * muy distintos:
 *
 *   · un falso "cambió"     → se manda todo de más. Cuesta centavos.
 *   · un falso "no cambió"  → la pantalla queda CONGELADA con datos viejos y el
 *     vendedor no se entera. Es la familia "la pantalla miente" — la que este
 *     inbox lleva meses pagando: el cliente que desaparece, el estado que no se
 *     movió, el mensaje que nunca llegó.
 *
 * Por eso, ante cualquier duda, se responde que SÍ cambió. En particular cuando
 * la versión actual no se pudo calcular (la base no respondió, la consulta
 * falló): ahí NUNCA se corta, se manda todo.
 */
export function sinCambios(etagCliente, etagActual) {
  if (!etagActual) return false   // no se sabe → mandar todo
  if (!etagCliente) return false  // primera carga → mandar todo
  return String(etagCliente) === String(etagActual)
}
