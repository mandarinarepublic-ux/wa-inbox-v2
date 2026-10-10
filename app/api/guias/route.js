import { NextResponse } from 'next/server'
import { procesarGuias } from '@/lib/guias-registro'

// 🚚 Registrar en el CRM las guías de Servientrega reenviadas al inbox. Lo
// dispara el botón de AUTOMATIZACIONES (detrás del candado de sesión del
// middleware). `{ simular: true }` lee y empareja sin escribir nada.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const r = await procesarGuias({ simular: body?.simular === true })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[guias]', e)
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }
}
