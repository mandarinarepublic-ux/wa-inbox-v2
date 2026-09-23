// lib/promesas.js — ¿Este mensaje nuestro promete algo al cliente? (📌 🤖)
//
// Revisión de 30 conversaciones reales (22-sep-2026): en 20 de 28 el cliente tuvo
// que volver a pedir algo que le prometimos ("ya le reviso", "ya solicito al
// diseñador", "ya te enviamos el boceto"…). Contestábamos, el chat pasaba a 🟢 y
// desaparecía. Si un mensaje ESCRITO POR UNA PERSONA contiene una promesa, se
// prende 📌 solo, con la frase como nota. Solo lo apaga una persona, salvo que
// en los 15 min siguientes salga una foto/video/documento (cumplió al toque).
//
// Las frases salen de esos 30 chats. Mejor quedarse corto que llenar de 📌 falsos:
// cada frase exige un verbo de acción a futuro, no basta con "ya".
//
// Módulo PURO.

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Cada patrón es sobre texto sin tildes y en minúsculas.
const PATRONES = [
  /\bya (le |te )?(reviso|verifico|consulto|confirmo|averiguo)\b/,
  /\b(le |te )?(reviso|verifico|consulto|averiguo) (con|en) (el |la |mi )?(disenador|disenadora|fabrica|taller|produccion|bodega|despacho)\b/,
  /\bya (le |te )?(solicito|pido|paso|mando|envio|ingreso|registro|genero|cargo)\b/,
  /\b(le |te )?(envio|mando|paso|confirmo|aviso|escribo) (mas tarde|en un momento|en un rato|enseguida|manana|hoy|en la tarde|en la noche|apenas)\b/,
  /\b(le |te )?(aviso|escribo|confirmo) (apenas|cuando)\b/,
  /\b(hoy|manana) (sale|se envia|se despacha|le llega|te llega|le envio|te envio|le mando|te mando|le confirmo|te confirmo)\b/,
  /\bdejame (verificar|revisar|consultar)|\bdejeme (verificar|revisar|consultar)|\bpermiteme (verificar|revisar|un momento)|\bpermitame (verificar|revisar|un momento)/,
  /\bya (le |te )?(enviamos|mandamos) el boceto\b/,
  /\bapenas (este|tenga|salga|llegue|termine)[^.!?]{0,40}\b(le |te )?(envio|mando|aviso|escribo|paso|confirmo)\b/,
  /\b(ahorita|ya mismo|en un ratito|en un ratico|en seguida|enseguida) (le |te |se )?(lo |la )?(envio|mando|paso|reviso|confirmo|aviso|escribo|comparto|verifico)\b/,
  /\b(le |te )?(envio|mando|paso|comparto) (el |la |los |las )?(boceto|disen|foto|guia|propuesta|cotizacion|proforma)\w* (en un momento|en un rato|mas tarde|manana|hoy|apenas|enseguida)/,
  /\blo (reviso|verifico|consulto) y (le |te )?(aviso|confirmo|escribo)\b/,
]

/** @returns {{ frase: string } | null} la frase original (hasta 60 letras) si promete algo. */
export function detectarPromesa(texto) {
  const original = String(texto || '').trim()
  if (!original) return null
  const t = sinTildes(original)
  for (const re of PATRONES) {
    const m = re.exec(t)
    // "Ya te paso la cuenta: Banco…" o "ya te envío la ubicación: …" CUMPLEN en el
    // mismo mensaje (los datos van después de los dos puntos): no es una promesa.
    if (m && /^[^:\n]{0,30}:\s*\S/.test(t.slice(m.index + m[0].length))) continue
    if (m) {
      // Recorta la frase del texto ORIGINAL (con tildes) en la misma posición.
      const frase = original.slice(m.index, m.index + m[0].length)
      return { frase: frase.length > 60 ? frase.slice(0, 59) + '…' : frase }
    }
  }
  return null
}

export const CUMPLE_AL_TOQUE_MS = 15 * 60 * 1000

/** Un 📌 automático se apaga solo si sale una foto/video/documento ≤15 min después. */
export function cumplePromesaAlToque({ deudaPor, deudaAt, tipoEnviado, ahoraMs = Date.now() }) {
  if (deudaPor !== 'auto' || !deudaAt) return false
  if (!['imagen', 'image', 'video', 'documento', 'document'].includes(String(tipoEnviado || '').toLowerCase())) return false
  const t = new Date(deudaAt).getTime()
  return Number.isFinite(t) && ahoraMs - t >= 0 && ahoraMs - t <= CUMPLE_AL_TOQUE_MS
}
