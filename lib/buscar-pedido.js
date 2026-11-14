// lib/buscar-pedido.js — buscar CHATS por el ID de un pedido del CRM.
//
// Por qué existe (13-nov-2026): el buscador del inbox solo encontraba por contacto
// (nombre o número) y por mensajes. Con el ID de pedido en la mano (la hoja impresa,
// la guía, el CRM) no había cómo llegar al chat del cliente.
//
// Se acepta el ID completo ("MAN-XAV-6558") o solo el número ("6558", que es el
// `unique_id` del pedido y lo que va al final del ID). El chat se encuentra por los
// últimos 9 dígitos del celular del cliente Y por el teléfono de origen del pedido
// (`origen_telefono`: el chat desde el que se creó, cuando el cliente pagó o dio
// otro número).

/**
 * Lo escrito en el buscador → qué buscar. null si no sirve.
 *   "6558"          → { tipo: 'numero', numero: 6558 }
 *   "man-xav-6558"  → { tipo: 'id', id: 'MAN-XAV-6558' }
 *   "xav-65"        → { tipo: 'id', id: 'XAV-65' }  (parcial, por ilike)
 */
export function queBuscar(q) {
  const t = String(q || '').trim().replace(/^#/, '')
  if (!t) return null
  if (/^\d+$/.test(t)) {
    // 1 o 2 dígitos traerían cientos de pedidos: no sirve para encontrar UN chat.
    if (t.length < 3) return null
    return { tipo: 'numero', numero: Number(t) }
  }
  const id = t.toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9-]{3,}$/.test(id) || !/\d/.test(id)) return null
  return { tipo: 'id', id }
}

export const tail9 = (t) => String(t || '').replace(/\D/g, '').slice(-9)

/**
 * Filas del CRM → { [t9]: { pedido_id, estado_pedido, cliente } }, el pedido más
 * reciente gana si un mismo celular tiene varios que casan.
 */
export function indexarPorTelefono(filas) {
  const out = {}
  const ordenadas = [...(filas || [])].sort((a, b) => String(b.fecha_pedido || '').localeCompare(String(a.fecha_pedido || '')))
  for (const p of ordenadas) {
    const hit = { pedido_id: p.pedido_id, estado_pedido: p.estado_pedido || '', cliente: String(p.clientes?.nombre || '').trim() }
    for (const tel of [p.clientes?.celular, p.origen_telefono]) {
      const k = tail9(tel)
      if (k.length === 9 && !out[k]) out[k] = hit
    }
  }
  return out
}

/** Server-side: pedidos que casan con `q`, indexados por teléfono. */
export async function buscarChatsPorPedido(sb, q) {
  const b = queBuscar(q)
  if (!b) return {}
  const crm = sb.schema('crm')
  let consulta = crm.from('pedidos')
    .select('pedido_id, estado_pedido, fecha_pedido, origen_telefono, clientes(nombre, celular)')
  consulta = b.tipo === 'numero'
    ? consulta.or(`unique_id.eq.${b.numero},pedido_id.ilike.%-${b.numero}`)
    : consulta.ilike('pedido_id', `%${b.id}%`)
  const { data, error } = await consulta.order('fecha_pedido', { ascending: false }).limit(30)
  if (error) throw error
  return indexarPorTelefono(data)
}
