// lib/reenvio.js — reenviar un mensaje del chat a OTRA conversación.
// Módulo PURO (sin red ni base): decide si un mensaje se puede reenviar y en qué
// piezas sale. La pantalla solo pinta el botón y manda las piezas por
// /api/saliente. Ver tests/reenvio.test.js.
//
// ⚠️ Meta NO tiene "reenviar": no hay bandera de forwarded ni endpoint. Reenviar
// es mandar el MISMO contenido a otro chat, como un mensaje nuevo. Por eso acá no
// se inventa ningún prefijo tipo "Reenviado": el cliente lo recibe tal cual.
//
// ☠️ LA REGLA QUE IMPORTA: un medio sin `mediaUrl` NO se reenvía. Los entrantes
// llegan con `mediaId` (de Meta) y su url estable aparece recién cuando termina el
// archivado a nuestro Storage. Ese id además es de NUESTRO número: reenviarlo a un
// chat de otro número es apostar a que Meta lo acepte. Mejor decir "todavía no".

/** Tipos que no se pueden reenviar, con el motivo que ve el vendedor. */
const NO_REENVIABLES = {
  order: 'un pedido del catálogo no se puede reenviar',
  reaction: 'una reacción no se puede reenviar',
  edit: 'un aviso de mensaje editado no se puede reenviar',
  revoke: 'un aviso de mensaje eliminado no se puede reenviar',
  system: 'un aviso de WhatsApp no se puede reenviar',
  unsupported: 'WhatsApp no nos entregó ese contenido, no hay qué mostrar ni qué reenviar',
  sticker: 'los sticker no se pueden reenviar todavía',
}

const MEDIOS = ['imagen', 'video', 'audio', 'documento']
const limpio = (s) => String(s || '').trim()

