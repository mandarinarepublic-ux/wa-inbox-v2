// app/api/admin/conectar-whatsapp/route.js — El lado servidor del enganche de
// coexistencia (registro insertado de Meta desde el propio inbox).
//
// La página /admin/conectar-whatsapp abre el diálogo de Meta en el navegador;
// cuando el diálogo termina, el navegador nos manda acá lo que Meta le dijo
// (waba_id, phone_number_id, un `code` canjeable) y esta ruta hace lo que
// exige la documentación DESPUÉS del diálogo:
//   1. canjear el `code` por un token (solo para confirmar que el enganche es
//      real; el que opera es META_TOKEN, el usuario del sistema);
//   2. suscribir la app a la WABA (si es la de siempre ya está, es idempotente);
//   3. leer los números de esa WABA y ubicar el nuestro;
//   4. pedir la sincronización de contactos e historial: Meta da 24 h para
//      hacerlo o desconecta el número otra vez.
//
// GET  → lo que la página necesita para abrir el diálogo + estado de cada canal.
// POST → { code?, wabaId, phoneId? }   termina el enganche (pasos 1-4)
//        { accion: 'sync', phoneId }   vuelve a pedir la sincronización
//
// Detrás del candado (no está en lib/rutas-publicas.js). Todo lo que devuelve
// Meta se relee y se muestra: un 200 solo no prueba nada.
import { CANALES } from '@/lib/canales'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v21.0'

async function graph(ruta, { metodo = 'GET', token = '', cuerpo = null } = {}) {
  const sep = ruta.includes('?') ? '&' : '?'
  const t = token || env('META_TOKEN')
  try {
    const r = await fetch(`${GRAPH}${ruta}${sep}access_token=${encodeURIComponent(t)}`, {
      method: metodo,
      cache: 'no-store',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    })
    const json = await r.json().catch(() => ({}))
    return r.ok ? { ok: true, ...json } : { ok: false, status: r.status, error: json?.error || json }
  } catch (e) {
    return { ok: false, status: 0, error: { message: e.message } }
  }
}

const CAMPOS_NUMERO = 'id,display_phone_number,verified_name,platform_type,status,is_on_biz_app,throughput'

async function estadoCanales() {
  return Promise.all(CANALES.map(async (c) => ({
    id: c.id, etiqueta: c.etiqueta, titulo: c.titulo, wabaId: c.wabaId, phoneId: c.phoneId,
    numero: await graph(`/${c.phoneId}?fields=${CAMPOS_NUMERO}`),
  })))
}

export async function GET() {
  const appId = env('NEXT_PUBLIC_META_APP_ID')
  const configId = env('META_ES_CONFIG_ID')
  return Response.json({
    appId, configId,
    listo: Boolean(appId && configId && env('META_TOKEN')),
    faltan: [
      !appId && 'NEXT_PUBLIC_META_APP_ID',
      !configId && 'META_ES_CONFIG_ID',
      !env('META_TOKEN') && 'META_TOKEN',
      !env('META_APP_SECRET') && 'META_APP_SECRET',
    ].filter(Boolean),
    canales: await estadoCanales(),
  })
}

