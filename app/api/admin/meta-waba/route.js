// app/api/admin/meta-waba/route.js — HERRAMIENTA DE DIAGNÓSTICO, 11-sep-2026.
//
// Por qué existe: REPUBLIC lleva desde el 6-sep en "Sin conexión" y el panel de
// Meta no dice por qué. META_TOKEN está marcado *Sensitive* en Vercel (nadie
// puede leerlo), pero la app sí lo tiene en ejecución: esta ruta es la forma de
// preguntarle a la Graph API por el estado real de un número sin conocer el token.
//
// La lectura por defecto no toca nada. Las acciones que escriben (borrar-numero y
// el registro en Cloud API) van aparte, cada una con su guarda.
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
    // /subscriptions exige el token DE LA APP (app_id|app_secret), no el del usuario del sistema.
    const secreto = env('META_APP_SECRET')
    const tokenApp = appId && secreto ? `${appId}|${secreto}` : ''
    const [app, subs] = await Promise.all([
      appId ? graph(`/${appId}?fields=id,name,category,link,app_type,privacy_policy_url,website_url`) : null,
      tokenApp
        ? fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(tokenApp)}`, { cache: 'no-store' })
            .then((r) => r.json()).catch((e) => ({ error: e.message }))
        : { error: 'sin META_APP_SECRET' },
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

  // ── Paso de REPUBLIC a Cloud API pura (25-sep-2026, autorizado por Rodrigo) ──
  // La coexistencia no se pudo reconectar. Orden: en el celular se apaga la
  // verificación en dos pasos y se ELIMINA la cuenta de WhatsApp Business; luego
  //   ?accion=pedir-codigo&metodo=SMS|VOICE  → Meta manda el código al chip
  //   ?accion=verificar-codigo&codigo=123456
  //   ?accion=registrar&pin=<6 dígitos>      → el PIN pasa a ser la verificación
  //                                            en dos pasos del número: GUARDARLO.
  // Meta permite 10 `register` por número cada 72 h: no reintentar a ciegas.
  // Cada paso relee el número después, para no fiarse del 200.
  const accion = url.searchParams.get('accion') || ''
  if (['pedir-codigo', 'verificar-codigo', 'registrar'].includes(accion)) {
    const leer = () =>
      graph(`/${canal.phoneId}?fields=id,display_phone_number,platform_type,status,is_on_biz_app,code_verification_status,throughput,health_status`)
    const antes = await leer()
    if (antes?.platform_type === 'CLOUD_API') {
      return Response.json({ error: 'El número ya está en Cloud API, no hay nada que registrar', antes }, { status: 409 })
    }
    let resultado
    if (accion === 'pedir-codigo') {
      const metodo = url.searchParams.get('metodo') === 'VOICE' ? 'VOICE' : 'SMS'
      resultado = await graph(`/${canal.phoneId}/request_code?code_method=${metodo}&language=es`, 'POST')
    } else if (accion === 'verificar-codigo') {
      const codigo = (url.searchParams.get('codigo') || '').replace(/\D/g, '')
      if (codigo.length !== 6) return Response.json({ error: 'El código debe tener 6 dígitos' }, { status: 400 })
      resultado = await graph(`/${canal.phoneId}/verify_code?code=${codigo}`, 'POST')
    } else {
      const pin = url.searchParams.get('pin') || ''
      if (!/^\d{6}$/.test(pin)) return Response.json({ error: 'El PIN debe tener 6 dígitos' }, { status: 400 })
      resultado = await graph(`/${canal.phoneId}/register?messaging_product=whatsapp&pin=${pin}`, 'POST')
      // Sin la app suscrita a la WABA no llega ni un webhook, aunque el número quede sano.
      resultado = { register: resultado, suscribir: await graph(`/${canal.wabaId}/subscribed_apps`, 'POST') }
    }
    return Response.json({ canal: canal.id, accion, antes, resultado, despues: await leer() })
  }

  // ── Catálogo de WhatsApp (25-sep-2026) ──
  // El catálogo se conecta a la WABA, no al número: REPUBLIC, al vivir en la WABA
  // de MANDI, hereda el mismo. Lo que es POR NÚMERO es si se muestra el catálogo
  // y el carrito (`whatsapp_commerce_settings`).
  //   ?accion=comercio                → lee catálogos de la WABA y ajustes del número
  //   ?accion=comercio-activar        → prende catálogo visible + carrito en el número
  // ?accion=catalogos → TODOS los catálogos del negocio (propios y de clientes),
  // para elegir cuál conectar a la WABA. Solo lectura.
  if (accion === 'catalogos') {
    const dueno = await graph(`/${canal.wabaId}?fields=owner_business_info`)
    const businessId = dueno?.owner_business_info?.id
    if (!businessId) return Response.json({ error: 'No se pudo leer el negocio dueño', dueno }, { status: 500 })
    const campos = 'id,name,product_count,vertical,business{id,name}'
    const [propios, clientes, conectados] = await Promise.all([
      graph(`/${businessId}/owned_product_catalogs?fields=${campos}&limit=50`),
      graph(`/${businessId}/client_product_catalogs?fields=${campos}&limit=50`),
      graph(`/${canal.wabaId}/product_catalogs?fields=id,name`),
    ])
    return Response.json({ canal: canal.id, businessId, conectado_a_la_waba: conectados?.data || conectados, propios: propios?.data || propios, de_clientes: clientes?.data || clientes })
  }

  // ?accion=wabas-catalogos → qué catálogo tiene conectado CADA WABA del negocio.
  // Meta deja un catálogo en una sola WABA: sirve para encontrar dónde está. Lectura.
  if (accion === 'wabas-catalogos') {
    const dueno = await graph(`/${canal.wabaId}?fields=owner_business_info`)
    const businessId = dueno?.owner_business_info?.id
    const campos = 'id,name,product_catalogs{id,name},phone_numbers{id,display_phone_number}'
    const [propias, clientes] = await Promise.all([
      graph(`/${businessId}/owned_whatsapp_business_accounts?fields=${campos}&limit=50`),
      graph(`/${businessId}/client_whatsapp_business_accounts?fields=${campos}&limit=50`),
    ])
    return Response.json({ businessId, propias: propias?.data || propias, clientes: clientes?.data || clientes })
  }

  // ?accion=conectar-catalogo&catalogo=<id> → cambia el catálogo de la WABA.
  // ⚠️ Meta permite UNO por WABA y la WABA es COMPARTIDA (MANDI + REPUBLIC):
  // cambiarlo acá lo cambia para los dos números. Solo acepta catálogos propios
  // del negocio; desconecta el anterior y relee para no fiarse del 200.
  // ?accion=soltar-catalogo&waba=<id>&catalogo=<id> → desvincula un catálogo de
  // OTRA WABA del mismo negocio (para poder moverlo). Solo WABAs propias.
  if (accion === 'soltar-catalogo') {
    const wabaOtra = url.searchParams.get('waba') || ''
    const cat = url.searchParams.get('catalogo') || ''
    const dueno = await graph(`/${canal.wabaId}?fields=owner_business_info`)
    const businessId = dueno?.owner_business_info?.id
    const propias = await graph(`/${businessId}/owned_whatsapp_business_accounts?fields=id&limit=50`)
    if (!(propias?.data || []).some((w) => w.id === wabaOtra)) {
      return Response.json({ error: 'Esa WABA no es propia del negocio', wabaOtra }, { status: 400 })
    }
    const soltar = await graph(`/${wabaOtra}/product_catalogs?catalog_id=${cat}`, 'DELETE')
    const despues = await graph(`/${wabaOtra}/product_catalogs?fields=id,name`)
    return Response.json({ wabaOtra, soltar, despues: despues?.data || despues })
  }

  if (accion === 'conectar-catalogo') {
    const nuevo = url.searchParams.get('catalogo') || ''
    const dueno = await graph(`/${canal.wabaId}?fields=owner_business_info`)
    const businessId = dueno?.owner_business_info?.id
    const propios = businessId ? await graph(`/${businessId}/owned_product_catalogs?fields=id,name&limit=50`) : null
    if (!(propios?.data || []).some((c) => c.id === nuevo)) {
      return Response.json({ error: 'Ese catálogo no es del negocio', nuevo, propios: propios?.data || propios }, { status: 400 })
    }
    const antes = await graph(`/${canal.wabaId}/product_catalogs?fields=id,name`)
    const desconectados = []
    for (const c of antes?.data || []) {
      if (c.id !== nuevo) desconectados.push(await graph(`/${canal.wabaId}/product_catalogs?catalog_id=${c.id}`, 'DELETE'))
    }
    const conectar = await graph(`/${canal.wabaId}/product_catalogs?catalog_id=${nuevo}`, 'POST')
    const despues = await graph(`/${canal.wabaId}/product_catalogs?fields=id,name,product_count`)
    return Response.json({ canal: canal.id, antes: antes?.data || antes, desconectados, conectar, despues: despues?.data || despues })
  }

  if (accion === 'comercio' || accion === 'comercio-activar') {
    const leerComercio = () => graph(`/${canal.phoneId}/whatsapp_commerce_settings`)
    const catalogos = await graph(`/${canal.wabaId}/product_catalogs?fields=id,name,product_count`)
    const antes = await leerComercio()
    let resultado = null
    if (accion === 'comercio-activar') {
      resultado = await graph(`/${canal.phoneId}/whatsapp_commerce_settings?is_catalog_visible=true&is_cart_enabled=true`, 'POST')
    }
    return Response.json({ canal: canal.id, catalogos: catalogos?.data || catalogos, antes, resultado, despues: resultado ? await leerComercio() : undefined })
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
        `code_verification_status,throughput,messaging_limit_tier,account_mode,health_status`
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
