// lib/dlocal.js — Generador de links de pago dLocal Go.
// Recupera la herramienta "LINKPAGO<monto>" que vivía en el escenario Make
// EsuchaWhatsAppBusiness (módulos 60/61/62) y se perdió al apagar Make.
//
// Uso: el ejecutivo (o quien escriba al negocio) manda "LINKPAGO35" y se genera
// un link de cobro dLocal por ese monto en USD, que se envía por WhatsApp.
//
// Credenciales SOLO por env (nunca en el código):
//   DLOCAL_API_KEY, DLOCAL_SECRET  → auth "Bearer <key>:<secret>"
//   DLOCAL_NOTIFY_URL (opcional)   → callback de dLocal al cambiar el estado del pago
// Limpia BOM (U+FEFF) y cualquier carácter no imprimible / espacio que se pueda
// haber colado al cargar el env (p.ej. al setearlo por PowerShell). El header
// Authorization NO admite bytes fuera de 0x20–0x7E → sin esto, revienta.
const limpiar = (s) => String(s || '').replace(/[^\x21-\x7E]/g, '')

const DLOCAL_KEY    = limpiar(process.env.DLOCAL_API_KEY)
const DLOCAL_SECRET = limpiar(process.env.DLOCAL_SECRET)
const DLOCAL_URL    = 'https://api.dlocalgo.com/v1/payments'
const NOTIFY_URL    = limpiar(process.env.DLOCAL_NOTIFY_URL)

// Detecta "LINKPAGO<monto>" (admite coma o punto decimal). Devuelve el monto como
// número, o null si el texto no es un comando LINKPAGO.
export function parseLinkpago(texto) {
  const m = String(texto || '').match(/LINKPAGO\s*(\d+(?:[.,]\d+)?)/i)
  if (!m) return null
  const amount = Number(m[1].replace(',', '.'))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

// Mensaje de WhatsApp con el link (mismo formato que enviaba Make).
export function mensajeLinkPago(amount, link) {
  return `🧡 Aquí está tu link de pago por $${amount} USD:\n\n${link}\n\n✅ Pago seguro con tarjeta\n⏳ Válido por 2 días\n\n¡Gracias por tu compra en Mandarina Republic! 🍊`
}

// Valida el monto que llega desde el botón LINK PAGO del panel Ventas (endpoint
// /api/linkpago). Acepta número o string numérico (el body es JSON, pero el
// input del navegador puede llegar como texto); cualquier otra cosa —negativo,
// cero, NaN, Infinity, texto no numérico— devuelve null para que la ruta
// responda un error claro en vez de mandarle a dLocal un monto inválido.
export function validarMonto(monto) {
  const n = Number(monto)
  return Number.isFinite(n) && n > 0 ? n : null
}

// A partir del detalle de un pago consultado a dLocal (mismo objeto que usa
// plantillaPago para la plantilla de WhatsApp), arma la nota interna que
// reporta el resultado en el panel Ventas:
//   PAID    → verde  (pago_ok):   "PAGADO $<monto> — <tarjeta> · <nombre>"
//   EXPIRED → rojo   (pago_error): "Link expirado"
//   otro (rechazado, cancelado, etc) → rojo (pago_error): "Pago no completado"
//   PENDING → null (un pago en curso no es un resultado, no genera nota)
export function notaResultadoPago(p) {
  const status = p?.status
  if (status === 'PAID') {
    const nombre = `${p?.payer?.first_name || 'Cliente'} ${p?.payer?.last_name || ''}`.trim()
    const issuer = p?.card?.issuer || 'N/A'
    return { tipo: 'pago_ok', texto: `PAGADO $${p?.amount ?? '-'} — ${issuer} · ${nombre}` }
  }
  if (status === 'EXPIRED') {
    return { tipo: 'pago_error', texto: 'Link expirado' }
  }
  if (status === 'PENDING') {
    return null
  }
  return { tipo: 'pago_error', texto: 'Pago no completado' }
}

// Crea el pago en dLocal y devuelve el redirect_url (el link de cobro).
export async function crearLinkPago(amount, orderId) {
  if (!DLOCAL_KEY || !DLOCAL_SECRET) {
    throw new Error('Faltan credenciales dLocal (DLOCAL_API_KEY / DLOCAL_SECRET)')
  }
  const body = {
    amount,
    currency: 'USD',
    country: 'EC',
    order_id: orderId,
    description: 'Pago Mandarina Republic',
  }
  if (NOTIFY_URL) body.notification_url = NOTIFY_URL

  const res = await fetch(DLOCAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DLOCAL_KEY}:${DLOCAL_SECRET}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.redirect_url) {
    throw new Error(`dLocal HTTP ${res.status}: ${data?.message || JSON.stringify(data).slice(0, 200)}`)
  }
  return data.redirect_url
}

// Consulta el detalle de un pago por su payment_id (status, amount, order_id,
// datos del pagador). Se usa en la notificación de dLocal.
export async function getPago(paymentId) {
  if (!DLOCAL_KEY || !DLOCAL_SECRET) {
    throw new Error('Faltan credenciales dLocal (DLOCAL_API_KEY / DLOCAL_SECRET)')
  }
  const res = await fetch(`${DLOCAL_URL}/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${DLOCAL_KEY}:${DLOCAL_SECRET}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`dLocal GET HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return data
}
