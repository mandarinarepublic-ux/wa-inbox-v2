// lib/adjuntos-respuesta.js — los adjuntos de una respuesta rápida, EN ORDEN.
//
// LA REGLA, en palabras de Rodrigo:
//
//     "debe respetar el orden en el que cargué los adjuntos"
//
// No es un capricho de interfaz. WhatsApp entrega cada adjunto como un mensaje
// aparte, así que el orden en que salen es el orden en que el cliente los ve, y
// arma la conversación: texto que presenta, foto que muestra, voz que cierra. Si
// el inbox reordenara por tipo —todas las fotos y después los audios— estaría
// decidiendo por el vendedor cómo se cuenta lo que quiere contar.
//
// ⚠️ POR QUÉ NO ALCANZAN LAS COLUMNAS QUE YA HABÍA: `imagenes` y `audios` son dos
// listas separadas, y dos listas no pueden expresar "foto, audio, foto". Por eso
// existe `adjuntos`, una sola lista ordenada.
//
// ⚠️ Y POR QUÉ NO SE METEN LOS AUDIOS EN `imagenes`, aunque el tipo se pudiera
// deducir de la extensión: esa columna la lee el inbox de IND, que todavía no sabe
// de audios e intentaría mandarlos como fotos. Meta los rechazaría y el vendedor
// de IND no entendería por qué.

/** Cuántos adjuntos caben en una respuesta. Fotos y audios comparten el cupo. */
export const TOPE_ADJUNTOS = 10

/** ¿Esta url es un audio? Se decide por la carpeta y la extensión que ya usamos. */
export function urlEsAudio(url) {
  const u = String(url || '').toLowerCase().split('?')[0]
  return /\.(ogg|opus|mp3|m4a|aac|wav|amr)$/.test(u) || u.includes('/audios/')
}

/**
 * Los adjuntos de una respuesta, en orden y con su tipo.
 *
 * Acepta las dos formas porque conviven a propósito:
 *   · `adjuntos` — la lista ordenada (lo nuevo). Si está, MANDA.
 *   · `imagenes` — la lista vieja, solo fotos. Es lo que siguen leyendo IND y las
 *     respuestas creadas antes de esto.
 *
 * Sin el respaldo, todas las respuestas rápidas que ya existen se habrían quedado
 * sin sus fotos el día del despliegue. Una migración que borra lo que ya funciona
 * no es una migración, es una pérdida.
 */
export function adjuntosDeRespuesta(reply = {}) {
  const lista = Array.isArray(reply.adjuntos) ? reply.adjuntos : []
  if (lista.length) {
    return lista
      .map((a) => ({
        tipo: a?.tipo === 'audio' ? 'audio' : 'imagen',
        url: String(a?.url || '').trim(),
      }))
      .filter((a) => a.url)
      .slice(0, TOPE_ADJUNTOS)
  }

  // Respaldo: el formato viejo. `imageUrl`, `imageUrl2`… es como viaja hacia la
  // interfaz; `imagenes` es como está en la base.
  const viejas = Array.isArray(reply.imagenes) && reply.imagenes.length
    ? reply.imagenes
    : Array.from({ length: TOPE_ADJUNTOS }, (_, i) =>
        i === 0 ? reply.imageUrl : reply[`imageUrl${i + 1}`])

  return (viejas || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    // Aunque vengan de `imagenes`, se mira si son audio: una respuesta guardada
    // por una versión intermedia podría tener un .ogg ahí, y mandarlo como foto
    // sería un mensaje muerto.
    .map((url) => ({ tipo: urlEsAudio(url) ? 'audio' : 'imagen', url }))
    .slice(0, TOPE_ADJUNTOS)
}

/**
 * La lista ordenada → lo que se guarda en la base.
 *
 * Devuelve las DOS formas a propósito: `adjuntos` (la verdad, ordenada) y
 * `imagenes` (solo las fotos, para que IND siga viendo lo suyo). Es la misma
 * escritura doble que se usa con `conversaciones.estado`, y por el mismo motivo:
 * el otro inbox no puede quedarse sin datos hasta que migre.
 */
export function guardarAdjuntos(lista = []) {
  const limpia = (Array.isArray(lista) ? lista : [])
    .map((a) => ({
      tipo: a?.tipo === 'audio' ? 'audio' : 'imagen',
      url: String(a?.url || '').trim(),
    }))
    .filter((a) => a.url)
    .slice(0, TOPE_ADJUNTOS)

  return {
    adjuntos: limpia,
    imagenes: limpia.filter((a) => a.tipo === 'imagen').map((a) => a.url),
  }
}
