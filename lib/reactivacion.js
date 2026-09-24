// lib/reactivacion.js — ¿Le toca un mensaje automático a un cliente que se quedó
// callado ANTES de comprar? (diseño 2026-09-22 §5, fase 3; port a MANDI 23-sep, etapa 3)
//
// Solo le escribe si se cumple TODO:
//   · el chat está 🟢 ATENDIDO EN EL NÚMERO por el que escribió (en MANDI la
//     bandeja es por número: el cron pone `estado` = la bandeja de `phoneId`) y el último mensaje nuestro lo escribió una PERSONA
//     (`ultimo_humano_at` posterior al último entrante). Un flujo, la IA o un
//     automático NO cuentan como atención: un lead que solo recibió la respuesta
//     del flujo sigue 🔴 y le toca a una persona (revisión 22-sep, C1).
//   · hace ≥3 h que escribió esa persona (nunca minutos después de contestar, C2)
//   · no hay 📌 (si le debemos algo, se avisa al vendedor, no al cliente)
//   · no está en 🤫, no es contacto interno ni archivado
//   · etapa 💬 Cotizando o 💳 Esperando pago, sin pedido reciente en ninguna tienda
//   · no hubo otro automático en esta ventana, salvo nuestros toques (I3)
//   · ventana de 24 h abierta (desde el último mensaje del cliente)
//   · entre 08:00 y 22:00 hora de Ecuador (nunca de noche)
//   · el bot no está llevando ese chat. En MANDI tampoco si el cron lo
//     DESPERTARÍA ('despertar'): ahí escribe el agente, no un texto fijo.
//
// Toques a las 3, 12 y 20 h del último mensaje del cliente, ≥4 h entre toques.
// Si hay varios atrasados (pasó la noche), se manda SOLO el más avanzado y se
// saltan los otros: nada de ráfagas a las 08:00 (I2). Un texto vacío en la
// config = ese toque no se manda (I9).
//
// Arranca APAGADA (config.reactivacion.activo = false): la prende Rodrigo.
// Módulo PURO.
import { etapaVigente } from './etiqueta-crm.js'
import { caminoDeSeguimiento } from './camino-seguimiento.js'

const H = 3600 * 1000
export const HORAS_TOQUES = [3, 12, 20]
export const SILENCIO_MIN_H = 3          // desde el último mensaje de una persona
export const MIN_ENTRE_TOQUES_H = 4
export const PEDIDO_RECIENTE_DIAS = 3    // cualquier pedido así de reciente = ya compró
export const HORA_DESDE = 8
export const HORA_HASTA = 22

// Textos de Mandarina: los tres de los seguimientos por temperatura que tenía
// Rodrigo (🌤️ 12 h, 🔥 23 h, ❄️ 22 h) pasan a ser los toques de 💬 Cotizando.
export const TEXTOS_DEFECTO = {
  cotizando: [
    '¡Hola {nombre}! 🧡 ¿Pudiste pensarlo? Cuéntame si te ayudo con alguna talla, color o el envío 😊',
    'Hola {nombre} 🧡 ¿Seguimos con tu pedido? Estoy aquí para ayudarte a cerrarlo cuando quieras 😊',
    '¡Hola {nombre}! 🧡 Pasaba a saludarte por si aún te interesa. Cualquier cosa, aquí estoy 😊',
  ],
  esperando_pago: [
    '¡Hola {nombre}! 🧡 ¿Pudiste hacer la transferencia? Apenas me mandes el comprobante dejo listo tu pedido 😊',
    '¡Buen día {nombre}! ☀️ Tu pedido está listo para pasar a producción apenas confirmes el pago 🧡',
    'Hola {nombre} 🧡 te escribo antes de que se cierre nuestro chat. ¿Te ayudo con algo del pago?',
  ],
}

/**
 * Parámetros editables desde AUTOS, con límites: un valor raro nunca puede hacer
 * que escriba de madrugada ni en ráfaga. Horario permitido entre 06:00 y 22:00.
 */
const acotar = (v, min, max, def) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def
}
export function parametrosReactivacion(r = {}) {
  // Cada hora conserva el índice del texto que tiene al lado en la pantalla: si
  // alguien escribe 12, 3, 20, sale a las 3 h el texto del "Toque 2" (el de 3 h),
  // no el del "Toque 1". Repetidas o fuera de 1–23 h se descartan.
  const crudas = Array.isArray(r.horas) ? r.horas : HORAS_TOQUES
  const toques = []
  crudas.slice(0, 3).forEach((v, idx) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < 1 || n > 23 || toques.some(t => t.hora === n)) return
    toques.push({ hora: n, idx })
  })
  toques.sort((a, b) => a.hora - b.hora)
  const desde = acotar(r.hora_desde, 6, 12, HORA_DESDE)
  const hasta = Math.max(desde + 4, acotar(r.hora_hasta, 14, 22, HORA_HASTA))
  const finales = toques.length ? toques : HORAS_TOQUES.map((hora, idx) => ({ hora, idx }))
  return {
    horas: finales.map(t => t.hora),
    indiceTexto: finales.map(t => t.idx),
    silencioMinH: acotar(r.silencio_min_h, 1, 12, SILENCIO_MIN_H),
    entreToquesH: acotar(r.entre_toques_h, 2, 12, MIN_ENTRE_TOQUES_H),
    horaDesde: desde,
    horaHasta: Math.min(22, hasta),
  }
}

