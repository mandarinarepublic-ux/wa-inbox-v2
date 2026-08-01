// GET /api/capi/diag?clave=DIAG_KEY
//
// Comprueba de una que las señales a Meta están bien enchufadas, SIN esperar a
// que caiga un cliente real:
//
//   1. ¿El token de Meta sirve para ESTE dataset? Se resuelve leyendo el
//      dataset, no mandando un evento: un evento de prueba ensuciaría las
//      estadísticas de la pauta, y encima Meta tarda ~30 min en mostrarlo, así
//      que ni siquiera serviría para saberlo ahora. Si el token está vencido o
//      es de otro dataset, la lectura falla con el mismo error que fallaría el
//      envío ("cannot be loaded due to missing permissions") — que es
//      exactamente el que costó tiempo el 25-jul.
//   2. ¿Sale el aviso por Telegram? Manda un mensaje de prueba al chat.
//   3. Cuántos contactos hay listos para disparar.
//
// Protegida con DIAG_KEY porque estos repos son PÚBLICOS: sin llave, cualquiera
// que encuentre la ruta podría llenar de mensajes el chat del equipo. Si la
// variable no está puesta, la ruta responde 404 y no existe.
import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { capiConfigurado, LEAD_UMBRAL, VENTA_UMBRAL } from '@/lib/capi'
import { env, revisarEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  const clave = process.env.DIAG_KEY
  const dada = new URL(req.url).searchParams.get('clave')
  // Sin DIAG_KEY configurada la ruta directamente no existe.
  if (!clave || dada !== clave) {
    return NextResponse.json({ error: 'no encontrado' }, { status: 404 })
  }

  const out = { cuenta: CUENTA, configurado: capiConfigurado(), umbrales: { lead: LEAD_UMBRAL, venta: VENTA_UMBRAL } }

  // ── 1. Token de Meta ──────────────────────────────────────────────────────
  //
  // Se prueba con un POST de lista VACÍA al MISMO endpoint que usamos de verdad.
  //
  // La primera versión leía el dataset (`GET /{pixel}`) y daba un falso negativo
  // gordo: "(#100) Missing Permission", como si el token estuviera roto. Un token
  // de CAPI puede PUBLICAR eventos sin poder LEER los metadatos del dataset —
  // son permisos distintos. Casi mandamos a regenerar un token que estaba bien.
  //
  // Con `data: []` Meta valida el token y el acceso al dataset, responde 200 con
  // events_received: 0, y no se crea ninguna conversión: cero contaminación de
  // las estadísticas de la pauta.
  const pixel = env('META_CAPI_PIXEL_ID')
  const token = env('META_CAPI_TOKEN')
  if (!pixel || !token) {
    out.meta = { ok: false, error: `falta ${!pixel ? 'META_CAPI_PIXEL_ID' : 'META_CAPI_TOKEN'}` }
  } else {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [], access_token: token }),
      })
      const b = await r.json().catch(() => ({}))
      out.meta = r.ok
        ? { ok: true, pixel, nota: 'el token publica en este dataset' }
        : {
            ok: false, pixel,
            codigo: b?.error?.code,
            subcodigo: b?.error?.error_subcode,
            error: b?.error?.message || `HTTP ${r.status}`,
            // Acá es donde Meta explica de verdad qué pasa. El `message` suele ser
            // un "Invalid parameter" que no dice nada.
            detalle: b?.error?.error_user_msg || undefined,
          }
    } catch (e) {
      out.meta = { ok: false, pixel, error: e.message }
    }
    const problema = revisarEnv('META_CAPI_TOKEN')
    if (problema) out.meta.avisoVariable = `META_CAPI_TOKEN ${problema}`
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
        ? '✅ el token publica en el dataset'
        : `❌ ${out.meta?.detalle || out.meta?.error || 'falla'}`}\n\n` +
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
