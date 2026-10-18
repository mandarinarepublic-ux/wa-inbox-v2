// lib/social-adjuntos.js — adjuntos de un DM de Messenger/Instagram → etiqueta + URL.
// Puro, sin red, para poder probarlo.

const ETIQUETAS = {
  image: '📷 Foto', video: '🎥 Video', audio: '🎤 Audio',
  file: '📎 Archivo', share: '🔗 Enlace', story_mention: '📸 Te mencionó en su historia',
  // Foto/video TEMPORAL ("ver una vez" / "permitir volver a ver"): Meta NO manda el
  // contenido por la API, solo avisa que llegó. Antes se descartaba el mensaje entero
  // en silencio y el cliente quedaba sin respuesta (18-oct-2026).
  ephemeral: '⏳ Mandó una foto o video TEMPORAL — Meta no deja verlo aquí. Pídele que lo mande normal (sin "ver una vez")',
}

/**
 * Adjuntos (foto, video, audio, sticker, respuesta a historia). Meta manda una URL
 * firmada temporal: la guardamos igual para no perder el mensaje.
 * Un tipo desconocido NO devuelve vacío: cae a `📎 tipo`, visible y diagnosticable.
 */
export function deAdjuntos(adjuntos) {
  const a = adjuntos?.[0]
  if (!a) return { etiqueta: '', url: '' }
  const url  = a.payload?.url || ''
  const tipo = String(a.type || '').toLowerCase()
  return { etiqueta: ETIQUETAS[tipo] || `📎 ${tipo || 'adjunto'}`, url }
}
