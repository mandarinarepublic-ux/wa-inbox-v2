// lib/ia-ahorro.js — Cuándo NO vale la pena llamar al agente de IA (17-nov-2026).
//
// Cada llamada cuesta tokens. Tres reglas, pedidas por Rodrigo ("que se optimice
// según el tipo de consulta"):
//   1. Si una respuesta simple (reglas, gratis) ya contestó → no se llama.
//   2. Mensajes que no piden nada ("gracias", un emoji, un punto) → no se llama.
//   3. RÁFAGAS: el cliente manda 3 mensajes en 20 segundos ("Hola" · "Vi unos busos
//      de Power Rangers" · "¿Los tienen aún?"). Se espera unos segundos y contesta
//      SOLO el último; el agente igual lee la conversación entera, así que ve los tres.
//
// Módulo PURO: lo que decide si el bot le escribe a un cliente tiene que poder probarse.

/** Cuánto se espera por si el cliente sigue escribiendo. */
export const ESPERA_RAFAGA_MS = 8000

const quitarTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Solo agradecimientos y cierres de cortesía. A propósito NO están "ok", "sí",
// "listo" ni "hola": dentro de una venta son respuestas ("¿te lo separo?" → "ok")
// y un "hola" solo puede ser un cliente nuevo esperando.
const CORTESIA = /^(muchas |mil |ok |okey |listo |vale |perfecto |genial |super )*(gracias|muchas gracias|mil gracias|gracias (amigo|amiga|joven|estimado|mi estimado|bro|totales)|muy amable|que amable|igualmente|bendiciones|dios le pague|buen dia igualmente|saludos)$/

/** ¿Este texto no pide nada? (gracias, emoji suelto, signos sin "?") */
export function esMensajeSinPedido(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo) return true
  // Sin ninguna letra ni número: emojis o signos. Con "?" SÍ pide algo (está esperando).
  if (!/[\p{L}\p{N}]/u.test(crudo)) return !crudo.includes('?')
  const t = quitarTildes(crudo.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return CORTESIA.test(t) || esAgradecimiento(crudo)
}

// ── AGRADECIMIENTO / DESPEDIDA (17-nov-2026) ─────────────────────────────────
// Medido en el modo sombra: "Muchas gracias y discúlpeme por la insistencia" y
// "Gracias y buen día" pasaban el filtro de arriba y gastaban 17k tokens en una
// despedida. Regla de Rodrigo: a un mensaje así se le reacciona con ❤️ y el chat
// pasa a ATENDIDO (webhook).
//
// Cómo decide: se quitan las frases de cortesía conocidas; si NO queda nada, es
// una despedida. Basta UNA palabra que no esté en la lista ("gracias, y el
// envío cuánto es") para que no lo sea. Y exige un agradecimiento de verdad:
// "buenas tardes" solo es un cliente que llega, no uno que se va.
const AGRADECE = /\b(gracias|grax|agradezco|agradecid[oa]s?|amable|bendiciones|bendiga|dios le pague|dios les pague|igualmente)\b/
const FRASES_CORTESIA = [
  'dios le pague', 'dios les pague', 'dios le bendiga', 'dios les bendiga', 'dios me lo bendiga',
  'que tenga un buen dia', 'que tengan un buen dia', 'que tengas un buen dia',
  'que tenga buen dia', 'que tengan buen dia', 'que tengas buen dia',
  'que tenga una buena tarde', 'que tenga buena tarde', 'que tenga una buena noche', 'que tenga buena noche',
  'que tengas una buena tarde', 'que tengas buena tarde', 'que tengas una buena noche', 'que tengas buena noche',
  'muy amable', 'que amable', 'muy amables', 'feliz dia', 'feliz tarde', 'feliz noche', 'feliz fin de semana',
  'buen dia', 'buenos dias', 'buena tarde', 'buenas tardes', 'buena noche', 'buenas noches', 'buen fin de semana',
  'por la insistencia', 'por la molestia', 'por las molestias', 'la insistencia', 'la molestia', 'las molestias',
  'por todo', 'por la ayuda', 'por su ayuda', 'por tu ayuda', 'por la atencion', 'por su atencion', 'por tu atencion',
  'de nuevo', 'de una', 'mil gracias', 'muchas gracias', 'muchisimas gracias',
]
const PALABRAS_CORTESIA = new Set([
  'gracias', 'grax', 'agradezco', 'agradecido', 'agradecida', 'agradecidos', 'muchas', 'muchisimas', 'mil',
  'bendiciones', 'igualmente', 'saludos', 'abrazo', 'abrazos', 'amable', 'nuevamente',
  'disculpe', 'disculpa', 'disculpeme', 'disculpame', 'disculpen', 'perdon', 'perdone',
  'ok', 'okey', 'oki', 'listo', 'vale', 'perfecto', 'genial', 'super', 'excelente', 'chevere', 'bueno',
  'y', 'e', 'a', 'le', 'les', 'te', 'usted', 'ustedes', 'por', 'todo', 'igual', 'tambien', 'nomas',
  'estimado', 'estimada', 'amigo', 'amiga', 'joven', 'senor', 'senora', 'senorita', 'bro', 'mi',
  'andres', 'mandi', 'mandarina', 'equipo',
])

/** ¿Es SOLO un agradecimiento o despedida? ("gracias y buen día", "mil gracias 🙏") */
export function esAgradecimiento(texto) {
  const crudo = String(texto || '').trim()
  if (!crudo || crudo.includes('?') || crudo.length > 160) return false
  let t = ' ' + quitarTildes(crudo.toLowerCase()).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  if (!AGRADECE.test(t)) return false
  for (const f of FRASES_CORTESIA) t = t.split(` ${f} `).join(' ')
  // Una segunda pasada: quitar una frase puede dejar otra pegada ("por la insistencia y buen dia").
  for (const f of FRASES_CORTESIA) t = t.split(` ${f} `).join(' ')
  return t.split(' ').filter(Boolean).every(p => PALABRAS_CORTESIA.has(p))
}

/**
 * ¿`mio` es el ÚLTIMO mensaje del cliente? `entrantes` = sus mensajes con fecha
 * igual o posterior ({ id, fecha }). Empate en el mismo segundo → gana el id mayor,
 * para que de dos mensajes simultáneos conteste exactamente uno.
 */
export function esElUltimo(mio, entrantes = []) {
  const tm = Date.parse(mio?.fecha)
  for (const e of entrantes) {
    if (!e || e.id === mio.id) continue
    const te = Date.parse(e.fecha)
    if (te > tm) return false
    if (te === tm && String(e.id) > String(mio.id)) return false
  }
  return true
}
