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

/** id lógico → phone_id de Meta. Devuelve el principal si el id no existe. */
export function phoneIdDeCanal(id) {
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
