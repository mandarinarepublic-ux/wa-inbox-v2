// lib/bandeja.js — las reglas de "por cuál número va esta conversación".
//
// ⚠️ LA REGLA QUE ESTE ARCHIVO EXISTE PARA SOSTENER:
//
//     La ventana de 24 h de WhatsApp es por par (cliente ↔ número NUESTRO).
//     NO por cliente.
//
// `inbox.conversaciones` tiene UNA fila por persona: ahí viven su nombre, su
// temperatura, sus notas y su venta, y está bien que sea una sola porque el lead
// es el mismo escriba por donde escriba. Lo que NO puede vivir ahí es "¿le
// contesté?" y "¿está abierta la ventana?": esas dos preguntas tienen una
// respuesta distinta por cada número.
//
// Lo que costó no tenerlo (medido el 19-ago-2026):
//   · 19-ago: un cliente escribió por REPUBLIC y tres respuestas salieron por
//     MANDI. Meta las rechazó con 131047 ("more than 24 hours have passed since
//     the customer last replied to THIS number"). El vendedor las vio salir.
//   · 16-ago: seis mensajes seguidos muertos a alguien que NUNCA había escrito
//     a ese número.
//   · 3 de cada 4 episodios de fallidos en 14 días son esto, no ventana cerrada
//     de verdad: en los tres el OTRO número tenía la ventana abierta.
//
// El archivo es puro a propósito (no habla con Supabase): así la regla se puede
// probar sin base de datos, que es justo lo que faltaba — no había NI UNA prueba
// multi-número en el repo y por eso esta familia llegó a producción cinco veces.
//
// ⚠️ NO agregar acá una función que lea la tabla `bandeja` entera. Se hizo el
// 19-ago y degradó el inbox: +142 kB y 6 viajes de red por ciclo de polling, en
// la ruta que ya es el 47 % del consumo de Vercel. El estado de bandeja viaja
// PEGADO a cada fila de la lista (vista `inbox.lista_bandeja`).

/** Ventana de servicio de WhatsApp: 24 h desde el último mensaje DEL CLIENTE. */
export const VENTANA_MS = 24 * 60 * 60 * 1000

/**
 * Por cuál número sale lo que se está enviando.
 *
 * Manda la CONVERSACIÓN, no la pestaña. Esa es toda la regla, y es lo que permite
 * trabajar como se trabaja de verdad:
 *
 *   "en general respondo y solo cambia el número"
 *
 * En la bandeja GENERAL conviven los dos números, así que la pestaña no puede
 * decidir: no sabe de cuál de las dos conversaciones del cliente se trata. La
 * fila sí lo sabe, porque la lista da una fila por (cliente, número).
 *
 * El primer intento resolvió esto al revés —mandaba al vendedor a la pestaña del
 * número— y además de sacarlo de la cola única, cada clic recargaba el inbox
 * entero. La pestaña no tiene que moverse: lo único que cambia es el número.
 *
 * NUNCA devuelve vacío: un `Canal` vacío cae al número principal en silencio (ver
 * `canalDe` en /api/saliente), que es exactamente cómo mueren los mensajes.
 */
export function canalDeEnvio({ conversacion, pestana, porDefecto } = {}) {
  return String(conversacion || pestana || porDefecto || '')
}

/**
 * ¿Se le puede escribir libremente a este cliente POR ESTE NÚMERO?
 *
 * `ultimoEntranteDelCanal` tiene que ser el del canal, no el de la persona: la
 * ficha del cliente mezcla los dos números y por eso decía "abierta" cuando el
 * cliente había escrito hace un rato por el OTRO — el mensaje salía y moría.
 *
 * Ante cualquier duda devuelve `false`, y la asimetría es deliberada:
 *   · un falso "abierta" manda un mensaje que muere en Meta y el vendedor cree
 *     que llegó — exactamente lo que pasó el 19-ago;
 *   · un falso "cerrada" solo obliga a mandar una plantilla.
 * Por eso una fecha nula o corrupta cuenta como cerrada.
 */
export function ventanaAbierta(ultimoEntranteDelCanal, ahoraMs = Date.now()) {
  if (!ultimoEntranteDelCanal) return false     // sin entrante nunca se abrió
  const t = Date.parse(ultimoEntranteDelCanal)
  if (!Number.isFinite(t)) return false          // fecha corrupta → cerrada
  return ahoraMs - t < VENTANA_MS
}

