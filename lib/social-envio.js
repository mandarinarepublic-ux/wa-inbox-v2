// lib/social-envio.js — reglas de envío del Social Inbox. Puro, sin red.

/**
 * ¿Este hilo admite fotos, productos o links de pago?
 * Solo los DM. Un comentario es PÚBLICO: Instagram no admite fotos en un
 * comentario, y un link de pago o unos datos de entrega no van a la vista de todos.
 *
 * Nota: lista de PERMISO (no bloqueo). Ante un tipo desconocido o typo, negamos
 * adjuntos. Es un asunto de privacidad: si devolvemos true por error, el sistema
 * podría publicar a la vista de todos lo que debía ser privado.
 */
export function admiteAdjuntos(tipo) {
  return String(tipo || 'DM').toUpperCase() === 'DM'
}

/**
 * ¿Este hilo es un comentario público (o su respuesta privada asociada)?
 * Única fuente de verdad para "es comentario": antes había dos criterios que
 * podían discrepar (uno para ENRUTAR el envío, otro —admiteAdjuntos, que solo
 * mira `tipo`— para las guardias de foto y LINKPAGO). Un IG con `comment_id`
 * pero sin `tipo` colaba como "DM" en la guardia y como "comentario" en el
 * ruteo: el link de pago se creaba y salía por la rama pública. Ahora ambos
 * lados preguntan lo mismo.
 *
 * Contempla las dos vías que puede venir marcado un comentario:
 *   - `tipo === 'COMENTARIO'` (como lo manda el webhook de FB, o el frontend).
 *   - IG con `comment_id` presente, aunque `tipo` no venga (como en el DM
 *     original: Instagram identifica el hilo por el comment_id, no por tipo).
 * Ante la duda (falta canal o tipo, pero hay comment_id de por medio) el OR ya
 * inclina hacia "es público" en vez de asumir DM — el lado seguro.
 */
export function esHiloPublico({ tipo, canal, comment_id } = {}) {
  const declaradoComentario = String(tipo || '').toUpperCase() === 'COMENTARIO'
  const esIG = String(canal || '').toUpperCase() === 'IG'
  return declaradoComentario || (esIG && Boolean(comment_id))
}

/**
 * Cuerpo `message` para el Send API de Meta.
 * Meta NO admite texto y adjunto en el mismo mensaje: una respuesta rápida con
 * texto y 3 fotos son 4 envíos.
 */
export function cuerpoMensajeMeta({ texto, imagen } = {}) {
  const conImagen = Boolean(imagen)
  const conTexto  = Boolean(String(texto || '').trim())
  if (conImagen && conTexto) {
    throw new Error('Meta no admite texto y adjunto en el mismo mensaje')
  }
  if (conImagen) {
    return { attachment: { type: 'image', payload: { url: String(imagen), is_reusable: true } } }
  }
  if (conTexto) return { text: String(texto) }
  throw new Error('el mensaje viene vacio')
}
