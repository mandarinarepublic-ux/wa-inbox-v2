// lib/bandeja.js — el estado de la conversación POR CANAL.
//
// ⚠️ LA REGLA QUE ESTE ARCHIVO EXISTE PARA SOSTENER:
//
//     La ventana de 24 h de WhatsApp es por par (cliente ↔ número NUESTRO).
//     NO por cliente.
//
// `inbox.conversaciones` tiene UNA fila por persona: ahí viven su nombre, su
// temperatura, sus notas y su venta, y está bien que sea una sola porque el lead
// es el mismo escriba por donde escriba. Lo que NO puede vivir ahí es "¿le
// contesté?" y "¿está abierta la ventana?", porque esas dos preguntas tienen una
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
// Este archivo es puro a propósito (no habla con Supabase): así se puede probar
// la regla sin base de datos, que es justo lo que faltaba — no había NI UNA
// prueba multi-número en el repo y por eso la familia llegó a producción cinco
// veces. El acceso a datos vive en lib/inbox-supabase.js.

/** Ventana de servicio de WhatsApp: 24 h desde el último mensaje DEL CLIENTE. */
export const VENTANA_MS = 24 * 60 * 60 * 1000

/** Núcleo del teléfono, sin país ni ceros: une 0987…, 593987… y +593 98 7… */
const nucleo = (tel) => String(tel || '').replace(/\D/g, '').slice(-9)

/**
 * Clave de una conversación: teléfono + número nuestro.
 *
 * El separador NO es cosmético. Sin él, ('59396', '0643698') y ('593960', '643698')
 * producirían la misma clave y dos clientes distintos se pisarían el estado.
 */
export const claveBandeja = (telefono, phoneId) => `${nucleo(telefono)}|${String(phoneId || '')}`

/** Fila de inbox.bandeja → shape de la app (mismo vocabulario que toContacto). */
function toBandeja(b) {
  return {
    telefono:         String(b.telefono || ''),
    phoneId:          String(b.phone_id || ''),
    // minúsculas como `toContacto`: la interfaz compara con 'pendiente'/'atendido'
    // y una sola discrepancia de mayúsculas esconde el chat de TODAS las bandejas.
    estado:           String(b.estado || 'PENDIENTE').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente',
    noLeidos:         Number(b.no_leidos || 0),
    ultimoMensajeAt:  b.ultimo_mensaje_at  || null,
    ultimoEntranteAt: b.ultimo_entrante_at || null,
    ultimoPushAt:     b.ultimo_push_at     || null,
    alertaVentanaAt:  b.alerta_ventana_at  || null,
  }
}

/** Filas de inbox.bandeja → Map indexado por clave (teléfono + canal). */
export function mapaBandeja(filas) {
  const m = new Map()
  for (const f of filas || []) {
    m.set(claveBandeja(f.telefono, f.phone_id), toBandeja(f))
  }
  return m
}

/**
 * Estado de bandeja de ESTA conversación.
 *
 * Sin fila devuelve 'pendiente' y NUNCA undefined: un chat recién llegado todavía
 * no tiene fila, y si esto devolviera undefined la interfaz lo pintaría fuera de
 * toda bandeja. "No aparece el cliente" es el bug más reincidente de este inbox
 * (volvió cuatro veces); el default lo cierra por diseño.
 */
export function estadoDeBandeja(mapa, telefono, phoneId) {
  return mapa?.get(claveBandeja(telefono, phoneId))?.estado || 'pendiente'
}

/**
 * ¿Se le puede escribir libremente a este cliente POR ESTE NÚMERO?
 *
 * Ante cualquier duda devuelve `false`, y la asimetría es deliberada:
 *   · un falso "abierta" manda un mensaje que muere en Meta y el vendedor cree
 *     que llegó — exactamente lo que pasó el 19-ago;
 *   · un falso "cerrada" solo obliga a mandar una plantilla.
 * Por eso una fecha nula, corrupta o del futuro cuenta como cerrada.
 */
export function ventanaAbierta(mapa, telefono, phoneId, ahoraMs = Date.now()) {
  const ts = mapa?.get(claveBandeja(telefono, phoneId))?.ultimoEntranteAt
  if (!ts) return false                       // sin entrante la ventana nunca se abrió
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return false        // fecha corrupta → cerrada
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
 *
 * Es una función pura para que se pueda probar sin base de datos: la lógica que
 * mató 9 mensajes no puede volver a vivir dentro de un `await`.
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

/** Milisegundos que faltan para que se cierre la ventana (0 si ya cerró). */
export function restanteVentanaMs(mapa, telefono, phoneId, ahoraMs = Date.now()) {
  const ts = mapa?.get(claveBandeja(telefono, phoneId))?.ultimoEntranteAt
  if (!ts) return 0
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, VENTANA_MS - (ahoraMs - t))
}
