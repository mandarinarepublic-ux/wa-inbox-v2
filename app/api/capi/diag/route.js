// GET /api/capi/diag?clave=DIAG_KEY
//
// Comprueba de una que las señales a Meta están bien enchufadas, SIN esperar a
// que caiga un cliente real:
//
//   1. Para CADA número: cuál es su dataset de mensajería y si el token puede
//      publicar ahí. Un dataset por WABA, no el pixel del sitio.
//   2. ¿Sale el aviso por Telegram? Manda un mensaje de prueba al chat.
//   3. Cuántos contactos hay listos para disparar.
//
// Correr esto CREA el dataset de la WABA si aún no existe (POST /{waba}/dataset
// devuelve el que haya, o lo crea). Es justamente lo que hay que hacer: no
// existe forma de asociar una WABA a un dataset desde el panel — esa sección no
// está, se recorrió entera el 1-ago buscándola.
//
// Protegida con DIAG_KEY porque estos repos son PÚBLICOS: sin llave, cualquiera
// que encuentre la ruta podría llenar de mensajes el chat del equipo. Si la
// variable no está puesta, la ruta responde 404 y no existe.
import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { capiConfigurado, LEAD_UMBRAL, VENTA_UMBRAL } from '@/lib/capi'
import { env, revisarEnv } from '@/lib/env'
import { CANALES } from '@/lib/canales'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  const clave = process.env.DIAG_KEY
  const dada = new URL(req.url).searchParams.get('clave')
  // Sin DIAG_KEY configurada la ruta directamente no existe.
  if (!clave || dada !== clave) {
    return NextResponse.json({ error: 'no encontrado' }, { status: 404 })
  }

  const out = { cuenta: CUENTA, configurado: capiConfigurado(), umbrales: { lead: LEAD_UMBRAL, venta: VENTA_UMBRAL } }

  // ── 1. Un dataset POR CANAL ───────────────────────────────────────────────
  //
  // Los eventos de Click-to-WhatsApp van a un dataset atado a la WABA, NO al
  // pixel del sitio. Para cada número se resuelve (o se crea) el suyo y se prueba
  // que el token pueda publicar ahí.
  //
  // La prueba de publicación se hace con un POST de lista VACÍA al MISMO endpoint
  // que usamos de verdad: Meta valida token y acceso, responde 200 con
  // events_received: 0, y no se crea ninguna conversión — cero contaminación de
  // las estadísticas de la pauta.
  //
  // La primera versión probaba el token LEYENDO el dataset y daba un falso
  // negativo gordo ("Missing Permission"), como si estuviera roto: un token de
  // CAPI puede PUBLICAR sin poder LEER metadatos. Casi mandamos a regenerar un
  // token que estaba perfecto.
  const capiToken = env('META_CAPI_TOKEN')
  const metaToken = env('META_TOKEN')
  out.canales = []

  for (const c of CANALES) {
    const fila = { canal: c.id, numero: c.etiqueta, waba: c.wabaId }
    try {
      // 1. ¿Cuál es su dataset? POST devuelve el que ya exista, o lo crea.
      const rd = await fetch(`https://graph.facebook.com/v21.0/${c.wabaId}/dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: metaToken }),
      })
      const bd = await rd.json().catch(() => ({}))
      fila.dataset = bd?.id || bd?.dataset_id || null
      if (!fila.dataset) {
        fila.error = bd?.error?.error_user_msg || bd?.error?.message || `HTTP ${rd.status}`
        out.canales.push(fila)
        continue
      }

      // 2. ¿El token de CAPI puede publicar ahí? Lista vacía: valida el acceso
      //    sin crear ninguna conversión.
      const re = await fetch(`https://graph.facebook.com/v21.0/${fila.dataset}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], access_token: capiToken }),
      })
      const be = await re.json().catch(() => ({}))
      fila.puedePublicar = re.ok
      if (!re.ok) {
        fila.codigo = be?.error?.code
        fila.subcodigo = be?.error?.error_subcode
        // Acá es donde Meta explica de verdad. El `message` suele ser un
        // "Invalid parameter" que no dice nada.
        fila.error = be?.error?.error_user_msg || be?.error?.message || `HTTP ${re.status}`
      }
    } catch (e) {
      fila.error = e.message
    }
    out.canales.push(fila)
  }

  out.meta = {
    ok: out.canales.length > 0 && out.canales.every(c => c.puedePublicar),
    tokenCapi: capiToken ? 'puesto' : 'FALTA META_CAPI_TOKEN',
    tokenWaba: metaToken ? 'puesto' : 'FALTA META_TOKEN',
  }
  for (const v of ['META_CAPI_TOKEN', 'META_TOKEN']) {
    const p = revisarEnv(v)
    if (p) out.meta.avisoVariable = `${v} ${p}`
  }

  // ── 2. Telegram ───────────────────────────────────────────────────────────
  const bot = env('TELEGRAM_BOT_TOKEN')
  const chat = env('TELEGRAM_CHAT_ERRORES') || env('TELEGRAM_CHAT_VENTAS') || '-5103132453'
  if (!bot) {
    out.telegram = { ok: false, error: 'falta TELEGRAM_BOT_TOKEN' }
  } else {
    // getMe primero: distingue "el token está mal" de "el chat está mal", que es
    // justo lo que el 404 "Not Found" de sendMessage NO deja ver. El token va
    // dentro de la URL, así que un BOM o un espacio la convierten en una ruta
    // inexistente y Telegram responde como si el bot no existiera.
    try {
      const me = await fetch(`https://api.telegram.org/bot${bot}/getMe`)
      const mb = await me.json().catch(() => ({}))
      out.telegram = me.ok
        ? { tokenOk: true, bot: mb?.result?.username }
        : { tokenOk: false, error: mb?.description || `HTTP ${me.status}` }
    } catch (e) {
      out.telegram = { tokenOk: false, error: e.message }
    }
    const problema = revisarEnv('TELEGRAM_BOT_TOKEN')
    if (problema) out.telegram.avisoVariable = `TELEGRAM_BOT_TOKEN ${problema}`
    if (!/^\d+:[\w-]+$/.test(bot)) out.telegram.formato = 'no tiene la forma 123456:ABC… — revisa lo que se pegó'
  }
  // Solo se intenta mandar si el token sirve: si no, el 404 de sendMessage
  // taparía el diagnóstico de getMe, que es el que dice la verdad.
  if (out.telegram?.tokenOk) {
    const texto =
      `🧪 *PRUEBA — no es una venta ni un error*\n` +
      `Diagnóstico de las señales de pauta desde *${CUENTA}*.\n\n` +
      `Envío a Meta: ${out.meta?.ok
        ? `✅ los ${out.canales.length} números pueden publicar`
        : `❌ ${out.canales.find(c => c.error)?.error || 'falla'}`}\n\n` +
      `Si estás leyendo esto, el aviso por Telegram funciona.`
    try {
      const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'Markdown' }),
      })
      const b = await r.json().catch(() => ({}))
      // Se conserva lo que dijo getMe: si el token está bien y falla acá, el
      // problema es el CHAT (el bot no está dentro del grupo, por ejemplo), y
      // eso hay que poder distinguirlo.
      out.telegram = r.ok
        ? { ...out.telegram, ok: true, chat }
        : { ...out.telegram, ok: false, chat, error: b?.description || `HTTP ${r.status}` }
    } catch (e) {
      out.telegram = { ...out.telegram, ok: false, chat, error: e.message }
    }
  }

  // ── 3. Cuántos están listos para disparar ────────────────────────────────
  try {
    const sb = getSupabase()
    const { count: conClid } = await sb.from('conversaciones')
      .select('conversacion_id', { count: 'exact', head: true })
      .eq('cuenta', CUENTA).not('ctwa_clid', 'is', null)
    const { count: enviados } = await sb.from('capi_events')
      .select('id', { count: 'exact', head: true }).eq('cuenta', CUENTA)
    out.datos = { conversaciones_con_clid: conClid ?? 0, eventos_ya_enviados: enviados ?? 0 }
  } catch (e) {
    out.datos = { error: e.message }
  }

  return NextResponse.json(out)
}
