// lib/respuesta-repetida.js — que una respuesta rápida no salga DOS veces.
//
// ☠️ POR QUÉ, con números (23-sep-2026, últimos 30 días). En MANDI salió 2 veces
// la misma respuesta al mismo cliente en menos de un minuto; en IND, con el
// mismo código, fueron 17 veces. El detalle de IND:
//
// 17 veces el mismo texto dos veces seguidas al mismo cliente en < 1 minuto:
//   · 6 en menos de 10 s → doble clic. El candado vivía en el estado de React
//     (`sending` en RightPanel) y el segundo clic llegaba antes de que React lo
//     actualizara: pasaban los dos.
//   · el resto entre 20 y 37 s, varias con 20 fotos alrededor → se volvió a
//     apretar cuando la primera ya había salido (o seguía en la fila) y el
//     candado ya se había soltado. Al cliente le llegaban 10 fotos dos veces.
// Y el panel del escritorio y el cajón del celular son DOS componentes, cada
// uno con su candado: por eso esta regla vive en App (handleQuickReply), que
// los dos comparten.
//
// La regla:
//   · si ESA respuesta a ESE cliente ya está saliendo → no se manda nada
//   · si ya salió hace menos de 10 min → se pregunta antes de mandarla otra vez
//   · si no → se manda
// "Ya salió" se sabe por lo que recuerda esta pantalla Y por el hilo del chat,
// así que también sirve después de recargar o si la mandó otra persona.

import { adjuntosDeRespuesta } from './adjuntos-respuesta.js'

export const VENTANA_REPETIDA_MS = 10 * 60_000

/** Identifica "esta respuesta a este cliente". Por id; si no hay id, por texto. */
export function claveRespuesta(telefono, reply = {}) {
  const quien = reply.id ? `id:${reply.id}` : `tx:${String(reply.text || '').trim()}`
  return `${telefono}|${quien}`
}

/**
 * Cuándo salió por última vez esta respuesta en el hilo (ms), o null.
 *
 * Con texto se compara SOLO el texto: dos respuestas distintas pueden compartir
 * fotos (caso real, 21:09 del 23-sep) y mandar la segunda es trabajo normal.
 * Sin texto, tienen que haber salido TODAS sus fotos: una sola repetida no dice
 * que sea la misma respuesta.
 */
function ultimaVezEnHilo(msgs, reply, desde) {
  const salientes = (msgs || []).filter((m) =>
    m && m.direccion === 'SALIENTE' && Date.parse(m.timestamp) >= desde)
  const texto = String(reply.text || '').trim()

  if (texto) {
    const t = salientes
      .filter((m) => String(m.mensaje || '').trim() === texto)
      .map((m) => Date.parse(m.timestamp))
    return t.length ? Math.max(...t) : null
  }

  const urls = adjuntosDeRespuesta(reply).map((a) => a.url)
  if (!urls.length) return null
  const vistas = urls.map((u) => {
    const t = salientes.filter((m) => m.mediaUrl === u).map((m) => Date.parse(m.timestamp))
    return t.length ? Math.max(...t) : null
  })
  return vistas.every((t) => t != null) ? Math.max(...vistas) : null
}

/**
 * @param {{ estado: 'enviando'|'enviada'|'fallida', at: number }|undefined} registro
 *   lo que recuerda esta pantalla de claveRespuesta(telefono, reply)
 * @param {Array} msgs  el hilo del chat (App: activeConv.msgs)
 * @returns {{ accion: 'enviar' } | { accion: 'en_vuelo' } | { accion: 'confirmar', haceMs: number }}
 */
export function decidirRespuestaRapida({ registro, msgs, reply = {}, ahora, ventanaMs = VENTANA_REPETIDA_MS }) {
  if (registro?.estado === 'enviando') return { accion: 'en_vuelo' }

  const desde = ahora - ventanaMs
  // La última vez salió A MEDIAS (el texto sí, una foto no): el hilo diría "ya
  // salió", pero reenviar es justo lo que el vendedor tiene que poder hacer.
  if (registro?.estado === 'fallida' && registro.at >= desde) return { accion: 'enviar' }
  const candidatas = [
    registro?.estado === 'enviada' && registro.at >= desde ? registro.at : null,
    ultimaVezEnHilo(msgs, reply, desde),
  ].filter((t) => t != null)

  if (!candidatas.length) return { accion: 'enviar' }
  return { accion: 'confirmar', haceMs: Math.max(0, ahora - Math.max(...candidatas)) }
}

/** "hace 25 segundos", "hace 7 minutos" — para el aviso. */
export function haceTexto(ms) {
  const s = Math.round(ms / 1000)
  if (s < 10) return 'unos segundos'
  if (s < 60) return `${s} segundos`
  const m = Math.floor(s / 60)
  return m === 1 ? '1 minuto' : `${m} minutos`
}
