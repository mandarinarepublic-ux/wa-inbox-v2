import { NextResponse } from 'next/server'
import { getLista } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/lista → último mensaje de CADA conversación, sobre todo el historial.
// Alimenta la lista lateral sin bajar el historial completo de la cuenta.
export async function GET() {
  try {
    const lista = await getLista()
    return NextResponse.json(lista, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (err) {
    console.error('[/api/lista]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
