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

/**
 * Techo de la espera. Un chat que lleva mas de un dia sin contestar ya no es un
 * problema de RAPIDEZ, es uno de limpieza de bandeja — y si lo dejamos entrar, se
 * roba el aviso: nombra siempre al mas viejo y el de hace 20 minutos queda enterrado.
 * Medido el 12-ago-2026: habia 11 pendientes, 7 de mas de un dia y el peor de 45,6.
 */
export const ESPERA_MAXIMA_MS = 24 * 60 * 60 * 1000

/**
 * ¿Esta espera pasa el techo? Vive en UNA sola función a propósito: la usan
 * `chatsQueAvisar` (para decidir quién puede ser el titular) y
 * `partirPorAntiguedad` (para decidir quién cuenta). Si fueran dos
 * comparaciones separadas, editar una y olvidar la otra haría que el titular y
 * el conteo usaran reglas distintas — y ninguna prueba se enteraría, porque
 * cada función tiene sus propios tests y ninguno cruza contra el otro.
 */
function pasaElTecho(espera, techoMs = ESPERA_MAXIMA_MS) {
  return espera > techoMs
}

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
      // Techo: pasado un dia ya no es velocidad de respuesta, es arrastre. Entra
      // si espera exactamente 24h, no entra un pelo mas.
      if (pasaElTecho(espera)) return false
      // Anti-repetición: guardado en la BASE, no en RAM. Las funciones de Vercel
      // son efímeras y un Set en memoria manda duplicados — misma lección que
      // dejó el enfriamiento del push.
      if (!c.ultimoAvisoTelegramAt) return true
      const prev = Date.parse(c.ultimoAvisoTelegramAt)
      if (Number.isNaN(prev)) return true
      // Si el aviso es ANTERIOR al último entrante, era de otra espera: contestaste
      // y la clienta volvió a escribir. Esta espera es nueva y arranca limpia. Sin
      // esto, la marca vieja tapa el mensaje nuevo hasta completar los 30 min —
      // silencio justo en el chat más activo, al revés de lo que se busca.
      const entrante = Date.parse(c.ultimoEntranteAt)
      if (!Number.isNaN(entrante) && prev < entrante) return true
      return ahoraMs - prev >= REPETIR_CADA_MS
    })
    .sort((a, b) => b.espera - a.espera)
    .map(({ c }) => c)
}

/**
 * Separa los contactos que ya llegaron al mínimo en dos: `recientes` (dentro
 * del techo, lo que decide el titular) y `arrastre` (pasado el techo).
 *
 * El techo (ver `ESPERA_MAXIMA_MS`) nació para que un chat de 45 días no se
 * robe el titular de uno de 20 minutos — pero sacarlo del titular NO es lo
 * mismo que sacarlo del CONTEO. La version anterior de este cron los
 * descartaba en el mismo filtro que `chatsQueAvisar`, y un chat que cruza las
 * 24h se volvía invisible para Telegram PARA SIEMPRE: un tablero mudo se leía
 * como bandeja limpia cuando en realidad era arrastre acumulándose sin que
 * nadie lo viera. Por eso el arrastre se cuenta y se nombra (`textoAviso`),
 * aunque nunca decide el titular ni se estampa con `marcarAvisoTelegram` —
 * estamparlo lo apagaría para siempre, que es exactamente el bug que esto
 * arregla.
 *
 * Un chat que no llega al mínimo no entra en NINGUNO de los dos baldes: 2
 * minutos de espera no es ni "de hoy" ni "arrastre", es "todavía no toca".
 *
 * Igual que `chatsQueAvisar`, solo cuenta chats en estado `pendiente`. Sin
 * este filtro un chat ya `atendido` de hace meses -con `ultimoEntranteAt`
 * viejo porque nadie lo vuelve a tocar- engordaría el arrastre para siempre:
 * el número dejaría de significar "gente esperando" y pasaría a significar
 * "historial viejo", que es ruido, no la señal que este cron existe para dar.
 * Además es un requisito explícito del dueño: solo se notifica lo que está o
 * entra en la bandeja de Pendientes.
 *
 * Medido con datos reales el 12-ago-2026, quitar este filtro (el `continue`
 * de abajo) dispara el arrastre así de lejos de la realidad:
 *   MANDI: con filtro +7   / sin filtro +1.513
 *   IND:   con filtro +207 / sin filtro +2.460 (IND tiene 2.405 conversaciones
 *          en ATENDIDO — casi todo el "sin filtro" es eso, no gente esperando)
 * El aviso habría nacido diciendo "(+2.460 de más de un día)" en IND: la
 * misma falsa calma que este cron entero vino a evitar, pero en la métrica
 * nueva en vez de en la vieja.
 */
export function partirPorAntiguedad(contactos, ahoraMs) {
  const recientes = []
  const arrastre = []
  for (const c of contactos || []) {
    if (String(c?.estado || '').toLowerCase() !== 'pendiente') continue
    const espera = esperaDe(c, ahoraMs)
    if (espera === null || espera < ESPERA_MINIMA_MS) continue
    if (pasaElTecho(espera)) arrastre.push(c)
    else recientes.push(c)
  }
  return { recientes, arrastre }
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
 *
 * `arrastre` es cuántos chats pendientes pasaron el techo de 24h (ver
 * `partirPorAntiguedad`). Se MENCIONAN, nunca se nombran ni se estampan: el
 * techo existe para que no se roben el titular, no para que desaparezcan del
 * tablero. Sin esta línea, un cron mudo por 45 días de arrastre se leía como
 * "bandeja limpia" — la misma calma falsa, al revés, que este proyecto entero
 * vino a eliminar. En 0 no se agrega nada: el mensaje de siempre no cambia
 * ni un carácter cuando no hay nada que arrastrar.
 */
export function textoAviso(chats, ahoraMs, baseUrl, arrastre = 0) {
  if (!chats?.length) return ''
  const peor = chats[0]
  const espera = esperaLegible(esperaDe(peor, ahoraMs) ?? 0)
  const nombre = escaparHtml(peor.nombre || peor.telefono)
  const link = `${baseUrl}/inbox?tel=${encodeURIComponent(peor.telefono)}`
  const nota = arrastre > 0 ? ` (+${arrastre} de más de un día)` : ''

  if (chats.length === 1) {
    return `⏳ <b>${nombre}</b> lleva <b>${espera}</b> esperando respuesta${nota}.\n\n${link}`
  }
  return `⏳ <b>${chats.length} chats esperando respuesta hoy</b>${nota}.\n` +
         `El que más espera: <b>${nombre}</b>, ${espera}.\n\n${link}`
}
