// lib/etiqueta-crm.js — el estado REAL del pedido, al lado del chat (diseño 2026-09-22 §2.6).
//
// Sale de la vista inbox.pedido_por_telefono (último pedido no cancelado por los
// últimos 9 dígitos, en cualquier tienda). Confirmado por Rodrigo el 22-sep:
// COMPLETADO = ya se despachó. Regla para el vendedor: nunca decir "ya fue
// enviado" sin ver 🚚. (Caso real: "ayer fue enviado" con el pedido EN_FABRICA.)
//
// Módulo PURO.

export const DIAS_DESPACHADO_VISIBLE = 7
const DIA_MS = 24 * 60 * 60 * 1000

export const tail9 = (tel) => String(tel || '').replace(/\D/g, '').slice(-9)

const dinero = (n) => `$${Number(n).toFixed(2).replace('.', ',')}`

/** @returns {{texto, color, titulo} | null} */
export function etiquetaPedido(p, ahoraMs = Date.now()) {
  if (!p || !p.pedido_id) return null
  const estado = String(p.estado_pedido || '').toUpperCase()
  const saldo = String(p.estado_pago || '').toUpperCase() === 'ABONO' && Number(p.monto_pendiente) > 0
  let base = null
  if (estado === 'EN_FABRICA') base = { icono: '🏭', label: 'En fábrica', color: '#a09a90', titulo: 'En producción: todavía NO salió' }
  else if (estado === 'DESPACHO') base = { icono: '📦', label: 'Por despachar', color: '#fbbf24', titulo: 'Listo, todavía no sale' }
  else if (estado === 'COMPLETADO') {
    const t = new Date(p.fecha_actualizacion || p.fecha_pedido).getTime()
    if (Number.isFinite(t) && ahoraMs - t <= DIAS_DESPACHADO_VISIBLE * DIA_MS) {
      base = { icono: '🚚', label: 'Despachado', color: '#38bdf8', titulo: 'Ya salió: puedes decir "ya fue enviado"' }
    }
  }
  if (!base && !saldo) return null
  const partes = []
  if (base) partes.push(`${base.icono} ${base.label} · ${p.pedido_id}`)
  if (saldo) partes.push(`💳 Saldo ${dinero(p.monto_pendiente)}`)
  return {
    texto: partes.join(' · '),
    color: base?.color || '#f472b6',
    titulo: [base?.titulo, saldo ? `Pagó un abono: falta ${dinero(p.monto_pendiente)}` : ''].filter(Boolean).join(' · '),
  }
}

/**
 * La etapa que se MUESTRA: 💬 💳 🛒 se dan por cumplidas si el cliente tiene un
 * pedido creado DESPUÉS de marcarlas (el pedido se hizo en el CRM). 🔁 no.
 */
export function etapaVigente(etapa, etapaAt, pedido) {
  if (!etapa) return ''
  if (!['cotizando', 'esperando_pago', 'falta_pedido'].includes(etapa)) return etapa
  if (!pedido?.fecha_pedido) return etapa
  const tp = new Date(pedido.fecha_pedido).getTime()
  const te = new Date(etapaAt || 0).getTime()
  return Number.isFinite(tp) && tp >= (Number.isFinite(te) ? te : 0) ? '' : etapa
}
