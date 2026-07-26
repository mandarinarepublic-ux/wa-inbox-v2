import { NextResponse } from 'next/server'
import { enviarPush, pushConfigurado } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// El secreto va SOLO por cabecera. A diferencia del cron (que Vercel invoca con
// x-vercel-cron), esta ruta la dispara una persona a mano, y un ?key= en la URL
// termina guardado en el historial del navegador y en los logs de request de
// Vercel. Encima es el MISMO CRON_SECRET que protege /api/cron/seguimientos, que
// envía WhatsApps de verdad: filtrarlo cuesta plata.
export async function GET(req) {
  const secret = process.env.CRON_SECRET
  const auth   = req.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
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
