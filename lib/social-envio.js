// lib/social-envio.js — reglas de envío del Social Inbox. Puro, sin red.

/**
 * ¿Este hilo es un comentario público (o su respuesta privada asociada)?
 * Única fuente de verdad para "es comentario": antes había dos criterios que
 * podían discrepar (uno para ENRUTAR el envío, otro —que solo miraba `tipo`—
 * para las guardias de foto y LINKPAGO). Un IG con `comment_id` pero sin
 * `tipo` colaba como "DM" en la guardia y como "comentario" en el ruteo: el
 * link de pago se creaba y salía por la rama pública. Ahora ambos lados
 * preguntan lo mismo.
 *
 * Contempla las dos vías que puede venir marcado un comentario:
 *   - `tipo === 'COMENTARIO'` (como lo manda el webhook de FB, o el frontend).
 *   - IG con `comment_id` presente, aunque `tipo` no venga (como en el DM
 *     original: Instagram identifica el hilo por el comment_id, no por tipo).
 * Cualquier otra combinación da false, incluido un FB con `comment_id` pero
 * sin `tipo`: se trata como DM (privado), que es el lado seguro porque un
 * envío privado nunca expone al cliente, y publicar sí.
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
export function cuerpoMensajeMeta({ texto, imagen, audio, archivo } = {}) {
  const conTexto  = Boolean(String(texto || '').trim())
  const adjunto = imagen ? ['image', imagen] : audio ? ['audio', audio] : archivo ? ['file', archivo] : null
  if (adjunto && conTexto) {
    throw new Error('Meta no admite texto y adjunto en el mismo mensaje')
  }
  if (adjunto) {
    return { attachment: { type: adjunto[0], payload: { url: String(adjunto[1]), is_reusable: true } } }
  }
  if (conTexto) return { text: String(texto) }
  throw new Error('el mensaje viene vacio')
}

// Formatos que Meta acepta por Messenger/Instagram (doc de "Send a message" de
// Instagram): audio aac/m4a/wav/mp4, archivo SOLO pdf. ☠️ La nota de voz del inbox
// se graba en .ogg (lo que pide WhatsApp): esa SÍ sale, porque el servidor la
// convierte a .m4a al mandarla (lib/audio-meta.js).
const AUDIO_META = /\.(aac|m4a|wav|mp4|ogg|opus)$/
const ARCHIVO_META = /\.pdf$/

/**
 * ¿Este adjunto de una respuesta rápida se puede mandar por FB/IG?
 * Devuelve el campo con el que va al servidor, o el motivo por el que no sale
 * (para AVISARLO: antes los audios se saltaban sin decir nada).
 */
export function adjuntoParaMeta({ tipo, url } = {}) {
  const u = String(url || '').toLowerCase().split('?')[0]
  if (tipo === 'imagen') return { campo: 'imagen' }
  if (tipo === 'audio') {
    return AUDIO_META.test(u)
      ? { campo: 'audio' }
      : { motivo: 'audio en un formato que Instagram y Facebook no aceptan' }
  }
  return ARCHIVO_META.test(u)
    ? { campo: 'archivo' }
    : { motivo: 'documento: por Instagram y Facebook solo salen PDF' }
}

/**
 * Link para abrir ESTA conversación en Meta Business Suite, cuando el inbox no
 * puede responder (p. ej. code 10: a `pages_messaging` le falta el App Review y
 * Meta solo deja escribirle a quien tiene rol en la app). Desde Business Suite
 * se contesta igual, con la misma página.
 * `selected_item_id` abre el hilo del cliente (PSID en FB, IGSID en IG); si
 * Business Suite no lo encuentra, cae en la bandeja de la página, que también
 * sirve. Sin id de página no hay a dónde mandar: devuelve ''.
 */
export function enlaceBusinessSuite({ canal, sender_id, pageId } = {}) {
  if (!pageId) return ''
  const esIG = String(canal || '').toUpperCase() === 'IG'
  const p = new URLSearchParams({ asset_id: String(pageId), mailbox_id: String(pageId) })
  if (sender_id) {
    p.set('selected_item_id', String(sender_id))
    p.set('thread_type', esIG ? 'IG_MESSAGE' : 'FB_MESSAGE')
  }
  return `https://business.facebook.com/latest/inbox/all?${p}`
}
