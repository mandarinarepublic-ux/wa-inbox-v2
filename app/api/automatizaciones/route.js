import { NextResponse } from 'next/server'
import { getAutomatizaciones, setAutomatizaciones } from '@/lib/automatizaciones'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET → config actual (saludos on/off + textos). POST → guarda un patch y devuelve la config.
export async function GET() {
  try {
    const config = await getAutomatizaciones()
    return NextResponse.json({ ok: true, config })
  } catch (err) {
    console.error('[/api/automatizaciones GET]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const patch = await req.json().catch(() => ({}))
    const config = await setAutomatizaciones(patch)
    return NextResponse.json({ ok: true, config })
  } catch (err) {
    console.error('[/api/automatizaciones POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
