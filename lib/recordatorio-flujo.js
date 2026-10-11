// lib/recordatorio-flujo.js — Recordatorio de 12 h tras un FLUJO (prueba, oct-2026).
//
// A quien pasó por un flujo de producto (anuncio, orgánico o palabra; NO los de
// botón) y no volvió a escribir, le llega UN mensaje genérico a las 12 h. Una sola
// vez por cliente, para siempre (inbox.conversaciones.recordatorio_flujo_at).
//
// Medido antes de prender (14 días): 271 clientes pasaron por un flujo de anuncio y
// no escribieron en 12 h (~19/día), 237 de ellos del flujo de Dragon Ball. Y del que
// se calla para siempre, el 97 % no compra (cruce con el CRM, 3-sep a 3-oct).
// Informe: ind-inbox-next/reports/Recuperar clientes callados WhatsApp.md
//
// Quién es candidato lo decide la base (inbox.candidatos_recordatorio_flujo): no
// escribió después del flujo, ninguna persona le escribió después, ventana de 24 h
// abierta, sin IA, sin 📌, sin 🤫. Acá vive lo demás, puro para poder probarlo:
//   - el horario (nunca de noche),
//   - el GRUPO DE CONTROL: una parte de los candidatos NO recibe nada, a propósito.
//     Sin ese grupo no se puede saber si el mensaje vende o si esos clientes iban
//     a comprar igual (el mes base queda sesgado por la temporada).
//   - el cuerpo del mensaje con sus botones.

// Ecuador no tiene horario de verano: UTC-5 fijo.
const OFFSET_EC_H = -5

/** Hora local de Ecuador (0-23) de un Date. */
export function horaEcuador(ahora) {
  const h = (ahora.getUTCHours() + OFFSET_EC_H + 24) % 24
  return h
}

/** ¿Se puede escribir a esta hora? [desde, hasta) en hora de Ecuador. */
export function horaPermitida(ahora, { desde = 8, hasta = 21 } = {}) {
  const h = horaEcuador(ahora)
  return h >= desde && h < hasta
}

/**
 * Grupo estable por teléfono: el mismo cliente cae siempre en el mismo lado.
 * `control_digitos` = últimos dígitos que van a CONTROL ('05' → ~20 %).
 */
export function grupoDe(telefono, { control_digitos = '05' } = {}) {
  const d = String(telefono || '').replace(/\D/g, '').slice(-1)
  if (!d) return 'enviado'
  return String(control_digitos || '').includes(d) ? 'control' : 'enviado'
}

/**
 * Primer nombre, solo si parece un nombre de verdad. El nombre de perfil de
 * WhatsApp a veces es un emoji, un negocio o "Mi Amor": mejor sin nombre que con
 * uno raro. Respeta tildes y ñ; capitaliza.
 */
export function primerNombre(alias, nombre) {
  for (const fuente of [alias, nombre]) {
    const p = String(fuente || '').trim().split(/\s+/)[0] || ''
    if (/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,15}$/.test(p)) {
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    }
  }
  return ''
}

/** "{nombre}" → " Andrea" o nada, sin dejar espacios dobles ni ", ," */
export function armarTexto(plantilla, nombre) {
  const n = String(nombre || '').trim()
  return String(plantilla || '')
    .replace(/\s*\{nombre\}/g, n ? ` ${n}` : '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * El cuerpo para /api/saliente. Con botones va como `interactive_buttons` (ids
 * rc_1..rc_3, igual que las respuestas rápidas). Títulos de máximo 20 caracteres:
 * Meta rechaza el mensaje entero si uno se pasa.
 */
export function cuerpoSaliente({ telefono, nombre, phoneId, texto, botones = [] }) {
  const titulos = (Array.isArray(botones) ? botones : [])
    .map((b) => String(b || '').trim().slice(0, 20)).filter(Boolean).slice(0, 3)
  const base = { Telefono: telefono, Nombre: nombre || '', Canal: phoneId }
  if (!titulos.length) return { ...base, Mensaje: texto }
  return {
    ...base,
    TipoMensaje: 'interactive_buttons',
    Cuerpo: texto,
    Botones: JSON.stringify(titulos.map((title, i) => ({ type: 'reply', reply: { id: `rc_${i + 1}`, title } }))),
  }
}

/**
 * Una pasada del recordatorio. deps = { candidatos(horas)→[], reclamar(tel, {grupo,
 * ultimoEntranteAt, ultimoHumanoAt})→bool, enviar(cuerpo)→{ok,status?}, log? }.
 * El CONTROL también se reserva (con grupo 'control') y no recibe nada: así queda
 * anotado para medir, y nunca recibe el mensaje más tarde.
 * Devuelve { saltado? , enviados:[], control:[], errores:[] }.
 */
export async function correrRecordatorioFlujo(deps, cfg, ahora = new Date()) {
  const c = cfg || {}
  const out = { enviados: [], control: [], errores: [] }
  if (!c.activo) return { ...out, saltado: 'apagado' }
  if (!String(c.texto || '').trim()) return { ...out, saltado: 'sin texto' }
  if (!horaPermitida(ahora, { desde: c.hora_desde ?? 8, hasta: c.hora_hasta ?? 21 })) return { ...out, saltado: 'fuera de horario' }
  const log = deps.log || console.log
  const lista = await deps.candidatos(c.horas ?? 12)
  for (const k of lista) {
    const grupo = grupoDe(k.telefono, { control_digitos: c.control_digitos ?? '05' })
    let ok = false
    try {
      ok = await deps.reclamar(k.telefono, { grupo, ultimoEntranteAt: k.ultimo_entrante_at, ultimoHumanoAt: k.ultimo_humano_at })
    } catch (e) { log('[recordatorio-flujo] reservar:', k.telefono, e.message) }
    if (!ok) continue
    if (grupo === 'control') { out.control.push(k.telefono); continue }
    const nombre = primerNombre(k.alias, k.nombre)
    const r = await deps.enviar(cuerpoSaliente({
      telefono: k.telefono, nombre: k.alias || k.nombre || '', phoneId: k.phone_id,
      texto: armarTexto(c.texto, nombre), botones: c.botones,
    }))
    if (r?.ok) out.enviados.push(k.telefono)
    else out.errores.push({ telefono: k.telefono, status: r?.status ?? 'red' })
  }
  if (out.enviados.length || out.control.length || out.errores.length) {
    log('[recordatorio-flujo]', `enviados ${out.enviados.length} · control ${out.control.length} · errores ${out.errores.length}`)
  }
  return out
}

