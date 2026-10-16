// POST /api/codigo-acceso { celular, codigo } — manda el código de acceso del club de
// premios por WhatsApp, con la plantilla de Autenticación `codigo_acceso` y el token
// de Meta de este inbox. Candado: Authorization: Bearer $FIDELIDAD_OTP_TOKEN.
// Ver lib/codigo-acceso.js. ☠️ Un 200 de Meta no es entrega (131047 llega después).
import { NextResponse } from 'next/server'
import { llaveValida, armarCodigoAcceso } from '@/lib/codigo-acceso'
import { GRAPH } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const PHONE_ID_POR_DEFECTO = '1024077200794372' // MANDI, el número que tiene `codigo_acceso` aprobada

export async function POST(req) {
  if (!llaveValida(req.headers.get('authorization'), process.env.FIDELIDAD_OTP_TOKEN)) {
    return NextResponse.json({ ok: false, error: 'sin permiso' }, { status: 401 })
  }
  const token = String(process.env.META_TOKEN || '').replace(/[^\x21-\x7E]/g, '')
  if (!token) return NextResponse.json({ ok: false, error: 'META_TOKEN no está configurado' }, { status: 500 })
  const datos = await req.json().catch(() => ({}))
  const armado = armarCodigoAcceso({ celular: datos.celular, codigo: datos.codigo })
  if (!armado.ok) return NextResponse.json({ ok: false, error: armado.error }, { status: 400 })
  const phoneId = process.env.META_PHONE_ID || PHONE_ID_POR_DEFECTO
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(armado.cuerpo),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const e = data?.error || {}
      console.error('[/api/codigo-acceso] Meta:', e.message, e.code)
      return NextResponse.json({ ok: false, error: e.error_user_msg || e.message || `HTTP ${res.status}`, code: e.code }, { status: 502 })
    }
    return NextResponse.json({ ok: true, wamid: data?.messages?.[0]?.id || null })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
