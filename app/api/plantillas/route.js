import { NextResponse } from 'next/server'
import { getWabaId, GRAPH } from '@/lib/whatsapp'
import { wabaIdDePhoneId } from '@/lib/canales'
import { armarPlantilla } from '@/lib/plantilla-nueva'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Lista las PLANTILLAS aprobadas de tu WABA. Necesarias para escribir a un cliente
// FUERA de la ventana de 24h (Meta solo permite plantillas ahí). Reutiliza META_TOKEN.
//
// La WABA depende del CANAL: cada número vive en una WABA distinta (MANDI en
// 1250794910496982, REPUBLIC en 110133805380815) y las plantillas son de la WABA,
// no de la marca. Sin esto la lista salía siempre de la WABA de MANDI y elegir
// una plantilla en REPUBLIC terminaba en "(#132001) Template name does not exist
// in the translation" — comprobado el 6-ago mandando hasta `hello_world`.
// Sin `canal` se cae al descubrimiento por token (comportamiento anterior).
const META_TOKEN = process.env.META_TOKEN || ''

const contarVars = (txt) => {
  const m = String(txt || '').match(/\{\{\s*\d+\s*\}\}/g)
  return m ? new Set(m.map((s) => s.replace(/\D/g, ''))).size : 0
}

// Fila cruda de Meta → shape amigable para el selector de plantillas.
function simplificar(t) {
  const comps = Array.isArray(t.components) ? t.components : []
  const header = comps.find((c) => String(c.type).toUpperCase() === 'HEADER')
  const body   = comps.find((c) => String(c.type).toUpperCase() === 'BODY')
  const footer = comps.find((c) => String(c.type).toUpperCase() === 'FOOTER')
  const btns   = comps.find((c) => String(c.type).toUpperCase() === 'BUTTONS')
  const headerFormat = header ? String(header.format || 'TEXT').toUpperCase() : null
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : '',
    header: header ? {
      format: headerFormat,                 // TEXT | IMAGE | VIDEO | DOCUMENT
      text: headerFormat === 'TEXT' ? (header.text || '') : '',
      vars: headerFormat === 'TEXT' ? contarVars(header.text) : 0,
    } : null,
    bodyText: body?.text || '',
    bodyVars: contarVars(body?.text),       // cuántas variables {{n}} pedir al usuario
    footerText: footer?.text || '',
    buttons: Array.isArray(btns?.buttons) ? btns.buttons.map((b) => b.text || '') : [],
  }
}

export async function GET(req) {
  if (!META_TOKEN) return NextResponse.json({ ok: false, needsEnv: 'META_TOKEN', templates: [] })

  // El canal viaja como phone_id (igual que en /api/hilo y /api/saliente). Si no
  // es uno de los nuestros, wabaIdDePhoneId devuelve null y caemos al token.
  const canal = req.nextUrl.searchParams.get('canal') || ''
  const wabaDeCanal = wabaIdDePhoneId(canal)
  const { id: wabaToken, error: wabaErr } = wabaDeCanal ? {} : await getWabaId()
  const wabaId = wabaDeCanal || wabaToken
  if (!wabaId) return NextResponse.json({ ok: false, needsEnv: 'META_WABA_ID', wabaError: wabaErr, templates: [] })
  try {
    const url = `${GRAPH}/${wabaId}/message_templates` +
      `?fields=name,status,category,language,components,rejected_reason&limit=200`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${META_TOKEN}` }, cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      console.error('[/api/plantillas] Meta:', msg)
      return NextResponse.json({ ok: false, error: msg, templates: [] }, { status: 502 })
    }
    // `?todas=1` → también las pendientes y rechazadas (pantalla /admin/plantillas);
    // el selector del chat sigue viendo solo las aprobadas, las únicas que se envían.
    const todas = req.nextUrl.searchParams.get('todas') === '1'
    const templates = (data?.data || [])
      .filter((t) => todas || String(t.status).toUpperCase() === 'APPROVED')
      .map(simplificar)
    // `wabaId` va de vuelta a propósito: es la forma de ver de un vistazo si la
    // lista que estás mirando es la del canal que tienes abierto.
    return NextResponse.json({ ok: true, wabaId, templates })
  } catch (err) {
    console.error('[/api/plantillas]', err.message)
    return NextResponse.json({ ok: false, error: err.message, templates: [] }, { status: 500 })
  }
}

// POST { canal: phoneId, nombre, categoria, idioma, cuerpo, ejemplos[], pie }
// → crea la plantilla en la WABA DE ESE CANAL y Meta la deja PENDIENTE de revisión.
//
// ☠️ Acá NO hay caída a la WABA del token (como en el GET): una plantilla creada
// en la WABA equivocada no se ve en el canal que la necesita, y no se puede mover.
// Canal desconocido = error.
export async function POST(req) {
  if (!META_TOKEN) return NextResponse.json({ ok: false, error: 'META_TOKEN no está configurado' }, { status: 500 })
  const datos = await req.json().catch(() => ({}))
  const wabaId = wabaIdDePhoneId(datos.canal || '')
  if (!wabaId) return NextResponse.json({ ok: false, error: `Canal desconocido: ${datos.canal || '(vacío)'}` }, { status: 400 })

  const armada = armarPlantilla(datos)
  if (!armada.ok) return NextResponse.json({ ok: false, errores: armada.errores }, { status: 400 })

  try {
    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(armada.payload),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const e = data?.error || {}
      const msg = e.error_user_msg || e.message || `HTTP ${res.status}`
      console.error('[/api/plantillas POST] Meta:', msg, e.code, e.error_subcode)
      return NextResponse.json({ ok: false, error: msg, code: e.code, subcode: e.error_subcode }, { status: 502 })
    }
    // Meta devuelve { id, status: 'PENDING' | 'APPROVED' | 'REJECTED', category }.
    return NextResponse.json({ ok: true, wabaId, nombre: armada.payload.name, ...data })
  } catch (err) {
    console.error('[/api/plantillas POST]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
