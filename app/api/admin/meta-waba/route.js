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

async function graph(ruta) {
  const sep = ruta.includes('?') ? '&' : '?'
  try {
    const r = await fetch(`${GRAPH}${ruta}${sep}access_token=${encodeURIComponent(env('META_TOKEN'))}`, {
      cache: 'no-store',
    })
    const cuerpo = await r.json().catch(() => ({}))
    return r.ok ? cuerpo : { ok: false, status: r.status, error: cuerpo?.error }
  } catch (e) {
    return { ok: false, status: 0, error: { message: e.message } }
  }
}

/** GET ?canal=REPUBLIC (por defecto) | MANDI → estado de la WABA y del número. */
export async function GET(req) {
  const canalId = new URL(req.url).searchParams.get('canal') || 'REPUBLIC'
  const canal = CANALES.find((c) => c.id === canalId)
  if (!canal) {
    return Response.json({ error: `Canal desconocido: ${canalId}`, canales: CANALES.map((c) => c.id) }, { status: 400 })
  }
  if (!env('META_TOKEN')) {
    return Response.json({ error: 'META_TOKEN no está configurado en este entorno' }, { status: 500 })
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