/**
 * Qué se actualiza cuando se guarda un mensaje: la ficha de la PERSONA y la fila
 * de la CONVERSACIÓN. Devuelve `{ conv, bandeja }` (bandeja `null` si no hay canal).
 *
 * ☠️ ACÁ VIVÍA EL PEOR BUG DE ESTE INBOX. La versión vieja hacía:
 *
 *     if (fila.phone_id) patchConv.phone_id = fila.phone_id
 *
 * sin mirar la dirección. O sea que un mensaje que SALÍA redefinía "el número por
 * el que habla esta persona", y la interfaz leía ese campo para decidir por dónde
 * mandar el siguiente. Efecto bola de nieve: el primer envío por el número
 * equivocado contaminaba la ficha y arrastraba a todos los que venían detrás.
 *
 * La regla es de una línea: **solo un ENTRANTE dice por dónde habla el cliente.**
 * Un saliente dice por dónde hablamos nosotros, que no es lo mismo y no sirve para
 * decidir nada — de hecho es justo lo que hay que verificar, no lo que hay que creer.
 */
export function patchesDeMensaje({ direccion, phone_id: phoneId, fecha }) {
  const esEntrante = String(direccion || '').trim().toUpperCase() === 'ENTRANTE'

  const conv = { ultimo_mensaje_at: fecha }
  if (esEntrante) {
    conv.ultimo_entrante_at = fecha
    if (phoneId) conv.phone_id = phoneId
  }

  // Sin canal no se escribe bandeja: una fila sin número no significa nada y se
  // mezclaría con cualquier otro mensaje que llegue igual de huérfano.
  if (!phoneId) return { conv, bandeja: null }

  const bandeja = { ultimo_mensaje_at: fecha }
  if (esEntrante) {
    bandeja.ultimo_entrante_at = fecha
    // Un entrante devuelve SU conversación a PENDIENTE siempre, venga del estado
    // que venga. Es la regla de Rodrigo, y ahora es por canal: si escribe por
    // REPUBLIC se reabre REPUBLIC y la de MANDI queda como estaba.
    bandeja.estado = 'PENDIENTE'
  }
  return { conv, bandeja }
}

/**
 * ¿Por cuál de NUESTROS números es alcanzable esta persona, y está abierta ahí?
 *
 * ⚠️ ESTA ES LA OTRA MITAD DEL BUG DE AGOSTO — los 79 mensajes de IND que no entraron
 * por la bola de nieve. MANDI tiene EXACTAMENTE el mismo código en esa ruta: el
 * arreglo del 19-ago no lo tocó. 19 mensajes en 30 días entraron por acá, y los
 * 7 días en cero son porque no ha disparado, no porque esté cubierto. `/api/directorio` (la pestaña CONTACTOS) es la AGENDA:
 * una fila por persona, sin canal. Calculaba la ventana así:
 *
 *     const entMs = c.ultimoEntranteAt ...
 *     dentro24h: entMs > 0 && now - entMs < DIA_MS
 *
 * `ultimoEntranteAt` es el de la PERSONA, mezclando los dos números. O sea que
 * pintaba la ventana en VERDE porque el cliente había escrito al OTRO número, y
 * después mandaba con el canal de la PESTAÑA. Las dos mitades del error a la vez:
 * el vendedor veía "se puede escribir", escribía, y el mensaje moría en Meta.
 *
 * Ahora `inbox.bandeja` tiene una fila por (cliente, número), así que la pregunta
 * se puede contestar de verdad: gana el número por el que escribió MÁS RECIENTE,
 * y la ventana se mide contra ESE.
 *
 * ⚠️ Un canal sin entrante NUNCA gana, y sin filas devuelve canal vacío en vez de
 * inventar el principal. Devolver un número por defecto acá es exactamente cómo
 * mueren los mensajes: el envío sale, Meta lo rechaza y el vendedor lo ve salir.
 * Quien llame decide qué hacer con el vacío — pero que sea una decisión, no un
 * descuido.
 *
 * @param bandejas filas de `inbox.bandeja` de UNA persona: { phone_id, ultimo_entrante_at }
 */
export function canalParaEscribir(bandejas, ahoraMs = Date.now()) {
  const vacio = { canal: '', dentro24h: false, ultimoEntranteAt: null }
  if (!Array.isArray(bandejas) || bandejas.length === 0) return vacio

  let mejor = null
  let mejorT = -Infinity
  for (const b of bandejas) {
    // Sin entrante no hay ventana: ese número nunca se abrió. Y una fecha
    // corrupta no puede ganarle a una buena — se descarta, no se asume.
    const t = Date.parse(b?.ultimo_entrante_at)
    if (!Number.isFinite(t)) continue
    if (t > mejorT) { mejorT = t; mejor = b }
  }
  if (!mejor) return vacio

  return {
    canal: String(mejor.phone_id || ''),
    dentro24h: ventanaAbierta(mejor.ultimo_entrante_at, ahoraMs),
    ultimoEntranteAt: mejor.ultimo_entrante_at,
  }
}
