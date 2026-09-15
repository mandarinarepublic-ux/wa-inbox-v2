import { NextResponse } from 'next/server'
import { contarPasos } from '@/lib/flujos'

export const dynamic = 'force-dynamic'

// Contadores por nodo del lienzo: clientes DISTINTOS que pasaron por cada nodo en
// los últimos `dias` (30 por defecto). Detrás del login, como todo /api/flujos.
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const flujo_id = String(searchParams.get('flujo_id') || '').trim()
  const dias = Math.min(365, Math.max(1, Number(searchParams.get('dias')) || 30))
  if (!flujo_id) return NextResponse.json({ ok: false, error: 'falta flujo_id', porNodo: {} }, { status: 400 })
  try {
    const desde = new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString()
    const porNodo = await contarPasos(flujo_id, desde)
    return NextResponse.json({ ok: true, porNodo, dias })
  } catch (e) {
    console.error('[/api/flujos/pasos]', e.message)
    return NextResponse.json({ ok: false, error: e.message, porNodo: {} }, { status: 500 })
  }
}
