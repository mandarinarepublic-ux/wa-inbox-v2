// lib/pendientes.js — reglas del recordatorio de chats sin contestar.
//
// Todo acá es PURO: sin base, sin red, sin relojes escondidos. Es a propósito —
// es la parte que se puede equivocar, así que es la parte que se puede probar.
//
// La diferencia con el push: el push avisa de un EVENTO (entró un mensaje) y por
// eso se puede perder. Esto avisa de un ESTADO (hay gente esperando) y por eso
// insiste hasta que vacíes la bandeja. Es la regla de Rodrigo puesta en código:
// "si esa bandeja está vacía, contesté a todos".

const MIN = 60 * 1000

/** Cuánto tiene que llevar esperando un chat para que valga la pena avisar. */
export const ESPERA_MINIMA_MS = 10 * MIN
/** Cada cuánto se vuelve a insistir por el mismo chat, si sigue sin contestar. */
export const REPETIR_CADA_MS = 30 * MIN

export const HORA_ABRE = 8
export const HORA_CIERRA = 21

/**
 * Hora del día en Ecuador (0-23). Ecuador es UTC−5 fijo y NO tiene horario de
 * verano, así que restar 5 h y leer en UTC es exacto — y a diferencia de
 * `getHours()`, no depende de la zona de la máquina ni del servidor.
 */
export function horaEcuador(ms) {
  return new Date(ms - 5 * 3600 * 1000).getUTCHours()
}

export function enHorarioLaboral(ms) {
  const h = horaEcuador(ms)
  return h >= HORA_ABRE && h < HORA_CIERRA
}

/** Espera en milisegundos de un chat, o null si no se puede medir. */
function esperaDe(c, ahoraMs) {
  if (!c?.ultimoEntranteAt) return null
  const t = Date.parse(c.ultimoEntranteAt)
  if (Number.isNaN(t)) return null
  return ahoraMs - t
}

/**
 * De todos los contactos, ¿por cuáles toca avisar ahora? Ordenados del que más
 * espera al que menos.
 *
 * Un chat sin `ultimoEntranteAt` queda FUERA: no se puede medir su espera, y
 * avisar de algo que no sabemos medir es ruido que enseña a ignorar los avisos.
 */
export function chatsQueAvisar(contactos, ahoraMs) {
  if (!enHorarioLaboral(ahoraMs)) return []
  return (contactos || [])
    .filter((c) => String(c?.estado || '').toLowerCase() === 'pendiente')
    .map((c) => ({ c, espera: esperaDe(c, ahoraMs) }))
    .filter(({ c, espera }) => {
      if (espera === null || espera < ESPERA_MINIMA_MS) return false
      // Anti-repetición: guardado en la BASE, no en RAM. Las funciones de Vercel
      // son efímeras y un Set en memoria manda duplicados — misma lección que
      // dejó el enfriamiento del push.
      if (!c.ultimoAvisoTelegramAt) return true
      const prev = Date.parse(c.ultimoAvisoTelegramAt)
      if (Number.isNaN(prev)) return true
      return ahoraMs - prev >= REPETIR_CADA_MS
    })
    .sort((a, b) => b.espera - a.espera)
    .map(({ c }) => c)
}

/** "1 h 30 min", "45 min". Legible de un vistazo en la pantalla de bloqueo. */
export function esperaLegible(ms) {
  const totalMin = Math.floor(ms / MIN)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/**
 * Escapa lo que Telegram interpreta como HTML. El nombre viene del perfil de
 * WhatsApp, o sea que lo escribe la clienta: un `<` suelto hace que Telegram
 * rechace el mensaje entero con un 400 y el recordatorio se pierda. Son los tres
 * caracteres que pide la documentación de Telegram, y el `&` va primero para no
 * re-escapar lo que uno mismo acaba de poner.
 */
export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * El texto del aviso. Nombra al que más espera y cuánto lleva — un número solo
 * ("3 pendientes") no mueve a nadie; "Bea lleva 1 h 30 min" sí.
 */
export function textoAviso(chats, ahoraMs, baseUrl) {
  if (!chats?.length) return ''
  const peor = chats[0]
  const espera = esperaLegible(esperaDe(peor, ahoraMs) ?? 0)
  const nombre = escaparHtml(peor.nombre || peor.telefono)
  const link = `${baseUrl}/inbox?tel=${encodeURIComponent(peor.telefono)}`

  if (chats.length === 1) {
    return `⏳ <b>${nombre}</b> lleva <b>${espera}</b> esperando respuesta.\n\n${link}`
  }
  return `⏳ <b>${chats.length} chats pendientes</b>.\n` +
         `El que más espera: <b>${nombre}</b>, ${espera}.\n\n${link}`
}
