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
  const pixel = process.env.META_CAPI_PIXEL_ID
  const token = process.env.META_CAPI_TOKEN
  if (!pixel || !token) {
    out.meta = { ok: false, error: `falta ${!pixel ? 'META_CAPI_PIXEL_ID' : 'META_CAPI_TOKEN'}` }
  } else {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}?fields=name,is_active&access_token=${token}`)
      const b = await r.json().catch(() => ({}))
      out.meta = r.ok
        ? { ok: true, pixel, dataset: b?.name, activo: b?.is_active }
        : { ok: false, pixel, codigo: b?.error?.code, error: b?.error?.message || `HTTP ${r.status}` }
    } catch (e) {
      out.meta = { ok: false, pixel, error: e.message }
    }
  }

  // ── 2. Telegram ───────────────────────────────────────────────────────────
  const bot = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ERRORES || process.env.TELEGRAM_CHAT_VENTAS || '-5103132453'
  if (!bot) {
    out.telegram = { ok: false, error: 'falta TELEGRAM_BOT_TOKEN' }
  } else {
    const texto =
      `🧪 *PRUEBA — no es una venta ni un error*\n` +
      `Diagnóstico de las señales de pauta desde *${CUENTA}*.\n\n` +
      `Token de Meta: ${out.meta?.ok ? `✅ sirve para “${out.meta.dataset}”` : `❌ ${out.meta?.error || 'falla'}`}\n` +
      `Si estás leyendo esto, el aviso por Telegram funciona.`
    try {
      const r = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'Markdown' }),
      })
      const b = await r.json().catch(() => ({}))
      out.telegram = r.ok ? { ok: true, chat } : { ok: false, chat, error: b?.description || `HTTP ${r.status}` }
    } catch (e) {
      out.telegram = { ok: false, chat, error: e.message }
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
