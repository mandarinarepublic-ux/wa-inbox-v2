import { NextResponse } from 'next/server'
import { enviarPush, pushConfigurado } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req) {
  const secret = process.env.CRON_SECRET
  const auth   = req.headers.get('authorization') || ''
  const keyQ   = new URL(req.url).searchParams.get('key')
  if (!secret || (auth !== `Bearer ${secret}` && keyQ !== secret)) {
    return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 })
  }

  if (!pushConfigurado()) {
    return NextResponse.json({ ok: false, error: 'faltan las claves VAPID' }, { status: 503 })
  }

  const r = await enviarPush({
    titulo: '🔔 Prueba de avisos',
    cuerpo: 'Si ves esto, los avisos del inbox funcionan.',
    url:    '/inbox',
    tag:    'prueba',
  })
  return NextResponse.json(r)
}
