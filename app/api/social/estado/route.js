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
    // OJO: quitar la marca de temperatura manda `temperatura: ''` a propósito (es un
    // valor válido, "sin clasificar"). Si acá se negara con `!temperatura` esa petición
    // se rechazaría con 400 antes de llegar a updateSocialEstadoSupabase, que sí sabe
    // interpretar el vacío como "quitar". Lo que hay que exigir es que el campo HAYA
    // VENIDO, no que no esté vacío — igual que /api/contactos/estado con `valor`.
    if (!sender_id || (estado === undefined && temperatura === undefined)) {
      return NextResponse.json({ error: 'faltan sender_id y (estado o temperatura)' }, { status: 400 })
    }
    await updateSocialEstadoSupabase(canal || 'FB', sender_id, { estado, temperatura }, tipo)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/social/estado]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
