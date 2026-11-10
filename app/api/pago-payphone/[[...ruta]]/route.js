import { NextResponse } from 'next/server'
import { getTransaccion, notaPagoPayphone, telefonoDeId } from '@/lib/payphone'
import { crearNota, listarNotas } from '@/lib/notas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Notificación externa de Payphone (pago APROBADO de un link) ──────────────
// Doc: https://docs.payphone.app/notificacion-externa
//
// Payphone llama acá SOLO cuando un pago se aprueba. Hay que pedir el servicio
// en su formulario de autorización (3-5 días hábiles) y darles esta URL:
//   https://wa-inbox-v2.vercel.app/api/pago-payphone/NotificacionPago?k=<PAYPHONE_NOTIFY_SECRET>
// Es una ruta "atrapa-todo" ([[...ruta]]) porque la doc dice que el receptor se
// llama `NotificacionPago` pero no aclara si lo agregan ellos a la URL: así
// funciona con y sin ese pedazo.
//
// ── Quién puede llamar acá ─────────────────────────────────────────────────
// Payphone NO firma sus avisos. Dos defensas, igual que /api/pago-dlocal:
//   1. Secreto en la URL (?k=). Con PAYPHONE_NOTIFY_SECRET vacío se rechaza TODO.
//   2. El aviso NO se cree: se vuelve a consultar la transacción a Payphone con
//      NUESTRO token (GET /Sale/{TransactionId}). Solo si Payphone dice que está
//      aprobada se marca el pago. Un aviso inventado no pinta nada.
//
// Lo que hace hoy: deja la nota VERDE "PAGADO $…" en el panel Ventas del chat
// del cliente. NO manda plantillas de WhatsApp (la de dLocal tiene sus propios
// parámetros; si se quiere aviso al cliente, se hace una plantilla nueva).
//
// Respuesta que Payphone espera: { Response: true|false, ErrorCode: "000"… }
//   000 ok · 111 no se pudo leer el objeto · 222 error genérico
//   333 TransactionId ya existe · 444 faltan datos obligatorios
const NOTIFY_SECRET = String(process.env.PAYPHONE_NOTIFY_SECRET || '').replace(/[^\x21-\x7E]/g, '')

const responder = (ok, codigo, status = 200) =>
  NextResponse.json({ Response: ok, ErrorCode: codigo }, { status })

function mismoSecreto(a, b) {
  if (a.length !== b.length) return false
  let dif = 0
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return dif === 0
}

function llamadaLegitima(req) {
  // Cerrado por defecto: sin PAYPHONE_NOTIFY_SECRET no se acepta nada. Payphone
  // no avisa hasta que aprueben la notificación externa, y para eso ya hay que
  // tener la URL con la llave, así que no hay avisos "viejos" que perder.
  if (!NOTIFY_SECRET) return false
  const llave = new URL(req.url).searchParams.get('k') || req.headers.get('x-notify-key') || ''
  return mismoSecreto(String(llave).replace(/[^\x21-\x7E]/g, ''), NOTIFY_SECRET)
}

export async function POST(req) {
  if (!llamadaLegitima(req)) {
    console.error('[/api/pago-payphone] llamada sin la llave correcta, rechazada')
    return responder(false, '222', 401)
  }

  let body
  try { body = JSON.parse(await req.text()) } catch { return responder(false, '111') }

  const transactionId = body?.TransactionId ?? body?.transactionId
  if (!transactionId) return responder(false, '444')

  try {
    // La verdad la dice Payphone, no el aviso.
    const t = await getTransaccion(transactionId)
    const nota = notaPagoPayphone(t)
    if (!nota) {
      console.error(`[/api/pago-payphone] #${transactionId} no figura aprobada en Payphone (statusCode ${t?.statusCode})`)
      return responder(true, '000') // nada que marcar; que no reintente
    }

    // El teléfono sale SOLO de lo que Payphone confirma (el clientTransactionId
    // de la transacción consultada, ver lib/payphone.js idTransaccion). NUNCA
    // del cuerpo del aviso: ese lo puede escribir cualquiera, y con él se
    // podría pintar "PAGADO" en el chat de otro cliente usando un pago real.
    // Si el id no trae teléfono (links sin chat, p. ej. de FB/IG), no hay nota.
    const telefono = telefonoDeId(t?.clientTransactionId)
    if (!telefono) {
      console.error(`[/api/pago-payphone] pago #${transactionId} aprobado pero su id no trae teléfono: sin nota`)
      return responder(true, '000')
    }

    // Aviso repetido (Payphone reintenta): si la nota de esta transacción ya
    // existe, no se duplica. Revisar solo este chat alcanza: el teléfono sale
    // de la transacción verificada, así que una transacción = un solo chat.
    const marca = `Payphone #${t?.transactionId ?? transactionId}`
    const previas = await listarNotas(telefono).catch(() => [])
    if (previas.some(n => String(n?.texto || '').includes(marca))) return responder(true, '333')

    await crearNota(telefono, nota.texto, nota.tipo)
    return responder(true, '000')
  } catch (err) {
    console.error('[/api/pago-payphone]', err.message)
    return responder(false, '222')
  }
}
