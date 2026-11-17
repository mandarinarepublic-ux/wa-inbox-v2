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

export const INTENCIONES = ['espera', 'contra_entrega', 'internacional', 'pago', 'envio', 'tiempo_entrega', 'ubicacion', 'horario', 'retiro_tienda', 'cambio_talla', 'colores', 'factura', 'tallas', 'interes']

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
  pago: 'Con respecto al pago tenemos: 📱 App Deuna, 🏦 transferencia (Pichincha, Guayaquil o Produbanco) y 💳 tarjeta de crédito. ¿Cuál prefieres? 🧡',
  tallas: '📐 Manejamos tallas desde XS hasta 2XL (depende del modelo). ¿Para qué prenda la necesitas: hoodie, chaqueta o camiseta? Te paso la guía de tallas 😊',
  // Políticas que dio Rodrigo el 17-nov-2026 (análisis de preguntas frecuentes).
  tiempo_entrega: '⏱️ El tiempo de entrega es de 72 horas laborables, con envío gratis por Servientrega a todo Ecuador 🚚 ¿A qué ciudad te lo enviamos?',
  horario: '🕚 Atendemos en la tienda de lunes a domingo, de 11:00 a 18:00. 📍 Av. 6 de Diciembre y Mercurio, Quito 🧡',
  retiro_tienda: '¡Claro que sí! 🧡 Puedes retirar tu pedido en nuestra tienda y pagar ahí mismo. 📍 Av. 6 de Diciembre y Mercurio, Quito. 🕚 Lunes a domingo, de 11:00 a 18:00.',
  cambio_talla: 'Sí se puede cambiar la talla 🧡 Solo necesitamos que nos devuelvas la prenda en las mismas condiciones. El cambio toma 72 horas laborables desde que nos llega la prenda.',
  colores: '🎨 Los colores de cada modelo los ves en sus fotos y en mandarinaec.com. Y como somos expertos personalizando, ¡podemos hacerlo en el color que quieras! Cuéntame qué modelo y qué color tienes en mente 😊',
  // Solo COMENTARIOS de Instagram/Facebook ("precio", "info", "lo quiero"): sale como
  // respuesta PRIVADA, que abre el chat. Nunca se publica nada en el comentario.
  interes: '¡Hola! 🧡 Gracias por escribirnos. Te ayudo por aquí: ¿qué modelo te gustó y en qué talla? Te paso precio y disponibilidad 😊 El envío es gratis a todo Ecuador 🚚',
}

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Posventa, reclamos y datos: siempre a una persona. Gana sobre todo lo demás.
const EXCLUSIONES = new RegExp([
  'mi pedido', 'mi orden', 'mi compra', 'mi paquete', 'mi envio',
  'ya pague', 'ya cancele', 'esta cancelado', 'comprobante',
  // "transferi" a secas atrapaba "transferencia" (sin tildes es el mismo prefijo).
  '(ya|le|te|les) transferi\\b', 'ya (le |te )?deposite',
  'cuando (me )?(llega|llegaria|llegara|lo envian|la envian|me lo|me la)',
  'para (que|cuando) (fecha|dia)', 'todavia', 'aun no', 'no (me )?ha llegado', 'no llega',
  'reclamo', 'devolu', 'cambiar la talla', 'incomplet',
  'ya (hice|realice|envie)', 'que paso', 'novedad', 'agencia', 'retirar(?!(la|lo)? en (la |el )?(tienda|local))',
  // la guía de Servientrega es posventa; la guía de TALLAS no.
  'guia(?! de tallas)',
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
  pago: new RegExp([
    'formas? de pago', 'metodos? de pago', 'como (puedo |se puede |se |le |te )?(pago|pagar|paga|cancelo)',
    '(aceptan|reciben|puedo pagar con|se puede pagar con|pagar con|pago con|cobran con) tarjeta',
    'aceptan (transferencia|deuna)', 'donde (deposito|transfiero|realizo el deposito|hago el deposito)',
    '(numero|datos) de (la )?cuenta', 'con tarjeta', 'tarjeta de credito', 'diferir', 'diferido',
  ].join('|')),
  tiempo_entrega: /cuanto (tiempo )?(se )?(tarda|demora)|en cuanto tiempo|cuantos dias|tiempo de (entrega|envio|elaboracion)/,
  horario: /horario|a que hora (abren|cierran|atienden)|hasta que hora (atienden|abren|estan)|(hoy|manana) (atienden|abren)|atienden (hoy|manana|los |el |sabado|domingo|feriado)|abren (hoy|manana|los |el |sabado|domingo|feriado)/,
  retiro_tienda: /retir(o|ar|arlo|arla) en (la |el )?(tienda|local)|(pagar|pago|cancelar) en (la |el )?(tienda|local)|(comprar|comprarla|comprarlo) en (la |el )?(tienda|local)/,
  cambio_talla: /si no me queda|hacen cambios|tienen cambios|aceptan cambios|se puede cambiar|puedo cambiar(la|lo)? si|cambio de talla|politica de cambio/,
  colores: /que colores|en que colores|otros colores|mas colores|colores (tienen|tiene|hay|disponibles|manejan)/,
  // "talla L" (el cliente DICE su talla) no es pregunta: solo con forma de pregunta.
  tallas: new RegExp([
    'que tallas', 'tallas (tienen|tiene|hay|manejan|disponibles)', '(guia|tabla) de tallas',
    'hasta (que|q) talla', '(tienen|tiene|hay) (en )?talla', 'que talla (me|le|seria|sera|debo|uso|pido)',
    'hay tallas',
  ].join('|')),
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
  for (const intencion of ['contra_entrega', 'internacional', 'retiro_tienda', 'pago', 'cambio_talla', 'tiempo_entrega', 'envio', 'horario', 'ubicacion', 'factura', 'colores', 'tallas']) {
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
export function decidirRespuestaSimple({ config, canal, tipoCrudo, texto, iaPrendida, humanoAtendiendo, prenda = null }) {
  if (!config?.activo) return null
  if (tipoCrudo !== 'text') return null
  if (iaPrendida || humanoAtendiendo) return null
  // Interruptor por número. Canal desconocido → NO contesta (al revés que el
  // cortafuegos de la IA): esto MANDA mensajes nuevos, y lo seguro es callar.
  if (!canal || config.canales?.[canal] === false) return null

  const intencion = clasificarSimple(texto)
  if (!intencion) return null
  if (config.intenciones?.[intencion] === false) return null

  return conRespuesta(config, intencion, prenda)
}

/**
 * Qué se manda para una intención: la RESPUESTA RÁPIDA asignada (pedido de Rodrigo,
 * 17-nov-2026: "usa las respuestas rápidas, siempre") y, solo si no hay ninguna
 * asignada, el texto de respaldo. Para tallas, la guía de la prenda de la que se
 * está hablando (`tallas_hoodie`, `tallas_chaqueta`, `tallas_camiseta`); sin
 * prenda clara, la de `tallas` (que pregunta cuál).
 */
function conRespuesta(config, intencion, prenda) {
  const mapa = config?.respuestas || {}
  const respuestaId = String(
    (intencion === 'tallas' && prenda && mapa[`tallas_${prenda}`]) || mapa[intencion] || '',
  ).trim()
  const textos = { ...TEXTOS_DEFAULT, ...(config?.textos || {}) }
  const texto = String(textos[intencion] || '').trim()
  if (!respuestaId && !texto) return null
  return { intencion, respuestaId, texto }
}

// "chompa" en Ecuador sirve para chaqueta, buzo y hoodie: no decide la prenda.
const PRENDAS = [
  ['hoodie', /\b(hoodies?|hoddies?|hodies?|joggers?|buzos?|sudaderas?|capucha)\b/],
  ['chaqueta', /\b(chaquetas?|casacas?|rompevientos|bomber)\b/],
  ['camiseta', /\b(camisetas?|camisas?|poleras?|t-?shirts?|jerseys?)\b/],
]

/**
 * ¿De qué prenda se habla? Mira los textos del más nuevo al más viejo y se queda
 * con la PRIMERA prenda que aparezca. null si ninguna.
 */
export function prendaDe(textos = []) {
  for (const x of textos) {
    const t = quitarTildes(String(x || '').toLowerCase())
    for (const [prenda, re] of PRENDAS) if (re.test(t)) return prenda
  }
  return null
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
  // En un comentario solo sale TEXTO (Meta deja una sola respuesta privada): el
  // webhook usa el texto de la respuesta rápida asignada y no manda sus fotos.
  return conRespuesta(config, intencion, null)
}

/**
 * ¿Hay una PERSONA en este chat? Se mira `ultimo_humano_at`, que solo marca
 * /api/saliente cuando escribe alguien desde el inbox (sin `auto`).
 *
 * ☠️ NO usar `ultimo_mensaje_at`: lo mueve CUALQUIER saliente, incluido el saludo
 * automático. Así fue la primera versión (17-nov-2026): el "Bienvenid@ a
 * Mandarina" contaba como persona atendiendo y callaba las respuestas simples
 * 24 h a todo cliente nuevo. Lo descubrió la primera prueba real de Rodrigo.
 */
export const HORAS_PERSONA_EN_CHAT = 3
export function personaEnElChat(ultimoHumanoAt, ahora = Date.now(), horas = HORAS_PERSONA_EN_CHAT) {
  const t = ultimoHumanoAt ? Date.parse(ultimoHumanoAt) : NaN
  if (!Number.isFinite(t)) return false
  return ahora - t < horas * 3600_000
}
