import { NextResponse } from 'next/server'
import { getMensajeById } from '@/lib/mensajes'

export const dynamic = 'force-dynamic'

// GET /api/mensaje?id=<wamid>
// Resuelve el mensaje citado (reply) aunque esté fuera de la ventana reciente.
export async function GET(req) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    const msg = await getMensajeById(id)
    return NextResponse.json(msg)
  } catch (err) {
    console.error('[/api/mensaje]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
