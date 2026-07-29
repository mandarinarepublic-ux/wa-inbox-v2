import { NextResponse } from 'next/server'

// TEMPORAL — ⚠️ BORRAR cuando se termine la prueba del número +593 97 910 4167.
//
// Por qué existe: /api/saliente resuelve el phone id UNA sola vez al cargar el
// módulo (`GRAPH_URL` es una constante), así que no hay forma de pedirle que
// mande por otro número. Esta ruta acepta el phone_id como parámetro para poder
// probar un número distinto SIN tocar el camino de envío que hoy funciona.
//
// No importa ni modifica nada del inbox: solo usa META_TOKEN y habla con Meta.
//
//   GET  ...?clave=X&waba=<id>        → estado de esa WABA y sus números
//   POST ...?clave=X&phone=<id>&para=<tel>&texto=<txt>  → manda UN mensaje
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 30

const META_TOKEN = process.env.META_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v22.0'

const autorizado = (req) => {
  const clave = req.nextUrl.searchParams.get('clave') || ''
  // MIG_KEY es la que ya usa /api/admin/inbox-migrate; DIAG_KEY se agrega solo
  // para esta prueba. Sin ninguna de las dos, 401 y no se consulta nada.
  const claves = [process.env.MIG_KEY, process.env.DIAG_KEY].filter(Boolean)
  return claves.length > 0 && claves.includes(clave)
}

// El token va SIEMPRE por cabecera: en la query string acaba en logs de acceso.
const pedir = (path) =>
  fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${META_TOKEN}` } })
    .then(async (r) => ({ http: r.status, body: await r.json().catch(() => ({})) }))
    .catch((e) => ({ http: 0, error: e.message }))

export async function GET(req) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 })
  if (!META_TOKEN) return NextResponse.json({ ok: false, error: 'META_TOKEN ausente' }, { status: 500 })

  const waba = req.nextUrl.searchParams.get('waba') || ''
  if (waba && !/^\d{5,25}$/.test(waba)) {
    return NextResponse.json({ ok: false, error: 'waba invalida' }, { status: 400 })
  }

  const [quien, token, cuenta, numeros] = await Promise.all([
    pedir('me?fields=id,name'),
    pedir(`debug_token?input_token=${encodeURIComponent(META_TOKEN)}`),
    waba ? pedir(`${waba}?fields=id,name,status,currency,account_review_status,ownership_type`) : Promise.resolve(null),
    waba ? pedir(`${waba}/phone_numbers?fields=id,display_phone_number,status,quality_rating,platform_type`) : Promise.resolve(null),
  ])

  return NextResponse.json({ ok: true, quien, token, cuenta, numeros })
}

export async function POST(req) {
  if (!autorizado(req)) return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 })
  if (!META_TOKEN) return NextResponse.json({ ok: false, error: 'META_TOKEN ausente' }, { status: 500 })

  const q = req.nextUrl.searchParams
  const phone = q.get('phone') || ''
  const para = (q.get('para') || '').replace(/\D/g, '')
  const texto = q.get('texto') || 'Prueba tecnica'
  if (!/^\d{5,25}$/.test(phone)) return NextResponse.json({ ok: false, error: 'phone invalido' }, { status: 400 })
  if (!/^\d{8,20}$/.test(para))  return NextResponse.json({ ok: false, error: 'destino invalido' }, { status: 400 })

  const r = await fetch(`${GRAPH}/${phone}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  })
  const body = await r.json().catch(() => ({}))
  const e = body?.error || {}
  console.log(
    `[/api/admin/diag-envio] phone=${phone} http=${r.status} code=${e.code} ` +
    `subcode=${e.error_subcode} msg=${e.message || 'OK'} fbtrace=${e.fbtrace_id || '—'}`
  )
  return NextResponse.json({
    ok: r.ok,
    http: r.status,
    wamid: body?.messages?.[0]?.id || null,
    error: e.message ? { code: e.code, subcode: e.error_subcode, msg: e.message, fbtrace: e.fbtrace_id } : null,
  }, { status: r.ok ? 200 : 502 })
}
