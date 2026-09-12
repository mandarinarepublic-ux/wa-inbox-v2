// app/api/admin/meta-waba/route.js — HERRAMIENTA DE DIAGNÓSTICO, 11-sep-2026.
//
// Por qué existe: REPUBLIC lleva desde el 6-sep en "Sin conexión" y el panel de
// Meta no dice por qué. META_TOKEN está marcado *Sensitive* en Vercel (nadie
// puede leerlo), pero la app sí lo tiene en ejecución: esta ruta es la forma de
// preguntarle a la Graph API por el estado real de un número sin conocer el token.
//
// SOLO LECTURA. No registra, no suscribe, no toca nada. Es la hermana de la
// misma ruta en ind-inbox-next, sin las acciones.
//
// Seguridad: no está en lib/rutas-publicas.js, así que el candado exige sesión
// del CRM. Sin cookie devuelve 401.
import { CANALES } from '@/lib/canales'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v21.0'

async function graph(ruta, metodo = 'GET') {
  const sep = ruta.includes('?') ? '&' : '?'
  try {
    const r = await fetch(`${GRAPH}${ruta}${sep}access_token=${encodeURIComponent(env('META_TOKEN'))}`, {
      method: metodo,
      cache: 'no-store',
    })
    const cuerpo = await r.json().catch(() => ({}))
    return r.ok ? cuerpo : { ok: false, status: r.status, error: cuerpo?.error }
  } catch (e) {
    return { ok: false, status: 0, error: { message: e.message } }
  }
}

/**
 * GET ?accion=listar → TODAS las WABAs del negocio dueño de la WABA del canal, con
 * sus números. Sirve para descubrir si un reenganche de coexistencia creó el
 * número con OTRO phone_id o en OTRA WABA: en ese caso el inbox sigue apuntando
 * al viejo y no ve nada, aunque Meta diga "conectado".
 */
async function listar(canal) {
  const dueno = await graph(`/${canal.wabaId}?fields=owner_business_info`)
  const businessId = dueno?.owner_business_info?.id
  if (!businessId) return { error: 'No se pudo leer el negocio dueño', dueno }
  const campos = 'id,name,status,phone_numbers{id,display_phone_number,platform_type,status,is_on_biz_app,throughput,last_onboarded_time}'
  const [propias, clientes] = await Promise.all([
    graph(`/${businessId}/owned_whatsapp_business_accounts?fields=${campos}&limit=50`),
    graph(`/${businessId}/client_whatsapp_business_accounts?fields=${campos}&limit=50`),
  ])
  return { businessId, propias: propias?.data || propias, clientes: clientes?.data || clientes }
}

/** GET ?canal=REPUBLIC (por defecto) | MANDI → estado de la WABA y del número. */
export async function GET(req) {
  const url = new URL(req.url)
  const canalId = url.searchParams.get('canal') || 'REPUBLIC'
  const canal = CANALES.find((c) => c.id === canalId)
  if (!canal) {
    return Response.json({ error: `Canal desconocido: ${canalId}`, canales: CANALES.map((c) => c.id) }, { status: 400 })
  }
  if (!env('META_TOKEN')) {
    return Response.json({ error: 'META_TOKEN no está configurado en este entorno' }, { status: 500 })
  }
  if (url.searchParams.get('accion') === 'listar') {
    return Response.json({ canal: canal.id, ...(await listar(canal)) })
  }

  // ?accion=app → qué es el token y qué puede la app (solo lectura): identidad de la
  // app, permisos del token (debug_token), campos de webhook suscritos y modo de la
  // app. Sirve para saber qué falta para el registro integrado (Embedded Signup).
  if (url.searchParams.get('accion') === 'app') {
    const tok = env('META_TOKEN')
    const debug = await graph(`/debug_token?input_token=${encodeURIComponent(tok)}`)
    const appId = debug?.data?.app_id
    const [app, subs] = await Promise.all([
      appId ? graph(`/${appId}?fields=id,name,category,link,app_type,business,privacy_policy_url,website_url`) : null,
      appId ? graph(`/${appId}/subscriptions`) : null,
    ])
    return Response.json({ token: debug?.data || debug, app, webhooks: subs?.data || subs })
  }

  // ?accion=borrar-numero&confirmar=<phoneId> → DELETE /{phoneId} en la Graph API.
  // Quita el registro del número en la WABA (el celular NO se toca: en coexistencia
  // el teléfono es el dueño del número). Solo procede si `confirmar` coincide con
  // el phoneId del canal Y el número sigue DISCONNECTED/ON_PREMISE: nunca borra un
  // número que esté funcionando. Relee después para no fiarse del 200.
  // Autorizado por Rodrigo el 12-sep-2026 para REPUBLIC.
  if (url.searchParams.get('accion') === 'borrar-numero') {
    const confirmar = url.searchParams.get('confirmar') || ''
    if (confirmar !== canal.phoneId) {
      return Response.json({ error: 'confirmar no coincide con el phoneId del canal', phoneId: canal.phoneId }, { status: 400 })
    }
    const antes = await graph(`/${canal.phoneId}?fields=id,display_phone_number,platform_type,status,is_on_biz_app`)
    if (antes?.platform_type === 'CLOUD_API' || antes?.status === 'CONNECTED') {
      return Response.json({ error: 'El número está funcionando, no se borra', antes }, { status: 409 })
    }
    const borrado = await graph(`/${canal.phoneId}`, 'DELETE')
    const despues = await graph(`/${canal.wabaId}/phone_numbers?fields=id,display_phone_number,platform_type,status`)
    return Response.json({ canal: canal.id, antes, borrado, despues })
  }

  const [waba, apps, numero, plantillas] = await Promise.all([
    graph(`/${canal.wabaId}?fields=id,name,status,account_review_status,business_verification_status,ownership_type,currency`),
    graph(`/${canal.wabaId}/subscribed_apps`),
    // `status` es lo que Meta muestra como "Conectado/Sin conexión". `platform_type`
    // y `is_on_biz_app` dicen DÓNDE vive el número: CLOUD_API + is_on_biz_app=true es
    // coexistencia con un celular; NOT_APPLICABLE es que no está registrado en ningún lado.
    graph(
      `/${canal.phoneId}?fields=id,display_phone_number,verified_name,quality_rating,` +
        `platform_type,status,is_on_biz_app,last_onboarded_time,name_status,` +
        `code_verification_status,throughput,messaging_limit_tier,account_mode`
    ),
    graph(`/${canal.wabaId}/message_templates?fields=name,status,language&limit=50`),
  ])

  return Response.json({
    canal: { id: canal.id, etiqueta: canal.etiqueta, wabaId: canal.wabaId, phoneId: canal.phoneId },
    waba,
    apps_suscritas: apps?.data ? apps.data.map((a) => a.whatsapp_business_api_data?.name || a) : apps,
    numero,
    plantillas: plantillas?.data
      ? plantillas.data.map((p) => `${p.name} · ${p.language} · ${p.status}`)
      : plantillas,
    nota: 'Solo lectura. No se cambió nada.',
  })
}
