import { NextResponse } from 'next/server'
import { getPago } from '@/lib/dlocal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Notificación de pago dLocal (reemplaza el escenario Make CONSULTA_LINKPAGO) ─
// dLocal llama aquí (notification_url) con un payment_id cuando cambia el estado
// del pago. Consultamos el detalle y avisamos por WhatsApp (plantilla ya aprobada
// "confirmacionpago_dlocalgo") al CLIENTE y al SOPORTE, igual que hacía Make.
//
// Apuntar en env: DLOCAL_NOTIFY_URL = https://wa-inbox-v2.vercel.app/api/pago-dlocal
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const GRAPH_URL     = `https://graph.facebook.com/v22.0/${META_PHONE_ID}/messages`
const SOPORTE_TEL   = String(process.env.SOPORTE_TEL || '593984159804').replace(/\D/g, '')

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// Plantilla confirmacionpago_dlocalgo (6 parámetros), misma lógica que Make.
function plantillaPago(to, p) {
  const paid = p?.status === 'PAID'
  const nombre = paid
    ? `${p?.payer?.first_name || 'Cliente'} ${p?.payer?.last_name || ''}`.trim()
    : 'Cliente'
  const estado = paid
    ? (p?.card?.issuer || 'N/A')
    : p?.status === 'EXPIRED' ? 'Link expirado'
    : p?.status === 'PENDING' ? 'Pago en proceso'
    : 'No completado'
  const t = (x) => ({ type: 'text', text: String(x ?? '-') })
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'confirmacionpago_dlocalgo',
      language: { code: 'en' },
      components: [{
        type: 'body',
        parameters: [
          t(p?.order_id || '-'),
          t(nombre),
          t(p?.amount ?? '-'),
          t(estado),
          t(paid ? (p?.payer?.document || 'N/A') : '-'),
          t(paid ? (p?.payer?.email || 'N/A') : '-'),
        ],
      }],
    },
  }
}

async function enviarPlantilla(to, p) {
  if (!to || !META_TOKEN) return
  const res = await fetch(GRAPH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(plantillaPago(to, p)),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    console.error(`[/api/pago-dlocal] Meta rechazó a ${to}:`, d?.error?.message || res.status)
  }
}

// Lee el body venga como JSON o como form-urlencoded (dLocal puede usar cualquiera).
async function leerBody(req) {
  const ctype = req.headers.get('content-type') || ''
  const text = await req.text().catch(() => '')
  if (ctype.includes('application/json')) { try { return JSON.parse(text) } catch { return {} } }
  try { return JSON.parse(text) } catch {}
  return Object.fromEntries(new URLSearchParams(text))
}

export async function POST(req) {
  try {
    const body = await leerBody(req)
    const paymentId = body?.payment_id || body?.id || body?.data?.id || ''
    if (!paymentId) return NextResponse.json({ ok: false, error: 'sin payment_id' })

    const pago = await getPago(paymentId)
    // order_id = "<telefono>-<timestamp>" → sacamos el teléfono del cliente.
    const clienteTel = soloDigitos(String(pago?.order_id || '').split('-')[0])

    await Promise.all([
      enviarPlantilla(clienteTel, pago),
      enviarPlantilla(SOPORTE_TEL, pago),
    ])

    return NextResponse.json({ ok: true, status: pago?.status })
  } catch (err) {
    console.error('[/api/pago-dlocal]', err.message)
    // 200 igual: si el error es nuestro, no queremos que dLocal reintente en loop.
    return NextResponse.json({ ok: false, error: err.message })
  }
}
