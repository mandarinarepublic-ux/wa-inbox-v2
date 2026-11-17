// lib/respuesta-simple.js — Contestar SOLO las preguntas de respuesta fija.
//
// Pedido de Rodrigo (17-nov-2026): "automático en lo simple". Lo que tiene una
// respuesta que no depende del cliente ni del producto (envío, envío al exterior,
// contra entrega, dónde está la tienda, factura) sale solo; todo lo demás sigue
// en PENDIENTES para una persona.
//
// Por qué textos FIJOS y no la IA: estas respuestas son políticas de la tienda.
// Una IA que se equivoca en "¿hacen contra entrega?" promete algo que no existe.
// Un texto fijo lo escribe Rodrigo una vez y se puede revisar.
//
// Medido sobre 30 días de MANDI (2.276 textos entrantes, 17-nov-2026):
//   · ~la mitad de los que dicen "envío" NO preguntan el costo: preguntan por SU
//     pedido ("¿cuándo llega?", "ya pagué"). Eso es posventa y va a una persona:
//     por eso EXCLUSIONES va primero y gana siempre.
//   · 79 mensajes eran solo signos ("??", "???") = clientes esperando respuesta.
//   · los bloques de datos (nombre, cédula, dirección) mencionan "factura" o
//     "envío" y NO son preguntas: más de 2 líneas → no se toca.
//
// La dirección segura es NO contestar: un falso negativo deja el chat en
// Pendientes como hoy; un falso positivo le contesta mal a un cliente.
//
// Módulo PURO (sin red ni base), igual que lib/ia-canal.js: lo que decide si un
// automatismo le escribe a un cliente tiene que poder probarse.

export const INTENCIONES = ['espera', 'contra_entrega', 'internacional', 'envio', 'ubicacion', 'factura', 'interes']

// Textos por defecto. Tono de Rodrigo: casual, humano, con los datos clave.
// Se editan en la config (inbox.automatizaciones → respuesta_simple.textos).
// Un texto vacío APAGA esa intención.
export const TEXTOS_DEFAULT = {
  espera: '¡Ya te atiendo! 🧡 Dame un momentito, estoy respondiendo varios mensajes 🙏',
  contra_entrega: 'Por ahora no trabajamos con pago contra entrega 🙏 Puedes pagar por transferencia o con link de pago, y te enviamos tu factura válida del SRI 🧡',
  internacional: '¡Sí hacemos envíos internacionales! 🌎 Van por DHL y el costo del envío es aparte, depende del país. Cuéntame a qué ciudad y qué modelos te interesan y te cotizo 😊',
  envio: '¡El envío es GRATIS a todo Ecuador! 🚚 Despachamos con Servientrega. Cuéntame qué modelo y talla te gustan y te ayudo a separarlo 🧡',
  ubicacion: '📍 Nuestra tienda está en Quito, en la Av. 6 de Diciembre y Mercurio. Y si estás en otra ciudad, el envío es gratis a todo Ecuador 🚚🧡',
  factura: '¡Claro! 🧡 Emitimos factura electrónica válida del SRI. Cuando confirmes tu pedido te pido tus datos para generarla 😊',
  // Solo COMENTARIOS de Instagram/Facebook ("precio", "info", "lo quiero"): sale como
  // respuesta PRIVADA, que abre el chat. Nunca se publica nada en el comentario.
  interes: '¡Hola! 🧡 Gracias por escribirnos. Te ayudo por aquí: ¿qué modelo te gustó y en qué talla? Te paso precio y disponibilidad 😊 El envío es gratis a todo Ecuador 🚚',
}

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Posventa, reclamos y datos: siempre a una persona. Gana sobre todo lo demás.
const EXCLUSIONES = new RegExp([
  'mi pedido', 'mi orden', 'mi compra', 'mi paquete', 'mi envio',
  'ya pague', 'ya cancele', 'esta cancelado', 'comprobante', 'transferi',
  'cuando (me )?(llega|llegaria|llegara|lo envian|la envian|me lo|me la)',
  'para (que|cuando) (fecha|dia)', 'todavia', 'aun no', 'no (me )?ha llegado', 'no llega',
  'reclamo', 'devolu', 'cambio de talla', 'cambiar la talla', 'incomplet',
  'ya (hice|realice|envie)', 'que paso', 'novedad', 'agencia', 'retirar', 'guia',
  // Tarjeta de producto ("Me interesa Chaqueta… | Envío Gratis 🐉"): el título trae
  // "envío gratis" pero lo que el cliente pide es el producto.
  'me interesa',
].join('|'))