/** Texto de una ubicación compartida: coordenadas, nombre y enlace a Maps. */
function textoDeUbicacion(u) {
  const lat = Number(u?.lat)
  const lon = Number(u?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ''
  const partes = [limpio(u?.nombre), limpio(u?.direccion)].filter(Boolean)
  const titulo = partes.length ? `📍 ${partes.join(' · ')}` : '📍 Ubicación'
  return `${titulo}\n${lat},${lon}\nhttps://www.google.com/maps?q=${lat},${lon}`
}

/**
 * ¿Se puede reenviar este mensaje? `{ ok, motivo }`. El motivo se muestra tal cual
 * en la pantalla: por eso está escrito para una persona, no para un log.
 */
export function puedeReenviar(msg) {
  const tipo = limpio(msg?.tipo) || 'texto'
  if (msg?.pedido) return { ok: false, motivo: NO_REENVIABLES.order }
  if (NO_REENVIABLES[tipo]) return { ok: false, motivo: NO_REENVIABLES[tipo] }

  if (MEDIOS.includes(tipo)) {
    if (!limpio(msg?.mediaUrl)) {
      return { ok: false, motivo: 'ese archivo todavía no está archivado en nuestro servidor; espera un momento y reintenta' }
    }
    return { ok: true, motivo: '' }
  }

  if (msg?.ubicacion && textoDeUbicacion(msg.ubicacion)) return { ok: true, motivo: '' }
  if (!limpio(msg?.mensaje)) return { ok: false, motivo: 'ese mensaje no tiene nada que reenviar' }
  return { ok: true, motivo: '' }
}

/**
 * Las piezas a mandar, EN ORDEN. `[]` si no se puede reenviar (la pantalla ya lo
 * impide, pero nadie debería poder mandar algo vacío por saltarse la guardia).
 *
 *  - texto      → { clase:'texto', texto }
 *  - imagen     → { clase:'imagen', url, texto }   (el texto va como pie de foto)
 *  - video      → { clase:'video', url, texto }
 *  - audio      → { clase:'audio', url }
 *  - documento  → { clase:'documento', url, nombre }
 */
export function piezasDeReenvio(msg) {
  if (!puedeReenviar(msg).ok) return []
  const tipo = limpio(msg?.tipo) || 'texto'
  const url = limpio(msg?.mediaUrl)
  const texto = limpio(msg?.mensaje)

  if (tipo === 'imagen') return [{ clase: 'imagen', url, texto }]
  if (tipo === 'video') return [{ clase: 'video', url, texto }]
  if (tipo === 'audio') return [{ clase: 'audio', url }]
  // El nombre del documento viaja en el texto de la fila. Sin él, el cliente
  // vería el uuid del bucket como nombre del archivo.
  if (tipo === 'documento') return [{ clase: 'documento', url, nombre: texto || 'documento' }]

  if (msg?.ubicacion) {
    const t = textoDeUbicacion(msg.ubicacion)
    if (t) return [{ clase: 'texto', texto: t }]
  }
  return [{ clase: 'texto', texto }]
}

/** Una línea corta para la ventana de "¿a qué chat lo mando?". */
export function resumenDeReenvio(msg) {
  const tipo = limpio(msg?.tipo) || 'texto'
  const texto = limpio(msg?.mensaje)
  if (tipo === 'imagen') return texto ? `📷 Foto · ${texto}`.slice(0, 80) : '📷 Foto'
  if (tipo === 'video') return texto ? `🎥 Video · ${texto}`.slice(0, 80) : '🎥 Video'
  if (tipo === 'audio') return '🎤 Nota de voz'
  if (tipo === 'documento') return `📄 ${texto || 'Documento'}`.slice(0, 80)
  if (msg?.ubicacion) return '📍 Ubicación'
  return texto.length > 80 ? `${texto.slice(0, 77)}…` : texto
}

// ── A qué chats se puede reenviar ────────────────────────────────────────────
// La ventana de 24 h de Meta es POR CONVERSACIÓN y por número. Un chat con la
// ventana cerrada solo acepta plantilla, así que acá sale deshabilitado y con el
// motivo escrito: ofrecerlo habilitado es exactamente cómo se pierden mensajes en
// silencio (Meta responde 131047 DESPUÉS de haber aceptado la llamada).
const VENTANA_MS = 24 * 60 * 60 * 1000
const tail9 = (s) => String(s || '').replace(/\D/g, '').slice(-9)
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Fecha del último mensaje del CLIENTE en esa conversación, en ms. 0 si no hay. */
function ultimoEntranteMs(c) {
  const delCanal = c?.ultimoEntranteCanal ? Date.parse(c.ultimoEntranteCanal) : NaN
  if (Number.isFinite(delCanal)) return delCanal
  const msgs = Array.isArray(c?.msgs) ? c.msgs : []
  let mejor = 0
  for (const m of msgs) {
    if (String(m?.direccion || '').toUpperCase() !== 'ENTRANTE') continue
    const t = Date.parse(m?.timestamp)
    if (Number.isFinite(t) && t > mejor) mejor = t
  }
  return mejor
}

/**
 * Las conversaciones a las que se puede reenviar, ya evaluadas:
 * `[{ telefono, nombre, phoneId, puede, motivo }]`.
 *
 * `excluir` es el chat de origen (teléfono + número nuestro): reenviarse al mismo
 * chat no tiene sentido. Ojo que el MISMO teléfono por OTRO número sí es un
 * destino distinto — son conversaciones separadas hasta para la ventana de 24 h.
 *
 * Los que pueden recibir van primero; dentro de cada grupo se respeta el orden
 * que traía la lista (la bandeja ya viene ordenada por lo más reciente).
 */
export function destinosParaReenviar(convs, { ahoraMs = Date.now(), excluir = null, busqueda = '' } = {}) {
  const q = sinAcentos(busqueda)
  const qDigitos = String(busqueda || '').replace(/\D/g, '')
  const fuera = excluir ? `${tail9(excluir.telefono)}|${excluir.phoneId || ''}` : ''

  const lista = (Array.isArray(convs) ? convs : []).filter(Boolean).filter((c) => {
    if (fuera && `${tail9(c.telefono)}|${c.phoneId || ''}` === fuera) return false
    if (!q) return true
    if (qDigitos && tail9(c.telefono).includes(qDigitos)) return true
    return sinAcentos(c.nombre).includes(q)
  }).map((c) => {
    const ms = ultimoEntranteMs(c)
    const puede = ms > 0 && ahoraMs - ms < VENTANA_MS
    return {
      telefono: String(c.telefono || ''),
      nombre: c.nombre || String(c.telefono || ''),
      phoneId: c.phoneId || '',
      puede,
      motivo: puede ? '' : 'la ventana de 24 h está cerrada: ahí solo entra una plantilla',
    }
  })

  return lista
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (Number(b.d.puede) - Number(a.d.puede)) || (a.i - b.i))
    .map(({ d }) => d)
}
