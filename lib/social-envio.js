// lib/social-envio.js — reglas de envío del Social Inbox. Puro, sin red.

/**
 * ¿Este hilo admite fotos, productos o links de pago?
 * Solo los DM. Un comentario es PÚBLICO: Instagram no admite fotos en un
 * comentario, y un link de pago o unos datos de entrega no van a la vista de todos.
 */
export function admiteAdjuntos(tipo) {
  return String(tipo || 'DM').toUpperCase() !== 'COMENTARIO'
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