const PAISES = '(espana|colombia|peru|bolivia|chile|mexico|usa|eeuu|estados unidos|argentina|venezuela|panama|el salvador|costa rica|guatemala|honduras|italia|portugal|francia|alemania|canada|brasil|uruguay|paraguay|republica dominicana|puerto rico|cuba)'

const REGLAS = {
  contra_entrega: /contra ?entrega/,
  internacional: new RegExp(
    `envios? internacional|envios? internacionales|(fuera del|a otro|otros) pais|fuera de(l)? ecuador|` +
    `(envian|envias|envio|envios|mandan|llegan?) (a|al|hasta|para) ${PAISES}|` +
    `(soy de|vivo en|estoy en|desde) ${PAISES}`,
  ),
  envio: new RegExp([
    'cuanto (cuesta|vale|es|sale|cobran|seria|me saldria|costaria|me costaria)[^?]{0,30}envio',
    'costo (del |de |de el )?envio', 'envio (es )?gratis', 'incluid[oa] (el )?envio',
    'incluye (el )?envio', '(hacen|tienen|realizan) envios?', 'envian (a|hasta)', 'envios? a (provincia|todo)',
    // "por servientrega" suelto es casi siempre una RESPUESTA del cliente ("por
    // servientrega está bien"), no una pregunta: solo con el verbo delante.
    '(envian|envias|es|mandan|trabajan) por servientrega',
    // ⚠️ "¿cuánto tarda el envío?" NO va acá: el texto de envío no dice tiempos.
    'envio a [a-z ]{3,25}(cual|cuanto) es el costo', 'envio[^?]{0,30}costo adicional',
  ].join('|')),
  ubicacion: new RegExp([
    'donde (estan|quedan|se encuentran|queda (la tienda|el local|su local))',
    '(esta|estan|se encuentra|se encuentran|queda|quedan) ubicad', 'donde se ubican',
    'de donde (son|es la tienda)', 'tienen (local|tienda)', 'tienda fisica', 'local fisico',
    'ubicacion de (la tienda|ustedes|su local|el local)', 'direccion de (la tienda|su local|ustedes|el local)',
  ].join('|')),
  factura: /(dan|emiten|hacen|tienen|entregan|con) factura|factura electronica|facturan/,
}

/**
 * ¿Qué pregunta simple es este texto? Devuelve la intención o null.
 * null = no es simple → lo atiende una persona (el comportamiento de siempre).
 */
export function clasificarSimple(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo) return null

  // Solo signos ("??", "...?"): el cliente está esperando. Tiene que haber un "?"
  // — un "." suelto o un emoji no es una pregunta.
  if (/^[\s?¿.!]+$/.test(crudo)) return crudo.includes('?') ? 'espera' : null

  // Bloques de datos (nombre, cédula, dirección) y textos largos: no son una
  // pregunta suelta, aunque digan "factura" o "envío".
  if (crudo.split('\n').filter((l) => l.trim()).length > 2) return null
  if (crudo.length > 160) return null

  const t = quitarTildes(crudo.toLowerCase()).replace(/\s+/g, ' ')
  if (EXCLUSIONES.test(t)) return null

  // Orden: lo más específico primero (internacional antes que envío).
  for (const intencion of ['contra_entrega', 'internacional', 'envio', 'ubicacion', 'factura']) {
    if (REGLAS[intencion].test(t)) return intencion
  }
  return null
}

