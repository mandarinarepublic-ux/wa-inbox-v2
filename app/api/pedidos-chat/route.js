import { NextResponse } from 'next/server'
import { getPedidosPorTelefono } from '@/lib/contactos'

export const dynamic = 'force-dynamic'

// GET /api/pedidos-chat → { pedidos: { [últimos 9 dígitos]: pedido } }
// Etiqueta CRM al lado de cada chat (diseño 2026-09-22 §2.6). La pantalla lo pide
// al cargar y cada 5 min: NO va en /api/inbox-sync, que es la ruta caliente.
export async function GET() {
  try {
    const pedidos = await getPedidosPorTelefono()
    return NextResponse.json({ pedidos }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[/api/pedidos-chat]', err.message)
    return NextResponse.json({ error: err.message, pedidos: {} }, { status: 500 })
  }
}
