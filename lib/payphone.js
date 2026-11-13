// lib/payphone.js — Links de pago con Payphone (API Link), alternativa a dLocal.
//
// Por qué existe (10-nov-2026): dLocal Go cobra 7,99 % + 12 % de impuesto sobre
// esa comisión en Ecuador (≈ 8,9 % por venta) y deposita a los 7 días. Payphone
// publica 5 % + IVA (≈ 5,75 %). El vendedor elige cuál usar en el panel Ventas
// (selector dLocal / Payphone); el LINKPAGO<monto> escrito en el chat usa el que
// diga LINKPAGO_PROVEEDOR (por defecto dLocal, para que nada cambie solo).
//
// Doc: https://docs.payphone.app/api-link  ·  https://docs.payphone.app/notificacion-externa
//
// Credenciales SOLO por env (nunca en el código):
//   PAYPHONE_TOKEN     → token de la app "Inbox Mandarina" (tipo API) en Payphone Developer
//   PAYPHONE_STORE_ID  → StoreId de la tienda "Mandarina Republic"
//
// ☠️ Payphone pide TODOS los montos en CENTAVOS (enteros) y que
//    amount = amountWithoutTax + amountWithTax + tax + service + tip, exacto.
//    Si no cuadra al centavo, responde 400 "Validaciones fallidas".
// ☠️ clientTransactionId: máximo 15 caracteres. El order_id de dLocal
//    ("<telefono>-<timestamp>", 26 caracteres) NO sirve acá.

// Mismo saneo que lib/dlocal.js: PowerShell mete un BOM invisible al cargar envs
// y el header Authorization revienta solo en producción.
const limpiar = (s) => String(s || '').replace(/[^\x21-\x7E]/g, '')

const API = 'https://pay.payphonetodoesposible.com/api'

// IVA de Ecuador vigente. El precio que escribe el vendedor YA lo incluye
// (decisión de Rodrigo, 10-nov-2026): LINKPAGO35 cobra $35 en total.
export const IVA = 0.15

// Cuánto dura el link. Mismo "Válido por 2 días" que dice el mensaje al cliente.
export const HORAS_VIGENCIA = 48

function credenciales() {
  const token = limpiar(process.env.PAYPHONE_TOKEN)
  const storeId = limpiar(process.env.PAYPHONE_STORE_ID)
  if (!token || !storeId) {
    throw new Error('Faltan credenciales Payphone (PAYPHONE_TOKEN / PAYPHONE_STORE_ID)')
  }
  return { token, storeId }
}

/**
 * Parte un total que YA incluye IVA en lo que pide Payphone, en centavos.
 * La base se redondea y el IVA es lo que falta para llegar al total, así la
 * suma cuadra SIEMPRE al centavo (que es lo que Payphone valida).
 *   35    → { amount: 3500, amountWithTax: 3043, tax: 457 }
 */
export function desglosarIva(total, iva = IVA) {
  const amount = Math.round(Number(total) * 100)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const amountWithTax = Math.round(amount / (1 + iva))
  return { amount, amountWithTax, tax: amount - amountWithTax }
}

// ── El teléfono del cliente viaja DENTRO del clientTransactionId ─────────────
// Cuando Payphone avisa el pago, hay que saber a qué chat poner la nota verde.
// La consulta de la transacción (GET /Sale/{id}) devuelve clientTransactionId
// pero NO additionalData, así que el teléfono va codificado en el id:
//   <telefono en base 36, 8 caracteres> + "-" + <6 al azar>  = 15 caracteres
// 8 caracteres en base 36 alcanzan hasta 2.821.109.907.455: todo número de
// Ecuador (593 + 9 dígitos) y casi todos los de afuera. Si no entra, el id va
// sin teléfono ("x" + 14 al azar) y se usa el additionalData del aviso.
const LARGO_TEL = 8
const MAX_TEL = 36 ** LARGO_TEL - 1

function azar(n, rnd = Math.random) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(rnd() * 36).toString(36)
  return s
}

export function idTransaccion(telefono, rnd = Math.random) {
  const digitos = String(telefono || '').replace(/\D/g, '')
  const num = digitos ? Number(digitos) : NaN
  if (digitos.length >= 7 && Number.isSafeInteger(num) && num <= MAX_TEL) {
    return num.toString(36).padStart(LARGO_TEL, '0') + '-' + azar(6, rnd)
  }
  return 'x' + azar(14, rnd)
}

