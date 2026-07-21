import { NextResponse } from 'next/server'
import { getHilo } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/hilo?phone=593987654321&limite=800
// Historial COMPLETO de un chat. La lista lateral (/api/lista) trae solo el
// último mensaje de cada conversación; el hilo se pide aquí al abrir el chat.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const phone  = searchParams.get('phone') || ''
    const limite = Math.min(parseInt(searchParams.get('limite') || '800', 10) || 800, 3000)
    if (!phone) return NextResponse.json({ error: 'falta phone' }, { status: 400 })
    const mensajes = await getHilo(phone, limite)
    return NextResponse.json(mensajes, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err) {
    console.error('[/api/hilo]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
