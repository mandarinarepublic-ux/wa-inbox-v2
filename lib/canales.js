// lib/canales.js — Los números de WhatsApp que atiende este inbox.
//
// ÚNICO lugar donde se define qué canales existen. La interfaz pinta una pestaña
// por cada uno y el backend filtra por `phoneId`. Agregar un número es agregar
// una entrada acá: nada más en la app sabe de números.
//
// El `id` es lógico y NO el número: el phone_id de Meta cambia si el número se
// migra de cuenta (le pasó al 3326 de IND el 28-jul), y no queremos que eso
// arrastre estado guardado en el navegador ni en las URLs.
const PHONE_MANDI = process.env.META_PHONE_ID || '1024077200794372'

export const CANALES = [
  {
    id: 'MANDI',
    phoneId: PHONE_MANDI,                    // +593 98 374 5757
    // WABA que aloja este número, confirmada contra el tráfico real de
    // inbox.webhook_eventos (entry[0].id). La necesita la Conversions API para
    // atribuir las conversaciones que nacen de un anuncio Click-to-WhatsApp.
    wabaId: process.env.META_WABA_ID || '1250794910496982',
    etiqueta: 'MANDI',
    sub: 'WhatsApp',
    color: '#25d366',
    titulo: 'Mandarina · +593 98 374 5757',
  },
  {
    id: 'REPUBLIC',
    // WABA 110133805380815 ("Mandarina Republic"). Antes esta pestaña leía
    // WhatsApp Web con una extensión de Chrome y un launcher en localhost:3098;
    // ahora es Cloud API como el resto.
    phoneId: process.env.META_PHONE_ID_REPUBLIC || '118582961194601',
    wabaId: process.env.META_WABA_ID_REPUBLIC || '110133805380815',
    etiqueta: 'REPUBLIC',
    sub: 'WhatsApp',
    color: '#f97316',
    titulo: 'Republic · +593 97 910 4167',
  },
]

export const CANAL_POR_DEFECTO = CANALES[0].id

/**
 * Pestaña que acumula TODOS los números en una sola columna.
 *
 * No es un canal más: no tiene número propio. Su phoneId es `null` a propósito,
 * porque `null` es la convención que ya usan las lecturas para decir "sin filtro"
 * (mira el `if (canal)` de getContactosSupabase). `undefined` NO sirve: los
 * parámetros con valor por defecto solo se rellenan con undefined, y el canal
 * terminaría siendo MANDI en silencio.
 */
export const CANAL_GENERAL = 'GENERAL'

/**
 * Cuántos mensajes del cliente hacen falta para avisarle a Meta (LeadSubmitted).
 *
 * MANDARINA usa 3 y no 4 como IND, y el motivo es de volumen: Meta necesita unas
 * 50 señales por semana para aprender a quién buscar, y con 4 mensajes MANDARINA
 * genera 33. Con 3 genera 46 — casi el umbral.
 *
 * Bajarlo no mete ni un comprador de menos: se revisó el 2-ago y TODOS los
 * compradores de MANDARINA escribieron 6 mensajes o más. Lo único que entra son
 * personas que preguntaron tres veces en vez de cuatro.
 *
 * Lo que NO se hace es avisar de cada persona que escribe (umbral 1): serían 106
 * por semana, de sobra, pero Meta empezaría a buscar gente que abre chats y no
 * compra — el problema que este proyecto vino a resolver.
 *
 * Vive acá y no en lib/capi.js porque ese archivo es IDÉNTICO en los dos inbox
 * a propósito: es lo que permite ver de un vistazo si se desincronizaron.
 * `CAPI_LEAD_UMBRAL` en Vercel lo sigue pisando si hace falta moverlo sin
 * desplegar.
 */
export const LEAD_UMBRAL_DEFECTO = 3

/**
 * id lógico → phone_id de Meta. Devuelve el principal si el id no existe.
 * GENERAL devuelve null = todos los números (ver CANAL_GENERAL).
 */
export function phoneIdDeCanal(id) {
  if (id === CANAL_GENERAL) return null
  const c = CANALES.find((x) => x.id === id)
  return (c || CANALES[0]).phoneId
}

/** phone_id de Meta → id lógico (para etiquetar lo que llega del backend). */
export function canalDePhoneId(phoneId) {
  const c = CANALES.find((x) => String(x.phoneId) === String(phoneId))
  return c ? c.id : null
}

/**
 * phone_id de Meta → WABA que lo aloja.
 *
 * La Conversions API exige `whatsapp_business_account_id` en los eventos de
 * business_messaging, y tiene que ser la WABA por la que ENTRÓ el click, no "la
 * WABA de la marca": cada número está en una WABA distinta. Devuelve null si el
 * phone_id no es de ninguno de nuestros canales — mejor no mandar el evento que
 * mandarlo con una WABA equivocada, que Meta rechaza igual.
 */
export function wabaIdDePhoneId(phoneId) {
  const c = CANALES.find((x) => String(x.phoneId) === String(phoneId))
  return c?.wabaId || null
}

/**
 * phone_id de Meta → color del canal, para pintarlo en la interfaz.
 *
 * Devuelve '' si el phone_id no es de ninguno de nuestros números. Mejor no
 * pintar nada que pintar el color equivocado: esa línea es lo que le dice al
 * vendedor por cuál número va a salir su respuesta.
 */
export function colorDeCanal(phoneId) {
  const c = CANALES.find((x) => String(x.phoneId) === String(phoneId))
  return c?.color || ''
}

/**
 * phone_id de Meta → nombre corto del canal, para el chip de la fila en GENERAL.
 *
 * El color solo no alcanzó. En GENERAL un cliente que escribió a los dos números
 * aparece DOS veces, y dos filas con el mismo nombre distinguidas nada más por una
 * franja de color se confunden en el celular, de reojo o con poca luz. El chip dice
 * el nombre y ya no hay que adivinar.
 *
 * Devuelve '' si el phone_id no es de ninguno de nuestros números: mejor no pintar
 * nada que pintar una etiqueta equivocada, que es justo lo que manda al vendedor a
 * responder por el canal que no es.
 */
export function etiquetaDePhoneId(phoneId) {
  const c = CANALES.find((x) => String(x.phoneId) === String(phoneId))
  return c?.etiqueta || ''
}
