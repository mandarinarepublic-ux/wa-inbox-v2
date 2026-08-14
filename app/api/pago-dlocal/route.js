import { NextResponse } from 'next/server'
import { getPago, notaResultadoPago } from '@/lib/dlocal'
import { crearNota } from '@/lib/notas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Notificación de pago dLocal (reemplaza el escenario Make CONSULTA_LINKPAGO) ─
// dLocal llama aquí (notification_url) con un payment_id cuando cambia el estado
// del pago. Consultamos el detalle y avisamos por WhatsApp (plantilla ya aprobada
// "confirmacionpago_dlocalgo") al CLIENTE y al SOPORTE, igual que hacía Make.
//
// Apuntar en env: DLOCAL_NOTIFY_URL = https://wa-inbox-v2.vercel.app/api/pago-dlocal?k=<secreto>
//
// ── Quién puede llamar aquí ────────────────────────────────────────────────────
// dLocal Go NO firma sus notificaciones, así que la única forma de saber que la
// llamada viene de un pago nuestro es un secreto compartido en la URL, que dLocal
// nos devuelve tal cual la guardamos al crear el link.
//
// Sin esto, cualquiera que conozca la URL puede dispararnos plantillas de
// WhatsApp: no a números arbitrarios (el destino sale del pago que consultamos a
// dLocal), pero sí reenviar confirmaciones a clientes reales con solo acertar un
// payment_id, y cada envío se cobra.
//
// PUESTA EN MARCHA, en este orden, para no perder confirmaciones en vuelo:
//   1. Desplegar esto. Mientras DLOCAL_NOTIFY_SECRET esté vacío NADA cambia.
//   2. Poner el secreto en DLOCAL_NOTIFY_URL (…/api/pago-dlocal?k=<secreto>): los
//      links nuevos ya lo llevan.
//   3. Cuando los links viejos hayan caducado o cobrado, setear
//      DLOCAL_NOTIFY_SECRET. Desde ahí, lo que no traiga la llave se rechaza.
const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const GRAPH_URL     = `https://graph.facebook.com/v22.0/${META_PHONE_ID}/messages`
const SOPORTE_TEL   = String(process.env.SOPORTE_TEL || '593984159804').replace(/\D/g, '')
// Limpia BOM y no imprimibles: cargar envs desde PowerShell mete un U+FEFF
// invisible que haría fallar la comparación solo en producción.
const NOTIFY_SECRET = String(process.env.DLOCAL_NOTIFY_SECRET || '').replace(/[^\x21-\x7E]/g, '')

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

// Comparación de largo constante: no le regalamos al atacante el tiempo de
// respuesta como pista de cuántos caracteres acertó.
function mismoSecreto(a, b) {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

function llamadaLegitima(req) {
  if (!NOTIFY_SECRET) return true // todavía sin configurar: se comporta como antes
  const url = new URL(req.url)
  const llave = url.searchParams.get('k') || req.headers.get('x-notify-key') || ''
  return mismoSecreto(String(llave).replace(/[^\x21-\x7E]/g, ''), NOTIFY_SECRET)
}

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

// Guarda la nota de resultado del pago (o no hace nada si es PENDING). Nunca
// tira: si Supabase falla, el pago igual tiene que avisarse por WhatsApp.
async function guardarNotaPago(clienteTel, pago) {
  if (!clienteTel) return
  const nota = notaResultadoPago(pago)
  if (!nota) return
  try {
    await crearNota(clienteTel, nota.texto, nota.tipo)
  } catch (e) {
    console.error('[/api/pago-dlocal] no se pudo guardar la nota del pago:', e.message)
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
    if (!llamadaLegitima(req)) {
      // Sin detalle del motivo: no ayudamos a afinar el intento.
      console.error('[/api/pago-dlocal] llamada sin la llave correcta, rechazada')
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    const body = await leerBody(req)
    const paymentId = body?.payment_id || body?.id || body?.data?.id || ''
    if (!paymentId) return NextResponse.json({ ok: false, error: 'sin payment_id' })

    const pago = await getPago(paymentId)
    // order_id = "<telefono>-<timestamp>" → sacamos el teléfono del cliente.
    const clienteTel = soloDigitos(String(pago?.order_id || '').split('-')[0])

    // Nota en el panel Ventas con el resultado del pago (verde si pagó, roja si
    // expiró o no se completó; nada si sigue PENDING). Ver lib/dlocal.js
    // notaResultadoPago. Envuelto en try/catch a propósito: la confirmación por
    // WhatsApp al cliente importa más que esta nota interna, así que un fallo
    // acá NUNCA frena el envío de la plantilla.
    await guardarNotaPago(clienteTel, pago)

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