/**
 * Decisión completa para un mensaje entrante. Devuelve { intencion, texto } o null.
 *
 * @param {object} args
 * @param {object} args.config       bloque respuesta_simple de automatizaciones
 * @param {string} args.canal        id lógico del canal ('MANDI' | 'REPUBLIC' | null)
 * @param {string} args.tipoCrudo    m.raw?.type — solo 'text' escrito por el cliente
 *                                   (un botón tocado llega como tipo:'texto', trampa #8)
 * @param {string} args.texto
 * @param {boolean} args.iaPrendida  el agente lleva el chat → que conteste él
 * @param {boolean} args.humanoAtendiendo  una persona está en el chat → no interrumpir
 */
export function decidirRespuestaSimple({ config, canal, tipoCrudo, texto, iaPrendida, humanoAtendiendo }) {
  if (!config?.activo) return null
  if (tipoCrudo !== 'text') return null
  if (iaPrendida || humanoAtendiendo) return null
  // Interruptor por número. Canal desconocido → NO contesta (al revés que el
  // cortafuegos de la IA): esto MANDA mensajes nuevos, y lo seguro es callar.
  if (!canal || config.canales?.[canal] === false) return null

  const intencion = clasificarSimple(texto)
  if (!intencion) return null
  if (config.intenciones?.[intencion] === false) return null

  const textos = { ...TEXTOS_DEFAULT, ...(config.textos || {}) }
  const respuesta = String(textos[intencion] || '').trim()
  if (!respuesta) return null
  return { intencion, texto: respuesta }
}

// ── COMENTARIOS (Instagram / Facebook) ─────────────────────────────────────────
// Medido sobre 60 días de comentarios de IG (17-nov-2026): lo que más se repite es
// interés de compra ("precio", "info", "quiero uno", "cuánto") y preguntas de envío
// al exterior. También hay RECLAMOS públicos ("me estafaron…"): esos nunca se
// contestan solos, los ve una persona.

const RECLAMO = /(estaf|robo|robaron|reclamo|legal|denunci|devuel|no (me )?(contestan|responden|dan)|mal servicio|que mal|pesimo|nunca llego|no llego|hasta la fecha)/

const INTERES = /^(hola |buenas |buen dia |buenos dias |buenas tardes |buenas noches )?(precio|precios|info|informacion|cuanto|cuanto cuesta|cuanto vale|valor|costo|quiero|lo quiero|la quiero|yo quiero|quiero (uno|una|1|el mio|la mia)|necesito (uno|una)|me interesa|tallas?|que tallas (tienen|hay)|hasta (que|q) talla|disponible|como (lo|la) (compro|consigo|pido)|donde (lo|la) compro)\b/

/** Intención de un COMENTARIO, o null (lo atiende una persona). */
export function clasificarComentario(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo || crudo.length > 160) return null
  const t = quitarTildes(crudo.toLowerCase()).replace(/@\S+/g, '').replace(/[¿?¡!.,]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || RECLAMO.test(t)) return null
  // Primero las de respuesta fija (envío al exterior, tienda…). "??" no aplica a
  // un comentario: no hay nadie "esperando" en un post.
  const fija = clasificarSimple(crudo)
  if (fija && fija !== 'espera') return fija
  return INTERES.test(t) ? 'interes' : null
}

/**
 * Decisión para un comentario entrante. Devuelve { intencion, texto } o null.
 * Se prende aparte de WhatsApp (`comentarios_activo`): son públicos y otra red.
 */
export function decidirRespuestaComentario({ config, texto, esNuevo = true }) {
  if (!config?.activo || !config?.comentarios_activo) return null
  if (!esNuevo) return null // un comentario EDITADO no se contesta otra vez
  const intencion = clasificarComentario(texto)
  if (!intencion) return null
  if (config.intenciones?.[intencion] === false) return null
  const textos = { ...TEXTOS_DEFAULT, ...(config.textos || {}) }
  const respuesta = String(textos[intencion] || '').trim()
  return respuesta ? { intencion, texto: respuesta } : null
}