/** Pide a Meta que mande por webhook la agenda y el historial del celular. */
async function pedirSincronizacion(phoneId, token) {
  const contactos = await graph(`/${phoneId}/smb_app_data`, {
    metodo: 'POST', token, cuerpo: { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' },
  })
  const historial = await graph(`/${phoneId}/smb_app_data`, {
    metodo: 'POST', token, cuerpo: { messaging_product: 'whatsapp', sync_type: 'history' },
  })
  return { contactos, historial }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  const salida = { recibido: { wabaId: body.wabaId || '', phoneId: body.phoneId || '', evento: body.evento || '', conCode: Boolean(body.code) } }

  if (body.accion === 'sync') {
    if (!body.phoneId) return Response.json({ error: 'falta phoneId' }, { status: 400 })
    salida.sincronizacion = await pedirSincronizacion(String(body.phoneId), '')
    salida.numero = await graph(`/${body.phoneId}?fields=${CAMPOS_NUMERO}`)
    return Response.json(salida)
  }

  // 1. Canjear el code. Es la prueba de que el diálogo terminó de verdad. Si
  //    falla se sigue igual: el enganche lo hizo Meta, y para operar alcanza
  //    con META_TOKEN (la WABA es del mismo negocio).
  let tokenNegocio = ''
  if (body.code) {
    // El canje NO lleva access_token: va con el id y el secreto de la app.
    const canje = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(env('NEXT_PUBLIC_META_APP_ID'))}` +
      `&client_secret=${encodeURIComponent(env('META_APP_SECRET'))}&code=${encodeURIComponent(body.code)}`,
      { cache: 'no-store' }
    ).then(async (r) => ({ ok: r.ok, status: r.status, ...(await r.json().catch(() => ({}))) }))
      .catch((e) => ({ ok: false, status: 0, error: { message: e.message } }))
    tokenNegocio = canje?.access_token || ''
    salida.canje = canje.ok ? { ok: true, tipo: canje.token_type || 'bearer' } : { ok: false, status: canje.status, error: canje.error }
  }

  const wabaId = String(body.wabaId || '')
  if (!wabaId) return Response.json({ ...salida, error: 'Meta no devolvió waba_id' }, { status: 400 })

  // 2. Suscribir la app a la WABA. Primero con el usuario del sistema; si esa
  //    WABA es NUEVA y todavía no está asignada al usuario del sistema, con el
  //    token del negocio que salió del canje.
  let suscripcion = await graph(`/${wabaId}/subscribed_apps`, { metodo: 'POST' })
  if (!suscripcion.ok && tokenNegocio) {
    suscripcion = { ...(await graph(`/${wabaId}/subscribed_apps`, { metodo: 'POST', token: tokenNegocio })), conTokenNegocio: true }
  }
  salida.suscripcion = suscripcion
  salida.apps_suscritas = await graph(`/${wabaId}/subscribed_apps`, { token: suscripcion.conTokenNegocio ? tokenNegocio : '' })

  // 3. Los números de esa WABA, y cuál es el nuestro.
  const numeros = await graph(`/${wabaId}/phone_numbers?fields=${CAMPOS_NUMERO}`, { token: suscripcion.conTokenNegocio ? tokenNegocio : '' })
  salida.numeros = numeros?.data || numeros
  const conocidos = new Set(CANALES.map((c) => c.phoneId))
  const lista = numeros?.data || []
  const elegido =
    lista.find((n) => n.id === String(body.phoneId || '')) ||
    lista.find((n) => conocidos.has(n.id)) ||
    lista.find((n) => n.is_on_biz_app) ||
    lista[0] || null
  salida.phoneId = elegido?.id || String(body.phoneId || '')
  salida.numero = elegido

  // ⚠️ Si el número volvió con OTRO identificador, el inbox sigue apuntando al
  // viejo: hay que migrar `phone_id` en la base y en lib/canales.js. Se avisa,
  // no se hace solo: es una migración con conteos, no un clic.
  const canal = CANALES.find((c) => c.phoneId === salida.phoneId) || null
  salida.canal = canal ? { id: canal.id, etiqueta: canal.etiqueta } : null
  salida.aviso = canal
    ? null
    : `El número quedó con el identificador ${salida.phoneId}, que no es ninguno de los canales configurados (${CANALES.map((c) => `${c.etiqueta}=${c.phoneId}`).join(', ')}). Hay que migrar phone_id antes de que el inbox lo vea.`

  // 4. Sincronización: agenda + historial, dentro de las 24 h.
  if (salida.phoneId) {
    salida.sincronizacion = await pedirSincronizacion(salida.phoneId, suscripcion.conTokenNegocio ? tokenNegocio : '')
  }

  return Response.json(salida)
}
