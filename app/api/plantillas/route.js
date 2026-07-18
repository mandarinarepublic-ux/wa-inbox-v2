import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Lista las PLANTILLAS aprobadas de tu WABA. Necesarias para escribir a un cliente
// FUERA de la ventana de 24h (Meta solo permite plantillas ahí). Reutiliza META_TOKEN.
// META_WABA_ID = id de la cuenta de WhatsApp Business (NO el phone id). Config en Vercel.
const META_TOKEN   = process.env.META_TOKEN || ''
const META_WABA_ID = process.env.META_WABA_ID || ''
const GRAPH_VER    = 'v22.0'

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

export async function GET() {
  if (!META_TOKEN)   return NextResponse.json({ ok: false, needsEnv: 'META_TOKEN', templates: [] })
  if (!META_WABA_ID) return NextResponse.json({ ok: false, needsEnv: 'META_WABA_ID', templates: [] })
  try {
    const url = `https://graph.facebook.com/${GRAPH_VER}/${META_WABA_ID}/message_templates` +
      `?fields=name,status,category,language,components&limit=200`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${META_TOKEN}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`
      console.error('[/api/plantillas] Meta:', msg)
      return NextResponse.json({ ok: false, error: msg, templates: [] }, { status: 502 })
    }
    const templates = (data?.data || [])
      .filter((t) => String(t.status).toUpperCase() === 'APPROVED')
      .map(simplificar)
    return NextResponse.json({ ok: true, templates })
  } catch (err) {
    console.error('[/api/plantillas]', err.message)
    return NextResponse.json({ ok: false, error: err.message, templates: [] }, { status: 500 })
  }
}
