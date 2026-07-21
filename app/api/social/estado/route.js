import { NextResponse } from 'next/server'
import { updateSocialEstadoSupabase } from '@/lib/social-supabase'

// Cambia el estado (PENDIENTE/VENTAPROCESO/ATENDIDO/ARCHIVADO) de una conversación
// del Social Inbox. Actualiza todas las filas de esa conversación en Supabase.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req) {
  try {
    const { canal, sender_id, estado } = await req.json()
    if (!sender_id || !estado) {
      return NextResponse.json({ error: 'faltan sender_id o estado' }, { status: 400 })
    }
    await updateSocialEstadoSupabase(canal || 'FB', sender_id, estado)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/social/estado]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
