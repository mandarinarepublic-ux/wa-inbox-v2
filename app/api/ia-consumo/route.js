import { NextResponse } from 'next/server'
import { resumenConsumoIASupabase } from '@/lib/inbox-supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// 💰 GET /api/ia-consumo?phone=… → consumo de tokens de la IA en ese chat y en el mes
// (inbox.ia_consumo). Ruta privada: la cubre el candado del CRM como a todo /api.
export async function GET(req) {
  try {
    const phone = new URL(req.url).searchParams.get('phone') || ''
    if (!phone.replace(/\D/g, '')) return NextResponse.json({ ok: false, error: 'Falta phone' }, { status: 400 })
    const resumen = await resumenConsumoIASupabase(phone)
    return NextResponse.json({ ok: true, ...resumen })
  } catch (err) {
    console.error('[/api/ia-consumo]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
