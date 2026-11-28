// lib/puntaje.js — La cajita de PROBABILIDAD DE COMPRA de cada chat (28-nov-2026).
//
// El número lo calcula la base (docs/sql/2026-11-28-puntaje-compra.sql): un
// trigger lo mueve con cada mensaje del cliente y la tabla de probabilidades se
// recalcula sola cada lunes con los pedidos reales del CRM. Acá solo se decide
// CÓMO se pinta:
//
//   gris     0–9 %    curioso (el que solo pidió la info del anuncio)
//   amarillo 10–49 %  interesado
//   verde    50–99 %  por comprar
//   ⭐ 100 % dorado   ya tiene pedido en este episodio
//
// El ⭐ no sale de la base: sale del pedido que la pantalla ya trae
// (inbox.pedido_por_telefono, cualquier tienda) cuando es posterior al inicio
// del episodio. Así un pedido creado a mano se ve al instante, sin esperar al
// próximo mensaje del cliente.
//
// Módulo PURO: sin red, sin base, sin relojes escondidos (`ahoraMs` entra de afuera).

const DIA_MS = 24 * 60 * 60 * 1000
// El episodio dura lo que mide la tabla: compras dentro de los 30 días del
// primer mensaje. Pasado eso el número ya no dice nada y no se muestra.
export const DIAS_VIGENCIA = 30
// `fecha_pedido` del CRM ha llegado corrida unas horas (zona horaria): un pedido
// del mismo día que el primer mensaje no puede quedarse sin ⭐ por eso.
const MARGEN_PEDIDO_MS = 12 * 60 * 60 * 1000

export const COLORES = {
  gris: '#94a3b8',
  amarillo: '#fbbf24',
  verde: '#25d366',
  dorado: '#f5c518',
}

const NOMBRE_SENAL = { talla: 'talla', envio: 'envío', pago: 'pago' }

/** ['talla','envio','pago'] → 'talla, envío y pago' */
function enumerar(xs) {
  if (xs.length <= 1) return xs.join('')
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** El "por qué" del número, para el tooltip. */
export function motivoPuntaje({ motivo = '', n = 0, pauta = false } = {}) {
  const senales = String(motivo || '').split(',').map(s => s.trim()).filter(Boolean)
  const habla = senales.filter(s => NOMBRE_SENAL[s]).map(s => NOMBRE_SENAL[s])
  const partes = []
  if (habla.length) partes.push(`habló de ${enumerar(habla)}`)
  if (senales.includes('foto')) partes.push('mandó foto')
  if (!partes.length) partes.push('todavía no habla de talla, envío ni pago')
  const total = Math.max(0, Number(n) || 0)
  partes.push(`${total} ${total === 1 ? 'mensaje' : 'mensajes'}`)
  if (pauta) partes.push('vino de un anuncio')
  return partes.join(' · ')
}

export function colorDePct(pct) {
  if (pct >= 100) return COLORES.dorado
  if (pct >= 50) return COLORES.verde
  if (pct >= 10) return COLORES.amarillo
  return COLORES.gris
}

/**
 * @param {Object} c        ficha del contacto (toContacto): scorePct, scoreN, scoreMotivo,
 *                          scorePauta, scoreDesde, ultimoEntranteAt
 * @param {Object|null} pedido  fila de pedido_por_telefono para este teléfono
 * @returns {{ pct:number, estrella:boolean, color:string, texto:string, titulo:string } | null}
 */
export function puntajeChat(c, pedido = null, ahoraMs = Date.now()) {
  if (!c) return null
  const desde = Date.parse(c.scoreDesde || '')
  const ultimo = Date.parse(c.ultimoEntranteAt || '')
  // Sin episodio calculado, o el cliente no escribe hace más de 30 días: nada.
  if (!Number.isFinite(desde)) return null
  if (Number.isFinite(ultimo) && ahoraMs - ultimo > DIAS_VIGENCIA * DIA_MS) return null

  const fechaPedido = Date.parse(pedido?.fecha_pedido || '')
  const compro = !!pedido?.pedido_id && Number.isFinite(fechaPedido) && fechaPedido >= desde - MARGEN_PEDIDO_MS
  const porque = motivoPuntaje({ motivo: c.scoreMotivo, n: c.scoreN, pauta: c.scorePauta })
  if (compro) {
    return {
      pct: 100, estrella: true, color: COLORES.dorado, texto: '⭐ 100%',
      titulo: `Ya compró · pedido ${pedido.pedido_id} · ${porque}`,
    }
  }
  const pct = Number(c.scorePct)
  if (c.scorePct == null || !Number.isFinite(pct)) return null
  const p = Math.max(0, Math.min(99, Math.round(pct)))
  // 0 % no existe en la tabla (mínimo 0,5 %): se muestra 1 % para no decir "imposible".
  const visible = Math.max(1, p)
  return {
    pct: visible, estrella: false, color: colorDePct(visible), texto: `${visible}%`,
    titulo: `Probabilidad de compra ${visible}% · ${porque}`,
  }
}

/** Para ordenar: el ⭐ arriba de todo, un chat sin puntaje al fondo (-1). */
export function valorOrden(p) {
  return p ? p.pct : -1
}
