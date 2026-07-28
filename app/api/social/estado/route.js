import { NextResponse } from 'next/server'
import { updateSocialEstadoSupabase } from '@/lib/social-supabase'

// Cambia el estado (pendiente/atendido/venta/soporte/archivado) y/o la temperatura
// (🔥/🌤️/❄️, Eje 2 manual) de una conversación del Social Inbox. Actualiza todas
// las filas de esa conversación en Supabase. Una conversación es canal + TIPO +
// sender: el comentario y el DM del mismo cliente son hilos distintos, así que el
// `tipo` tiene que viajar en la petición (si no, tocar uno cambia el otro).
// Estado y temperatura son independientes: se puede mandar solo uno de los dos.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req) {
  try {
    const { canal, sender_id, estado, temperatura, tipo } = await req.json()
    if (!sender_id || (!estado && !temperatura)) {
      return NextResponse.json({ error: 'faltan sender_id y (estado o temperatura)' }, { status: 400 })
    }
    await updateSocialEstadoSupabase(canal || 'FB', sender_id, { estado, temperatura }, tipo)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/social/estado]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
