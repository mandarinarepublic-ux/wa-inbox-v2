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
// La versión sale de tres marcas de tiempo:
//   · inbox.bandeja.actualizado_en    → mensajes y estado de bandeja, POR CANAL
//   · inbox.conversaciones.updated_at → alias, notas, temperatura, modo IA, venta
//   · inbox.bandeja.acuse_en          → ✓/✓✓/leído, AGRUPADOS en 30 s (acuseAgrupado)
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

/**
 * La hora del último acuse de entrega (✓/✓✓/leído), AGRUPADA en ventanas.
 *
 * ☠️ POR QUÉ (23-sep-2026). Cada acuse tocaba `bandeja.actualizado_en`, así
 * que cada uno invalidaba la versión y TODAS las pantallas recargaban el inbox
 * entero. Un vendedor de IND mandó más de 50 fotos en 4 minutos, Meta devolvió 45
 * acuses por minuto y la base se cayó 40 minutos. Ahora el acuse anota su hora
 * aparte (`bandeja.acuse_en`) y cuenta así:
 *
 *   · mientras la ventana del último acuse sigue abierta → el borde ANTERIOR
 *     (lo que ya se publicó, no mueve nada)
 *   · en cuanto cierra → su borde de cierre (mueve la versión UNA vez)
 *
 * Así una ráfaga invalida a lo más una vez cada `ventanaMs`, y el ÚLTIMO acuse
 * siempre se termina viendo (con `ventanaMs` de atraso como máximo) — nunca
 * queda congelado. Nunca devuelve una hora futura: taparía los mensajes nuevos.
 *
 * Solo los acuses van agrupados. Un mensaje, un cambio de bandeja o un
 * `failed` (que devuelve el chat a Pendientes) siguen moviendo la versión al
 * instante por `actualizado_en`.
 */
export function acuseAgrupado(ultimoAcuse, ahoraMs, ventanaMs = 30_000) {
  const t = Date.parse(ultimoAcuse)
  if (!Number.isFinite(t)) return null
  const cierre = Math.ceil(t / ventanaMs) * ventanaMs
  const marca = ahoraMs >= cierre ? cierre : cierre - ventanaMs
  return new Date(marca).toISOString()
}
