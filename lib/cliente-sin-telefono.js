// lib/cliente-sin-telefono.js — clientes que escriben con NOMBRE DE USUARIO, sin mostrar su celular.
//
// Desde 2026 WhatsApp deja escribirle a un negocio sin dar el número. Meta manda
// entonces, en vez del teléfono, un BSUID (business-scoped user id), p. ej.
// `CO.1712386937160316`: único por (persona, negocio) y estable.
//
// ☠️ 25-sep-2026: esos mensajes se guardaban con el teléfono VACÍO. El contador de
// pendientes los contaba pero la lista los escondía (exige un teléfono), así que
// siempre quedaba "1 pendiente" imposible de abrir — y una clienta preguntó dos
// veces por precio y talla sin respuesta. Ahora el BSUID hace de teléfono: es la
// clave de la conversación, se muestra el @usuario y se le responde con
// `recipient` (Meta: "recipient: <BSUID> omitiendo to").
//
// Documentación: developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/

const RE_BSUID = /^[A-Z]{2}\.\d{6,}$/

/** ¿Este "teléfono" es en realidad un BSUID? */
export const esBsuid = (s) => RE_BSUID.test(String(s || '').trim())

/** Con quién habla un entrante: el teléfono si Meta lo manda; si no, el BSUID. */
export function identificadorEntrante(msg) {
  return String(msg?.from || msg?.from_user_id || '').trim()
}

/** Contactos del webhook → { identificador: { nombre, username } }. */
export function perfilesDeContactos(contacts = []) {
  const out = {}
  for (const c of contacts || []) {
    const id = String(c?.wa_id || c?.user_id || '').trim()
    if (!id) continue
    out[id] = { nombre: c?.profile?.name || '', username: c?.profile?.username || '' }
  }
  return out
}

/** Lo que se pinta donde iba "+593…": el @usuario si no hay número. */
export function etiquetaTelefono(telefono, username = '') {
  const t = String(telefono || '')
  if (esBsuid(t)) return username ? `@${username}` : 'Usuario de WhatsApp (sin número)'
  return t ? `+${t}` : ''
}

/**
 * A quién va un envío en el payload de Meta. Con teléfono: `to` (el camino de
 * siempre, intacto). Con BSUID: `recipient` y SIN `to` — si van los dos, Meta
 * usa el teléfono.
 */
export function destinoMeta(telefono) {
  const t = String(telefono || '').trim()
  if (esBsuid(t)) return { recipient: t }
  return { to: t.replace(/\D/g, '') }
}
