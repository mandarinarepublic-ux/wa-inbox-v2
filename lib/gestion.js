// lib/gestion.js — las capas de gestión de un chat (diseño 2026-09-22 §2).
//
//   bandeja  (🔴🟢⚫)  → de quién es el turno
//   etapa    (💬💳🛒🔁) → en qué va la venta; la pone el vendedor (o un flujo si está vacía)
//   📌 deuda           → algo que le prometimos; solo lo apaga una persona
//   🤫                 → sin mensajes automáticos a este cliente
//   tipo de contacto   → cliente | interno (equipo, taller, proveedor)
//
// REGLA DE ORO: un mensaje del cliente solo mueve la bandeja. Nunca borra la etapa,
// el 📌, el 🤫 ni el tipo de contacto.
//
// Módulo PURO: sin red ni base.
import { temperaturaDe, horasDesde, textoHoras, TEMPERATURAS } from './temperatura.js'

export const ETAPAS = {
  cotizando:      { icon: '💬', label: 'Cotizando',      color: '#a78bfa' },
  esperando_pago: { icon: '💳', label: 'Esperando pago', color: '#f472b6' },
  falta_pedido:   { icon: '🛒', label: 'Falta pedido',   color: '#10b981' },
  postventa:      { icon: '🔁', label: 'Postventa',      color: '#38bdf8' },
}

export const esEtapa = (v) => Object.prototype.hasOwnProperty.call(ETAPAS, v)

/**
 * Traduce lo que llega como `estado` a la ruta de contactos.
 *
 * Hay DOS fuentes que todavía mandan estados que ya no son bandejas:
 *  - `indx-agent` pide `SOPORTE` cuando la IA no sabe y le pasa el chat a una
 *    persona. Eso es una promesa ("verifico y te confirmo"): 🔴 + 📌 🎧.
 *  - Pestañas abiertas con el JS de antes del despliegue (💰 → VENTA, 📋 → ENCUESTA).
 * Nada de esto puede esconder un chat ni devolver un 500.
 *
 * @returns {{ estado?: 'PENDIENTE'|'ATENDIDO'|'ARCHIVADO', deuda?: {nota:string, por:'ia'}, etapa?: string }}
 */
export function traducirEstadoLegado(valor) {
  const v = String(valor || '').trim().toUpperCase()
  if (v === 'PENDIENTE' || v === 'ATENDIDO' || v === 'ARCHIVADO') return { estado: v }
  if (v === 'SOPORTE') return { estado: 'PENDIENTE', deuda: { nota: 'Soporte', por: 'ia' } }
  if (v === 'ENCUESTA') return { estado: 'ATENDIDO' }
  if (v === 'VENTA') return { etapa: 'falta_pedido' }
  return {}
}

/** Marcar 🟢 a mano cuando lo último lo escribió el cliente pide confirmación. */
export function necesitaConfirmarAtendido(ultimaDireccion) {
  return String(ultimaDireccion || '').toUpperCase() === 'ENTRANTE'
}

export const AVISO_VENTANA_H = 20
export const DEUDA_VIEJA_H = 12
export const ESPERA_MINIMA_MIN = 10

const esCliente = (c) => c?.tipoContacto !== 'interno'

/** ⏰ La ventana de 24 h se cierra en ≤4 h y hay algo en juego (💬, 💳 o 📌). */
export function alertaVentanaCierra(c, ahoraMs = Date.now()) {
  if (!c || !esCliente(c) || c.estado === 'archivado') return false
  const enJuego = c.etapa === 'cotizando' || c.etapa === 'esperando_pago' || Boolean(c.deudaAt)
  if (!enJuego) return false
  const h = horasDesde(c.ultimoEntranteAt, ahoraMs)
  return h !== null && h >= AVISO_VENTANA_H && h < 24
}

/** 📌 prendido hace más de 12 h. */
export function deudaVieja(c, ahoraMs = Date.now()) {
  const h = horasDesde(c?.deudaAt, ahoraMs)
  return h !== null && h >= DEUDA_VIEJA_H
}

