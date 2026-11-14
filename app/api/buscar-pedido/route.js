import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { buscarChatsPorPedido } from '@/lib/buscar-pedido'

export const dynamic = 'force-dynamic'

// GET /api/buscar-pedido?q=6558 → { pedidos: { [últimos 9 dígitos]: { pedido_id, estado_pedido, cliente } } }
// Lo usa el buscador del inbox en modo "📦 Pedido" (lib/buscar-pedido.js).
export async function GET(req) {
  const q = new URL(req.url).searchParams.get('q') || ''
  try {
    const pedidos = await buscarChatsPorPedido(getSupabase(), q)
    return NextResponse.json({ pedidos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[/api/buscar-pedido]', err.message)
    return NextResponse.json({ error: err.message, pedidos: {} }, { status: 500 })
  }
}
