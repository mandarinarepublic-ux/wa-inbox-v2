// lib/enlaces.js — convierte las URLs de un mensaje en enlaces clicables.
//
// El chat pintaba el texto plano: una URL llegaba muerta y había que copiarla y
// pegarla a mano. Importa más de lo que parece — la web de Mandarina manda
// clientes por `api.whatsapp.com/send?text=…` (37 mensajes, 22 en el último mes)
// y ahí es justo donde va a viajar el link del producto.
//
// ☠️ EL TEXTO LO ESCRIBE EL CLIENTE. Por eso hay DOS reglas duras acá:
//
//   1. Solo `http` y `https` se enlazan. Una LISTA BLANCA, nunca una negra:
//      `javascript:` en un href se ejecuta en la sesión de quien atiende, que
//      tiene la cookie del CRM. Una lista negra siempre se queda corta.
//   2. Nada se pierde. Las partes devueltas, concatenadas, dan EXACTAMENTE el
//      mensaje original. Si el partidor se comiera un pedazo, desaparecería lo
//      que escribió una persona — el bug más reincidente de este inbox.
//      Hay una prueba que lo verifica sobre varios mensajes.

// Un enlace con protocolo, o un `www.` pelado. El `\S` evita cruzar espacios.
const RE = /\b(?:https?:\/\/|www\.)\S+/gi

// La puntuación pegada al final casi nunca es parte de la URL: "el mapa: https://x.com."
// Los cierres se recortan sin mirar el balance a propósito — un paréntesis de más
// dentro de la URL es un enlace feo; uno de menos rompe el enlace entero.
const COLA = /[.,;:!?¡¿)\]}>"'…]+$/

/**
 * Parte el mensaje en trozos: { tipo: 'texto'|'enlace', valor, href? }.
 * `valor` es SIEMPRE lo que se pinta; `href` solo va en los enlaces.
 */
export function partirEnlaces(texto) {
  const s = String(texto ?? '')
  if (!s) return [{ tipo: 'texto', valor: '' }]

  const partes = []
  let ultimo = 0
  for (const m of s.matchAll(RE)) {
    let url = m[0]
    const cola = (url.match(COLA) || [''])[0]
    if (cola) url = url.slice(0, -cola.length)

    // Lista BLANCA de esquemas. `www.` no trae protocolo → se le pone https.
    const esWww = /^www\./i.test(url)
    const href  = esWww ? `https://${url}` : url
    if (!esWww && !/^https?:\/\//i.test(href)) continue
    // Un "https://" pelado, sin dominio, no es un enlace.
    if (!/^https?:\/\/[^/\s]+/i.test(href)) continue

    if (m.index > ultimo) partes.push({ tipo: 'texto', valor: s.slice(ultimo, m.index) })
    partes.push({ tipo: 'enlace', valor: url, href })
    ultimo = m.index + url.length     // la cola vuelve como texto, no se pierde
  }
  if (ultimo < s.length) partes.push({ tipo: 'texto', valor: s.slice(ultimo) })
  return partes.length ? partes : [{ tipo: 'texto', valor: s }]
}
