import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// Historial de pedidos del cliente — FUENTE: Supabase, schema `crm` (pedidos /
// clientes / detalle_pedido / cliente_conversacion). NO Google Sheets (legado).
// Match del teléfono → cliente_id por dos vías:
//   · crm.cliente_conversacion.telefono  (formato inbox 593…, ya vinculado)
//   · crm.clientes.celular               (formato 09…)
// Ambos por los últimos 9 dígitos, que coinciden en los dos formatos.
export const dynamic = 'force-dynamic'

const digits = (s) => String(s || '').replace(/\D/g, '')
const tail9  = (s) => digits(s).slice(-9)

const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
function fechaCorta(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`
}

const COLS_PEDIDO = 'pedido_id, cliente_id, fecha_pedido, estado_pedido, estado_pago, monto_total'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const telefono = searchParams.get('telefono') || ''
  const idVenta  = String(searchParams.get('idVenta') || '').trim()
  if (!telefono && !idVenta) {
    return NextResponse.json({ error: 'Falta el parámetro telefono' }, { status: 400 })
  }

  try {
    const crm = getSupabase().schema('crm')
    const t9  = tail9(telefono)

    // 1) cliente_id(s) del teléfono (puente conversación→cliente + celular)
    const clienteIds = new Set()
    if (t9.length >= 8) {
      const [cc, cl] = await Promise.all([
        crm.from('cliente_conversacion').select('cliente_id').like('telefono', `%${t9}`),
        crm.from('clientes').select('cliente_id').like('celular', `%${t9}`),
      ])
      ;(cc.data || []).forEach(r => r.cliente_id && clienteIds.add(String(r.cliente_id)))
      ;(cl.data || []).forEach(r => r.cliente_id && clienteIds.add(String(r.cliente_id)))
    }

    // 2) pedidos por cliente_id, más el pedido cuyo id == idVenta guardado en el inbox
    const ids = [...clienteIds]
    const pedidos = []
    const vistos = new Set()
    const push = (arr) => (arr || []).forEach(p => {
      const k = String(p.pedido_id || '')
      if (k && !vistos.has(k)) { vistos.add(k); pedidos.push(p) }
    })
    if (ids.length) {
      const { data } = await crm.from('pedidos').select(COLS_PEDIDO).in('cliente_id', ids)
      push(data)
    }
    if (idVenta) {
      const { data } = await crm.from('pedidos').select(COLS_PEDIDO).eq('pedido_id', idVenta)
      push(data)
    }

    // 3) ítems por pedido (excluye eliminados)
    const pedidoIds = pedidos.map(p => String(p.pedido_id))
    const itemsByPedido = {}
    if (pedidoIds.length) {
      const { data: det } = await crm.from('detalle_pedido')
        .select('pedido_id, producto_nombre, talla, color, cantidad, precio_unit, subtotal, eliminado, subestado')
        .in('pedido_id', pedidoIds)
      ;(det || []).forEach(d => {
        if (d.eliminado === true || String(d.subestado || '').toUpperCase() === 'ELIMINADO') return
        ;(itemsByPedido[d.pedido_id] ||= []).push({
          producto: d.producto_nombre || '',
          talla:    d.talla || '',
          color:    d.color || '',
          cantidad: Number(d.cantidad || 1) || 1,
          precio:   Number(d.precio_unit || d.subtotal || 0) || 0,
        })
      })
    }

    const CRM_URL = (process.env.MANDARINACRM_URL || 'https://mandarina-pro-sales.vercel.app').replace(/\/$/, '')

    const out = pedidos
      .map(p => {
        const pid = String(p.pedido_id || '')
        return {
          id:         pid,
          fecha:      fechaCorta(p.fecha_pedido),
          _ts:        p.fecha_pedido ? new Date(p.fecha_pedido).getTime() : 0,
          estado:     p.estado_pedido || '',
          estadoPago: p.estado_pago || '',
          total:      Number(p.monto_total || 0) || 0,
          url:        pid ? `${CRM_URL}/dashboard/pedido/${encodeURIComponent(pid)}` : '',
          items:      itemsByPedido[pid] || [],
        }
      })
      .sort((a, b) => b._ts - a._ts)

    const totalGastado = out.reduce((s, p) => s + (p.total || 0), 0)

    return NextResponse.json({
      telefono,
      totalPedidos: out.length,
      totalGastado: Math.round(totalGastado * 100) / 100,
      pedidos: out.map(({ _ts, ...p }) => p),
    })
  } catch (err) {
    console.error('[/api/cliente-pedidos] (crm supabase):', err?.message || err)
    return NextResponse.json(
      { error: 'No se pudo leer el CRM (Supabase)', detalle: String(err?.message || err).slice(0, 200) },
      { status: 502 },
    )
  }
}