/** Lo inverso de idTransaccion: el teléfono, o '' si el id no lo trae. */
export function telefonoDeId(id) {
  const m = String(id || '').match(/^([0-9a-z]{8})-[0-9a-z]{6}$/)
  if (!m) return ''
  const n = parseInt(m[1], 36)
  return Number.isSafeInteger(n) && n > 0 ? String(n) : ''
}

/** El cuerpo del POST /Links, armado aparte para poder probarlo sin red. */
export function cuerpoLink({ monto, telefono, storeId, rnd }) {
  const d = desglosarIva(monto)
  if (!d) throw new Error('El monto tiene que ser un número mayor a cero')
  return {
    amount: d.amount,
    amountWithoutTax: 0,
    amountWithTax: d.amountWithTax,
    tax: d.tax,
    service: 0,
    tip: 0,
    currency: 'USD',
    clientTransactionId: idTransaccion(telefono, rnd),
    storeId,
    reference: 'Pago Mandarina Republic',
    additionalData: String(telefono || '').replace(/\D/g, '').slice(0, 250),
    oneTime: true,
    expireIn: HORAS_VIGENCIA,
    isAmountEditable: false,
  }
}

/**
 * La respuesta exitosa de /Links es el link "pelado" (a veces como string JSON
 * entre comillas). Cualquier otra cosa es un error de Payphone.
 */
export function leerRespuestaLink(texto) {
  let v = String(texto || '').trim()
  try { v = JSON.parse(v) } catch {}
  if (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim())) return v.trim()
  return null
}

/** Crea el link en Payphone y devuelve la URL de pago. */
export async function crearLinkPayphone(monto, telefono) {
  return (await crearLinkPayphoneConId(monto, telefono)).link
}

/**
 * Igual que crearLinkPayphone, pero devuelve también el clientTransactionId:
 * es la llave con la que el reporte del CRM le pregunta a Payphone si se pagó
 * (13-nov-2026, ver lib/registro-link-pago.js).
 */
export async function crearLinkPayphoneConId(monto, telefono) {
  const { token, storeId } = credenciales()
  const body = cuerpoLink({ monto, telefono, storeId })
  const res = await fetch(`${API}/Links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const texto = await res.text().catch(() => '')
  const link = res.ok ? leerRespuestaLink(texto) : null
  if (!link) {
    // Payphone explica el error en `errors[].errorDescriptions`: se muestra tal
    // cual en el panel para que el vendedor sepa qué pasó.
    let detalle = texto.slice(0, 200)
    try {
      const d = JSON.parse(texto)
      const desc = (d?.errors || []).flatMap(e => e?.errorDescriptions || [e?.message]).filter(Boolean)
      detalle = desc.length ? desc.join(' · ') : (d?.message || detalle)
    } catch {}
    throw new Error(`Payphone HTTP ${res.status}: ${detalle}`)
  }
  return { link, clientTransactionId: body.clientTransactionId }
}

/** Consulta una transacción por su TransactionId (para verificar un aviso de pago). */
export async function getTransaccion(transactionId) {
  const { token } = credenciales()
  const res = await fetch(`${API}/Sale/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`Payphone GET HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
  }
  return data
}

/**
 * La nota verde del panel Ventas para un pago aprobado, o null si la
 * transacción no está aprobada. Lleva el número de transacción para que un
 * aviso repetido se pueda reconocer.
 *   "PAGADO $35.00 — Visa Banco Pichincha · Payphone #32805807"
 */
export function notaPagoPayphone(t) {
  const aprobada = Number(t?.statusCode) === 3 || t?.transactionStatus === 'Approved'
  if (!aprobada) return null
  const monto = Number(t?.amount)
  const dolares = Number.isFinite(monto) ? (monto / 100).toFixed(2) : '-'
  const tarjeta = t?.cardBrand || t?.CardBrand || 'Tarjeta'
  const id = t?.transactionId ?? t?.TransactionId ?? '-'
  return { tipo: 'pago_ok', texto: `PAGADO $${dolares} — ${tarjeta} · Payphone #${id}` }
}
