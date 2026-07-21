import { NextResponse } from 'next/server'
import { buscarMensajes } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/buscar?q=hoodie → mensajes que casan, en TODO el historial.
// (Antes el buscador "por mensaje" solo miraba lo que ya estaba en el navegador.)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q') || ''
    const mensajes = await buscarMensajes(q)
    return NextResponse.json(mensajes, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err) {
    console.error('[/api/buscar]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
