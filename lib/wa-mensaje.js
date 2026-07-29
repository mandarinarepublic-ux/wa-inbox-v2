// lib/wa-mensaje.js — Traduce un objeto de mensaje de Meta a nuestros campos.
//
// Vive acá y no dentro del webhook porque hay DOS orígenes con la misma forma:
// los mensajes entrantes (value.messages) y los echoes de lo que se manda desde
// el celular (value.message_echoes). Copiar el parser en vez de compartirlo es
// lo que produjo el bug de las fotos (206e9b0): dos caminos que hay que acordarse
// de mantener iguales.

// Normaliza el objeto `referral` de Meta (mensajes que entran desde un anuncio
// Click-to-WhatsApp). Devuelve null si no viene de una pauta.
export function normalizarReferral(r) {
  if (!r || typeof r !== 'object') return null
  const out = {
    source_type:   r.source_type || '',   // 'ad' | 'post'
    source_id:     r.source_id || '',      // ID del anuncio (o del post)
    source_url:    r.source_url || '',     // link de la pauta
    headline:      r.headline || '',       // titular del anuncio
    body:          r.body || '',           // texto del anuncio
    media_type:    r.media_type || '',     // 'image' | 'video'
    image_url:     r.image_url || '',      // creativo (imagen)
    video_url:     r.video_url || '',      // creativo (video)
    thumbnail_url: r.thumbnail_url || '',  // miniatura del creativo
    ctwa_clid:     r.ctwa_clid || '',      // click id (Conversions API)
  }
  return Object.values(out).some(Boolean) ? out : null
}

// Extrae { tipo, contenido, mediaId, contextoId, referral } según el tipo de mensaje de Meta
export function extraer(msg) {
  const contextoId = msg.context?.id || ''
  const referral   = normalizarReferral(msg.referral)
  const base = (o) => ({ ...o, contextoId, referral })
  switch (msg.type) {
    case 'text':     return base({ tipo: 'texto',     contenido: msg.text?.body || '',        mediaId: '' })
    case 'image':    return base({ tipo: 'imagen',    contenido: msg.image?.caption || '',    mediaId: msg.image?.id || '' })
    case 'video':    return base({ tipo: 'video',     contenido: msg.video?.caption || '',    mediaId: msg.video?.id || '' })
    case 'audio':    return base({ tipo: 'audio',     contenido: '',                          mediaId: msg.audio?.id || '' })
    case 'document': return base({ tipo: 'documento', contenido: msg.document?.filename || '', mediaId: msg.document?.id || '' })
    case 'sticker':  return base({ tipo: 'sticker',   contenido: '',                          mediaId: msg.sticker?.id || '' })
    case 'button':   return base({ tipo: 'texto',     contenido: msg.button?.text || '',      mediaId: '' })
    case 'interactive': {
      const i = msg.interactive || {}
      const title = i.button_reply?.title || i.list_reply?.title || ''
      return base({ tipo: 'texto', contenido: title, mediaId: '' })
    }
    case 'location': {
      const l = msg.location || {}
      return base({ tipo: 'texto', contenido: `📍 ${l.latitude},${l.longitude} ${l.name || ''}`.trim(), mediaId: '' })
    }
    default:         return base({ tipo: msg.type || 'texto', contenido: '', mediaId: '' })
  }
}
