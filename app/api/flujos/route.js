import { NextResponse } from 'next/server'
import { getFlujos, guardarFlujo, borrarFlujo } from '@/lib/flujos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Lista de flujos de la cuenta (borrador + lo publicado), para la pestaña FLUJOS.
export async function GET() {
  try {
    const flujos = await getFlujos()
    return NextResponse.json({ ok: true, flujos })
  } catch (err) {
    console.error('[/api/flujos GET]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

// Guardar borrador: crea si no viene flujo_id, si no actualiza esa fila. Nunca
// toca publicado/grafo_vivo — eso es /api/flujos/publicar.
export async function POST(req) {
  try {
    const { flujo_id, nombre, grafo } = await req.json().catch(() => ({}))
    if (!nombre) return NextResponse.json({ ok: false, error: 'falta nombre' }, { status: 400 })
    const flujo = await guardarFlujo({ flujo_id, nombre, grafo })
    return NextResponse.json({ ok: true, flujo })
  } catch (err) {
    console.error('[/api/flujos POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function DELETE(req) {
  try {
    const flujo_id = new URL(req.url).searchParams.get('flujo_id')
    if (!flujo_id) return NextResponse.json({ ok: false, error: 'falta flujo_id' }, { status: 400 })
    await borrarFlujo(flujo_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/flujos DELETE]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
