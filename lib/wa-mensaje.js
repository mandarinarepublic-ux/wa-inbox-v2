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
// cliente (order/unsupported/system/...). Dos caminos lo usan: la ingestión
// (acá abajo, con el `msg` completo tal cual lo manda Meta) y la LECTURA de
// filas viejas que se guardaron con `texto` vacío, antes de que este archivo
// derivara la etiqueta (lib/inbox-supabase.js → toMensaje, con el `raw` que se
// guardó en la fila). Un solo lugar para el formato: si los dos caminos
// divergieran, la lista y el hilo dirían cosas distintas del mismo mensaje.
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
    // Aviso de WhatsApp. El que llega de verdad es el CAMBIO DE NÚMERO: Meta avisa
    // que la persona se mudó a otro teléfono. Decía solo "Aviso de WhatsApp" —
    // sin qué pasó ni a qué número— y esa fila se quedaba en la bandeja como si
    // alguien esperara respuesta. Medido el 4-sep-2026: 38 cambios, 31 en el
    // último mes (35 de ellos en IND).
    //
    // ⚠️ El historial de esa persona QUEDA PARTIDO: lo viejo bajo el número
    // anterior, lo nuevo bajo el otro, y nadie los conecta. Enlazarlos es otra
    // tarea; esto al menos deja dicho a dónde se fue.
    case 'system': {
      const sys = d.system || {}
      if (sys.type === 'user_changed_number') {
        const nuevo = sys.wa_id || ''
        const viejo = String(sys.body || '').match(/from\s+(\d+)/)?.[1] || ''
        if (viejo && nuevo) return `🔄 Cambió de número: ${viejo} → ${nuevo}`
        // Sin los dos datos se muestra lo que Meta mandó, tal cual. Nunca se inventa.
        if (sys.body) return `🔄 ${sys.body}`
      }
      // Cualquier otro aviso (o uno que WhatsApp invente mañana): el texto de
      // Meta si lo hay, y si no la etiqueta de siempre. NUNCA vacío: si es el
      // último mensaje del chat, un texto vacío borra la conversación de la lista.
      return sys.body ? `ℹ️ ${sys.body}` : 'ℹ️ Aviso de WhatsApp'
    }
    // Reacción a un mensaje (👍❤️😂...). El emoji vive en datos.reaction.emoji;
    // sin payload (fila vieja sin `raw`, o la consulta de polling que no lo
    // trae — ver COLS_MSG en inbox-supabase.js) se muestra la etiqueta pelada,
    // nunca se inventa un emoji.
    case 'reaction': {
      const emoji = d.reaction?.emoji || ''
      return emoji ? `${emoji} Reaccionó a un mensaje` : 'Reaccionó a un mensaje'
    }
    case 'edit':
      return '✏️ Editó un mensaje'
    case 'revoke':
      return '🚫 Eliminó un mensaje'
    case 'contacts': {
      const nombre = d.contacts?.[0]?.name?.formatted_name || ''
      return nombre ? `👤 Compartió un contacto (${nombre})` : '👤 Compartió un contacto'
    }
    // Defensivo: hoy extraer() etiqueta la ubicación como tipo 'texto' con el
    // contenido ya armado (lat/lon, ver más abajo), así que este caso no
    // dispara desde la ingestión actual. Queda acá por si algún día una fila
    // llega con tipo 'location' literal — mismo principio: nombrar el tipo,
    // no esconderlo.
    case 'location': {
      const l = d.location || {}
      const detalle = [l.name, l.address].filter(Boolean).join(', ')
      return detalle ? `📍 Compartió su ubicación (${detalle})` : '📍 Compartió su ubicación'
    }
    // Los tipos con media propio NO necesitan etiqueta de texto: la burbuja ya
    // los pinta por mediaId/mediaUrl (ver hasMedia en Components.jsx) y
    // esPintable los deja pasar por ese lado. Ponerles la etiqueta genérica de
    // abajo los mostraría con un texto de más pegado a la foto/audio/video.
    case 'imagen':
    case 'video':
    case 'audio':
    case 'documento':
    case 'sticker':
      return ''
    // CUARTA VEZ que el filtro de "¿hay algo que pintar?" (esPintable, en
    // lib/inbox-supabase.js) se come conversaciones enteras por un tipo sin
    // etiqueta: antes fotos sin caption, notas de voz, order/unsupported/
    // system — ahora reaction/edit/revoke/contacts y hasta un 'texto' que
    // llegó de verdad vacío (bug real, MANDI). SE ACABÓ LA LISTA: la regla de
    // ahora en adelante es "sin contenido nunca significa invisible". Cualquier
    // tipo sin caso explícito arriba —conocido con el cuerpo vacío, o uno que
    // WhatsApp todavía no inventó— cae acá y sale con una etiqueta que nombra
    // el tipo: visible Y diagnosticable. El próximo tipo raro NO necesita un
    // caso nuevo para dejar de esconder a la persona; solo lo necesita si se
    // quiere un texto más lindo que este genérico.
    default:
      return `💬 Mensaje (${tipo || 'desconocido'})`
  }
}