const ms = (iso) => {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Hora (0–23) en Ecuador: UTC−5 todo el año, sin horario de verano. */
export function horaEcuador(ahoraMs) {
  return new Date(ahoraMs - 5 * H).getUTCHours()
}

// El nombre de perfil de WhatsApp puede ser "Mamá", "Dios es amor" o un emoji.
// Solo se usa si parece un nombre de pila; si no, el mensaje va sin nombre.
const NO_SON_NOMBRES = new Set(['mama', 'mami', 'papa', 'papi', 'dios', 'amor', 'bebe', 'hola', 'jesus', 'cliente', 'tienda', 'la', 'el', 'mi'])
export function nombreDePila(alias, nombre) {
  for (const fuente of [alias, nombre]) {
    const primera = String(fuente || '').trim().split(/\s+/)[0] || ''
    if (!/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{2,15}$/.test(primera)) continue
    const llano = primera.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    if (NO_SON_NOMBRES.has(llano)) continue
    return primera.charAt(0).toUpperCase() + primera.slice(1).toLowerCase()
  }
  return ''
}

/** Reemplaza {nombre} sin dejar "¡Hola !" cuando no hay nombre. */
export function ponerNombre(texto, nombre) {
  let t = String(texto || '')
  if (nombre) return t.replaceAll('{nombre}', nombre)
  t = t.replace(/\{nombre\},\s*/g, '').replace(/\s+\{nombre\}/g, '').replaceAll('{nombre}', '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * @param {{config:object, contacto:object, pedido?:object|null, ahoraMs?:number}} args
 *   contacto = { telefono, nombre, alias, phoneId, estado, idVenta, etapa, etapaAt,
 *                deudaAt, sinAutomaticos, tipoContacto, ultimoEntranteAt, ultimoHumanoAt,
 *                ultimoSeguimientoAt, reactivacionN, reactivacionAt, modoIA }
 * @returns {{ toque:number, etapa:string, texto:string, nNuevo:number } | null}
 *   `toque` = número de toque a mandar (1..3); `nNuevo` = valor que queda en el contador.
 */
export function decidirReactivacion({ config, contacto: c, pedido = null, ahoraMs = Date.now() }) {
  const r = config?.reactivacion
  if (!r?.activo || !c) return null
  const p = parametrosReactivacion(r)
  if (c.tipoContacto === 'interno' || c.sinAutomaticos || c.deudaAt) return null
  if (String(c.estado || '').toLowerCase() !== 'atendido') return null
  if (String(c.idVenta || '').trim()) return null
  if (pedido?.fecha_pedido && ahoraMs - ms(pedido.fecha_pedido) <= PEDIDO_RECIENTE_DIAS * 24 * H) return null
  const etapa = etapaVigente(c.etapa, c.etapaAt, pedido)
  if (etapa !== 'cotizando' && etapa !== 'esperando_pago') return null
  // El bot lleva el chat ('saltar') o lo despertaría ('despertar'): ninguno es un texto nuestro.
  if (caminoDeSeguimiento({ config, contacto: c }) !== 'texto') return null

  const ent = ms(c.ultimoEntranteAt)
  const humano = ms(c.ultimoHumanoAt)
  if (!ent || !(humano > ent)) return null                    // nos toca / nadie atendió todavía
  if ((ahoraMs - humano) / H < p.silencioMinH) return null     // recién contestamos
  const h = (ahoraMs - ent) / H
  if (h < 0 || h >= 24) return null                           // ventana cerrada
  const hora = horaEcuador(ahoraMs)
  if (hora < p.horaDesde || hora >= p.horaHasta) return null   // nunca de noche

  // Otro automático en esta ventana que no fue nuestro toque → nada.
  const seg = ms(c.ultimoSeguimientoAt)
  const toqueAt = ms(c.reactivacionAt)
  if (seg > ent && Math.abs(seg - toqueAt) > 60 * 1000) return null

  const umbrales = p.horas
  const n = Number(c.reactivacionN) || 0
  // El toque más avanzado que ya se cumplió; los atrasados se saltan.
  let k = -1
  for (let i = 0; i < umbrales.length; i++) if (h >= umbrales[i]) k = i
  if (k < n) return null
  if (toqueAt > ent && (ahoraMs - toqueAt) / H < p.entreToquesH) return null

  const lista = r.textos?.[etapa]
  const it = p.indiceTexto[k]
  const plantilla = Array.isArray(lista) ? String(lista[it] ?? '') : (TEXTOS_DEFECTO[etapa][it] || '')
  if (!plantilla.trim()) return null                          // texto vacío = no mandar ese toque
  const texto = ponerNombre(plantilla, nombreDePila(c.alias, c.nombre)).trim()
  return { toque: k + 1, etapa, texto, nNuevo: k + 1 }
}
