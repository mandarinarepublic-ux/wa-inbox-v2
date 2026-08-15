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

// Formatea un monto con su moneda. La moneda SIEMPRE sale del payload de Meta
// (item.currency) — nunca se asume USD, aunque en la práctica casi todo lo sea.
function formatearMonto(monto, moneda) {
  const n = Number(monto) || 0 // item_price puede venir 0 (producto de catálogo sin precio) o ausente
  const cur = String(moneda || 'USD').toUpperCase()
  const simbolo = cur === 'USD' ? '$' : `${cur} `
  return `${simbolo}${n.toFixed(2)}`
}

// Arma el texto legible de un pedido de catálogo (msg.type === 'order') para que
// se pinte en el chat sin más trabajo de UI: la burbuja ya sabe mostrar `mensaje`
// como texto plano. `product_retailer_id` es el ÚNICO identificador que manda
// Meta — se muestra tal cual, nunca se inventa un nombre de producto.
//
// Nunca debe reventar: un pedido con 0 artículos o con item_price en 0 (pasó de
// verdad: un producto de catálogo sin precio cargado) tiene que igual pintarse,
// no desaparecer.
export function formatearPedido(order = {}) {
  const items = Array.isArray(order.product_items) ? order.product_items : []
  const totalCant  = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0)
  const totalMonto = items.reduce((acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.item_price) || 0), 0)
  const moneda = items[0]?.currency || 'USD'
  const lineas = items.map((it) => {
    const cant = Number(it.quantity) || 0
    const precio = formatearMonto(it.item_price, it.currency || moneda)
    return `   • ${cant} × ${precio}  (${it.product_retailer_id || ''})`
  })
  const encabezado = `📦 Pedido del catálogo — ${totalCant} artículo${totalCant === 1 ? '' : 's'} · ${formatearMonto(totalMonto, moneda)}`
  const nota = String(order.text || '').trim() // nota que el cliente escribió junto al pedido
  const partes = [encabezado, ...lineas]
  if (nota) partes.push(`   📝 ${nota}`)
  return partes.join('\n')
}

// Deriva el `contenido` legible de los tipos que NO dependen de texto libre del
// cliente (order/unsupported/system). Dos caminos lo usan: la ingestión (acá
// abajo, con el `msg` completo tal cual lo manda Meta) y la LECTURA de filas
// viejas que se guardaron con `texto` vacío, antes de que este archivo derivara
// la etiqueta (lib/inbox-supabase.js → toMensaje, con el `raw` que se guardó en
// la fila). Un solo lugar para el formato: si los dos caminos divergieran, la
// lista y el hilo dirían cosas distintas del mismo mensaje.
//
// `datos` es el objeto de Meta para ese tipo (`msg` al ingerir, `raw` al leer).
// Puede venir vacío/null — las filas de antes del respaldo crudo (16-jul-2026)
// no tienen `raw` — y acá se entrega una etiqueta genérica, nunca revienta ni
// esconde el mensaje.
export function contenidoTipoEspecial(tipo, datos) {
  const d = datos || {}
  switch (tipo) {
    // Igual que en ingestión: si el pedido no vino (fila vieja sin `raw`), una
    // etiqueta genérica sin detalle en vez de "0 artículos · $0.00".
    case 'order':
      return d.order ? formatearPedido(d.order) : '📦 Pedido del catálogo'
    case 'unsupported': {
      const titulo = d.errors?.[0]?.title ? ` (${d.errors[0].title})` : ''
      return `⚠️ Te escribió algo que no podemos mostrar${titulo}`
    }
    case 'system':
      return 'ℹ️ Aviso de WhatsApp'
    default:
      return ''
  }
}

// Extrae { tipo, contenido, mediaId, contextoId, referral } según el tipo de mensaje de Meta
//
// ⚠️ TERCERA VEZ que este mismo filtro se come mensajes de verdad (antes: fotos
// sin caption, notas de voz). Acá la regla que vale para SIEMPRE: "sin texto" NO
// significa "no pasó nada". Si Meta manda un tipo con contenido real (order) o un
// tipo donde igual escribió una persona (unsupported, system), este extractor le
// arma un `contenido` no vacío A PROPÓSITO — así el filtro de "¿hay algo que
// pintar?" en lib/inbox-supabase.js lo deja pasar solo, sin tener que conocer
// estos tipos especiales.
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
    // Pedido armado desde el catálogo de WhatsApp. A diferencia de `unsupported`,
    // Meta SÍ manda todo el contenido — lo que faltaba era leerlo.
    case 'order':    return base({ tipo: 'order', contenido: contenidoTipoEspecial('order', msg), mediaId: '' })
    // Meta no pudo entregar el contenido (nota: no es que nosotros no lo leemos,
    // es que Meta mismo no lo manda). Igual escribió una persona → tiene que
    // aparecer. Si el payload trae el motivo (errors[0].title), se lo agregamos.
    case 'unsupported': return base({ tipo: 'unsupported', contenido: contenidoTipoEspecial('unsupported', msg), mediaId: '' })
    // Aviso de WhatsApp (p.ej. el cliente cambió de número). No es una persona
    // escribiendo, pero tampoco es "nada": se etiqueta para que quede constancia.
    case 'system':   return base({ tipo: 'system', contenido: contenidoTipoEspecial('system', msg), mediaId: '' })
    default:         return base({ tipo: msg.type || 'texto', contenido: '', mediaId: '' })
  }
}