/**
 * Minutos que el cliente lleva esperando nuestra respuesta, o 0 si no aplica.
 * Solo cuenta en 🔴 (le toca a una persona) y para clientes.
 */
export function esperaCliente(c, ahoraMs = Date.now()) {
  if (!c || c.estado !== 'pendiente' || !esCliente(c)) return 0
  const h = horasDesde(c.ultimoEntranteAt, ahoraMs)
  return h === null ? 0 : Math.floor(h * 60)
}

const TONO_TEMP = { caliente: '#fb923c', tibio: '#fbbf24', frio: '#38bdf8', dormido: '#8f897e' }
const corto = (s, n = 26) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s))

/**
 * Las marcas que se pintan en la fila de un chat, en orden de lectura.
 * `c` = { estado, ultimoEntranteAt, etapa, etapaPor, deudaNota, deudaPor, deudaAt,
 *         sinAutomaticos, tipoContacto, pedido? (etiqueta CRM ya calculada) }
 * @returns {Array<{key:string, texto:string, color:string, titulo:string, pulso?:boolean}>}
 */
export function chipsDeChat(c, ahoraMs = Date.now()) {
  const out = []
  if (!c) return out
  const espera = esperaCliente(c, ahoraMs)
  if (espera >= ESPERA_MINIMA_MIN) {
    out.push({ key: 'espera', texto: `⏳ ${espera < 60 ? espera + ' min' : textoHoras(espera / 60)}`, color: '#f87171', titulo: 'El cliente está esperando tu respuesta' })
  }
  if (alertaVentanaCierra(c, ahoraMs)) {
    out.push({ key: 'alerta', texto: '⏰', color: '#fb923c', titulo: 'Se cierra la ventana de 24 h: escríbele ya', pulso: true })
  }
  const temp = temperaturaDe(c.ultimoEntranteAt, ahoraMs)
  if (temp) {
    const t = TEMPERATURAS[temp]
    out.push({ key: 'temp', texto: `${t.icon} ${textoHoras(horasDesde(c.ultimoEntranteAt, ahoraMs))}`, color: TONO_TEMP[temp], titulo: `Último mensaje del cliente: ${t.label}` })
  }
  if (esEtapa(c.etapa)) {
    const e = ETAPAS[c.etapa]
    out.push({ key: 'etapa', texto: `${e.icon} ${e.label}${c.etapaPor === 'flujo' ? ' · 🤖' : ''}`, color: e.color, titulo: c.etapaPor === 'flujo' ? 'La puso un flujo automático' : 'La puso un vendedor' })
  }
  if (c.deudaAt) {
    const vieja = deudaVieja(c, ahoraMs)
    const marca = c.deudaPor === 'ia' ? '📌 🎧' : '📌'
    const quien = c.deudaPor === 'ia' ? 'La IA le pasó el chat a una persona' : c.deudaPor === 'auto' ? 'Promesa detectada en tu mensaje' : 'La puso un vendedor'
    out.push({ key: 'deuda', texto: `${marca} ${corto(c.deudaNota || 'Le debemos algo')}${c.deudaPor === 'auto' ? ' · 🤖' : ''}`, color: vieja ? '#f87171' : '#fbbf24', titulo: `${quien}${vieja ? ' · hace más de 12 h' : ''}` })
  }
  if (c.pedido) out.push({ key: 'pedido', texto: c.pedido.texto, color: c.pedido.color || '#8f897e', titulo: c.pedido.titulo || '' })
  if (c.sinAutomaticos) out.push({ key: 'silencio', texto: '🤫', color: '#8f897e', titulo: 'Sin mensajes automáticos' })
  if (c.tipoContacto === 'interno') out.push({ key: 'interno', texto: '🏷️ Interno', color: '#8f897e', titulo: 'Contacto interno o proveedor' })
  return out
}