// Extrae { tipo, contenido, mediaId, contextoId, referral } según el tipo de mensaje de Meta
//
// ⚠️ CUARTA VEZ que este mismo filtro se come mensajes de verdad (antes: fotos
// sin caption, notas de voz, order/unsupported/system). Acá la regla que vale
// para SIEMPRE: "sin texto" NO significa "no pasó nada". Si Meta manda un tipo
// con contenido real (order) o un tipo donde igual pasó algo (reaction, edit,
// revoke, contacts, unsupported, system) o hasta un tipo que nadie previó
// todavía, este extractor le arma un `contenido` no vacío A PROPÓSITO — así el
// filtro de "¿hay algo que pintar?" en lib/inbox-supabase.js lo deja pasar
// solo, sin tener que conocer estos tipos especiales. Ver contenidoTipoEspecial
// más arriba: el default de esa función es el que cierra el ciclo.
export function extraer(msg) {
  // A QUÉ mensaje se refiere esto.
  //
  // ☠️ Meta lo manda en DOS campos distintos según el tipo: una respuesta citada
  // lo trae en `context.id`, pero una REACCIÓN lo trae en `reaction.message_id`.
  // Mirar solo `context.id` dejaba las reacciones huérfanas: se veía "❤️ Reaccionó
  // a un mensaje" y no había forma de saber a cuál. El dato SIEMPRE estuvo; lo
  // que faltaba era leer el campo correcto.
  //
  // Va al MISMO `contextoId` que una cita a propósito: así la reacción se pinta
  // con la interfaz de citas que existe desde julio, sin UI nueva.
  //
  // `context` gana si vinieran los dos: es el campo canónico de "a qué respondo";
  // `reaction.message_id` es el atajo de ese tipo.
  const contextoId = msg.context?.id || msg.reaction?.message_id || ''
  const referral   = normalizarReferral(msg.referral)
  const base = (o) => ({ ...o, contextoId, referral })
  switch (msg.type) {
    // El texto en sí casi nunca llega vacío, pero pasó de verdad (bug #4,
    // MANDI): si `body` viene vacío, contenidoTipoEspecial da la etiqueta
    // genérica en vez de guardar `texto` en blanco.
    case 'text':     return base({ tipo: 'texto',     contenido: msg.text?.body || contenidoTipoEspecial('texto', msg), mediaId: '' })
    case 'image':    return base({ tipo: 'imagen',    contenido: msg.image?.caption || '',    mediaId: msg.image?.id || '' })
    case 'video':    return base({ tipo: 'video',     contenido: msg.video?.caption || '',    mediaId: msg.video?.id || '' })
    case 'audio':    return base({ tipo: 'audio',     contenido: '',                          mediaId: msg.audio?.id || '' })
    case 'document': return base({ tipo: 'documento', contenido: msg.document?.filename || '', mediaId: msg.document?.id || '' })
    case 'sticker':  return base({ tipo: 'sticker',   contenido: '',                          mediaId: msg.sticker?.id || '' })
    case 'button':   return base({ tipo: 'texto',     contenido: msg.button?.text || contenidoTipoEspecial('texto', msg), mediaId: '' })
    case 'interactive': {
      const i = msg.interactive || {}
      const title = i.button_reply?.title || i.list_reply?.title || ''
      return base({ tipo: 'texto', contenido: title || contenidoTipoEspecial('texto', msg), mediaId: '' })
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
    // Cualquier tipo sin caso explícito arriba: reaction, edit, revoke,
    // contacts, o uno que WhatsApp invente mañana. Antes esto guardaba
    // `contenido: ''` — si ese mensaje resultaba ser el ÚLTIMO de la
    // conversación, eso hacía desaparecer al cliente entero del sidebar.
    // Ahora nunca se guarda vacío: contenidoTipoEspecial siempre entrega una
    // etiqueta, para el tipo que sea.
    default:         return base({ tipo: msg.type || 'texto', contenido: contenidoTipoEspecial(msg.type, msg) || '', mediaId: '' })
  }
}

// ── UBICACIONES ──────────────────────────────────────────────────
//
// Una ubicación de WhatsApp se guarda como `tipo: 'texto'` con el contenido
// "📍 lat,lon nombre" (ver extraer, más arriba). Eso deja al cliente mirando
// coordenadas pelonas en el chat. parseUbicacion la reconoce AL LEER para que
// la burbuja pinte una tarjeta con enlace a Google Maps.
//
// Se reconoce al leer y no al guardar A PROPÓSITO: así vale igual para los
// mensajes que ya están en la base desde julio, sin migración ni backfill.
//
// ☠️ EL ANCLA SON LAS COORDENADAS, NUNCA EL EMOJI SOLO. El saludo automático
// de la tienda ("📍 Estamos en Quito: Av. 6 de Diciembre…") también empieza con
// 📍 y hay 173 de esos en la base. Un `texto.startsWith('📍')` los pintaría
// todos como un mapa a coordenadas inventadas. Hay una prueba en
// tests/wa-mensaje.test.js que se rompe si alguien afloja este patrón.
const RE_UBICACION = /^\u{1F4CD}\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[ \t]+(.*))?$/u

const armarUbicacion = (lat, lon, nombre, direccion) => ({
  lat, lon, nombre, direccion,
  // Formato oficial de Google: en compu abre Maps web, en celular abre la app.
  url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
})

export function parseUbicacion(texto, raw) {
  // `raw.location` es la fuente buena: trae `address`, que el texto guardado no
  // tiene (extraer solo le pega el `name`). El hilo del chat ya consulta con
  // COLS_MSG_RAW, así que en la burbuja casi siempre está.
  const l = raw?.location
  if (l && l.latitude != null && l.longitude != null) {
    return armarUbicacion(String(l.latitude), String(l.longitude), l.name || '', l.address || '')
  }
  // Sin `raw` —la vista de la barra lateral no lo expone, y el respaldo crudo
  // arrancó el 16-jul-2026— las coordenadas igual viven en el texto.
  const m = typeof texto === 'string' ? texto.match(RE_UBICACION) : null
  if (!m) return null
  return armarUbicacion(m[1], m[2], (m[3] || '').trim(), '')
}
