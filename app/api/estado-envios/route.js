import { NextResponse } from 'next/server'
import { bloqueoVigente } from '@/lib/bloqueo-cuenta'

// Lo pregunta el banner del inbox. Va aparte de /api/inbox-sync a propósito: ese
// contesta 304 sin cuerpo cuando la bandeja está quieta, y un bloqueo no cambia
// la bandeja, así que el aviso no llegaría a la pantalla.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ ok: true, bloqueo: await bloqueoVigente() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[/api/estado-envios]', e.message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
