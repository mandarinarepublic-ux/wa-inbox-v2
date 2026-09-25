// lib/lote-envio.js — ¿Le mando a este cliente el mensaje de un lote? (25-sep-2026)
//
// Un lote lo arma Claude desde la terminal (Claude Code), Rodrigo lo aprueba y
// `scripts/enviar-lote.mjs` lo manda por /api/saliente. Entre armar la lista y
// mandar pueden pasar minutos u horas, así que JUSTO ANTES de cada envío se relee
// el hilo del cliente y se decide con esta regla. Módulo PURO.
//
// Solo se manda si se cumple TODO:
//   · el último mensaje del chat es NUESTRO (si habló el cliente, espera una
//     respuesta de una persona, no un mensaje de retoma);
//   · el cliente no escribió nada desde que se armó la lista (ni una reacción);
//   · NADIE de nuestro lado le escribió desde que se armó la lista (25-sep: a tres
//     clientes les mandaron la retoma a mano con otro saludo; el lote habría sido
//     el segundo mensaje);
//   · la ventana de 24 h sigue abierta con al menos 15 min de margen;
//   · es de día en Ecuador (08:00 a 22:00);
//   · no le mandamos ya este mismo texto (correr el lote dos veces no repite).
import { horaEcuador } from './reactivacion.js'

const H = 3600 * 1000
export const MARGEN_VENTANA_MIN = 15
export const HORA_DESDE = 8
export const HORA_HASTA = 22

const ms = (iso) => {
  const t = new Date(iso || 0).getTime()
  return Number.isFinite(t) ? t : 0
}
const limpio = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/**
 * @param {{ hilo: Array<{direccion:string, tipo:string, mensaje:string, timestamp:string}>,
 *           entranteEsperadoAt: string, salienteEsperadoAt: string, texto: string,
 *           ahoraMs?: number }} args
 *   `hilo` = respuesta de /api/hilo (viejo → nuevo). `entranteEsperadoAt` /
 *   `salienteEsperadoAt` = fecha del último mensaje del cliente / nuestro cuando
 *   se armó la lista.
 * @returns {{ ok: true } | { ok: false, motivo: string }}
 */
export function revisarAntesDeEnviar({ hilo, entranteEsperadoAt, salienteEsperadoAt, texto, ahoraMs = Date.now() }) {
  const msgs = Array.isArray(hilo) ? hilo : []
  if (!msgs.length) return { ok: false, motivo: 'no se pudo leer el chat' }

  const hora = horaEcuador(ahoraMs)
  if (hora < HORA_DESDE || hora >= HORA_HASTA) return { ok: false, motivo: 'fuera de horario (08:00–22:00)' }

  const ultimo = msgs[msgs.length - 1]
  const entrantes = msgs.filter(m => m.direccion === 'ENTRANTE')
  const ultimoIn = entrantes[entrantes.length - 1]
  if (!ultimoIn) return { ok: false, motivo: 'el cliente nunca escribió: no hay ventana' }

  // 1 s de tolerancia: la fecha viaja como texto y puede perder milisegundos.
  if (ms(ultimoIn.timestamp) > ms(entranteEsperadoAt) + 1000) {
    return { ok: false, motivo: 'el cliente escribió después de armar la lista' }
  }
  if (ultimo.direccion === 'ENTRANTE') return { ok: false, motivo: 'el cliente espera respuesta de una persona' }

  const restanteMin = (ms(ultimoIn.timestamp) + 24 * H - ahoraMs) / 60000
  if (restanteMin < MARGEN_VENTANA_MIN) return { ok: false, motivo: 'la ventana de 24 h está cerrada o por cerrar' }

  const yaMandado = msgs.some(m => m.direccion === 'SALIENTE' && limpio(m.mensaje) === limpio(texto))
  if (yaMandado) return { ok: false, motivo: 'ya se le mandó este mismo texto' }

  const salientes = msgs.filter(m => m.direccion === 'SALIENTE')
  const ultimoOut = salientes[salientes.length - 1]
  if (ultimoOut && ms(ultimoOut.timestamp) > ms(salienteEsperadoAt) + 1000) {
    return { ok: false, motivo: 'alguien ya le escribió después de armar la lista' }
  }

  return { ok: true }
}

/**
 * Revisa la forma del archivo del lote antes de tocar nada.
 * @param {Array<object>} lote  [{ telefono, phone_id, texto, entrante_at, saliente_at, nombre? }]
 * @returns {string[]} errores (vacío = el lote está bien formado)
 */
export function validarLote(lote) {
  if (!Array.isArray(lote)) return ['el lote tiene que ser una lista']
  const errores = []
  lote.forEach((d, i) => {
    const quien = `#${i + 1} (${d?.nombre || d?.telefono || '?'})`
    if (String(d?.telefono || '').replace(/\D/g, '').length < 9) errores.push(`${quien}: falta el teléfono`)
    if (!String(d?.phone_id || '').trim()) errores.push(`${quien}: falta phone_id (el número por el que sale)`)
    if (!limpio(d?.texto)) errores.push(`${quien}: falta el texto`)
    // /api/saliente convierte "LINKPAGO35" en un cobro real: un lote nunca debe hacerlo.
    if (/LINKPAGO/i.test(String(d?.texto || ''))) errores.push(`${quien}: el texto trae LINKPAGO`)
    // El "▎" de una cita de markdown copiada con el texto (le llegó así a un cliente el 25-sep).
    if (/[▎▍▌│]/.test(String(d?.texto || ''))) errores.push(`${quien}: el texto trae "▎" de una cita copiada`)
    if (!ms(d?.entrante_at)) errores.push(`${quien}: falta entrante_at (último mensaje del cliente)`)
    if (!ms(d?.saliente_at)) errores.push(`${quien}: falta saliente_at (último mensaje nuestro)`)
  })
  return errores
}
