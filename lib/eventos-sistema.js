// lib/eventos-sistema.js — Reporta los fallos del CAPI al tablero de errores del
// CRM (`crm.eventos_sistema`, que se ve en /dashboard/errores) y avisa por
// Telegram.
//
// POR QUÉ AL CRM Y NO A UN TABLERO PROPIO: el Purchase ya cae ahí. Si el Lead y
// el InitiateCheckout cayeran en otro lado, diagnosticar "por qué esta venta no
// se atribuyó" obligaría a mirar dos pantallas del mismo embudo. Además el
// inbox es la herramienta de los vendedores: los fallos de la tubería de pauta
// ahí serían ruido para quien está atendiendo chats.
//
// Es la misma base, solo otro schema — el CRM ya hace el camino inverso (lee
// `inbox` para sacar el ctwa_clid). Nada de saltos HTTP entre las apps.
//
// SOLO SE REPORTAN LOS ERRORES. El registro completo de cada evento (incluidos
// los que salen bien) vive en `inbox.capi_events`, que es la bitácora de verdad.
// Mandar los `ok` acá llenaría el tablero de filas que no piden nada: hoy ya hay
// 100 así del CRM.
//
// Nada de este archivo lanza nunca: un fallo al reportar un fallo no puede
// tumbar el webhook.
import { createClient } from '@supabase/supabase-js'
import { CUENTA } from './supabase.js'
import { env } from './env.js'

/** Cada cuánto se repite el aviso del MISMO error. Ver nota de abajo. */
const SILENCIO_MIN = Number(process.env.CAPI_ALERTA_SILENCIO_MIN || 15)

let _crm = null
function getCrm() {
  if (_crm) return _crm
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _crm = createClient(url, key, {
    db: { schema: 'crm' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })
  return _crm
}

/**
 * Chat al que va el aviso.
 *
 * MISMO BOT Y MISMO CHAT que las ventas: `TELEGRAM_CHAT_ERRORES` nunca se
 * configuró, así que las alertas de error del CRM llevan meses sin salir. En vez
 * de pedir un grupo nuevo, esto cae donde el equipo ya mira — pero con un texto
 * que no se puede confundir con una venta, y con el silenciador de repetidos
 * para no volver inservible el chat.
 *
 * El default es el mismo de MANDARINACRM/lib/telegram.js (el chat que venía de
 * Make). Si algún día se quiere separar, basta poner TELEGRAM_CHAT_ERRORES.
 */
const CHAT_DEFAULT = '-5103132453'
function chatDeAvisos() {
  return env('TELEGRAM_CHAT_ERRORES')
      || env('TELEGRAM_CHAT_VENTAS')
      || CHAT_DEFAULT
}

/** Manda el aviso por Telegram. No lanza. Silencioso si falta el token. */
async function avisarTelegram(texto) {
  const token = env('TELEGRAM_BOT_TOKEN')
  const chat = chatDeAvisos()
  if (!token || !chat) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: texto,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      console.error('[eventos] Telegram:', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return false
    }
    return true
  } catch (e) {
    console.error('[eventos] Telegram:', e.message)
    return false
  }
}

/**
 * ¿Ya avisamos de este mismo error hace poco?
 *
 * Sin esto, un token vencido genera un evento y un mensaje de Telegram POR CADA
 * mensaje que entre: con el tráfico de un día normal son cientos de avisos
 * idénticos, y el chat de errores se vuelve inservible justo cuando más falta
 * hace. Se agrupa por (cuenta, código de Meta), que es lo que identifica la
 * causa: mil contactos afectados por el mismo token muerto son UN problema.
 */
async function yaAvisado(crm, codigo) {
  const desde = new Date(Date.now() - SILENCIO_MIN * 60_000).toISOString()
  const { data } = await crm
    .from('eventos_sistema')
    .select('id')
    .eq('fuente', 'meta')
    .eq('nivel', 'error')
    .gte('fecha', desde)
    .contains('detalle', { cuenta: CUENTA, codigo: codigo ?? null })
    .limit(1)
  return Boolean(data?.length)
}

/**
 * Registra un fallo del CAPI en el tablero del CRM y avisa por Telegram.
 *
 * @param {object} f
 * @param {string} f.evento      'Lead' | 'InitiateCheckout'
 * @param {string} f.telefono
 * @param {string} f.mensaje     lo que dijo Meta
 * @param {number} [f.codigo]    error.code de Meta (190 = token vencido, etc.)
 * @param {number} [f.status]    HTTP
 * @param {boolean} [f.reintentable] si el próximo mensaje del cliente lo reintenta solo
 */
export async function reportarFalloCapi({ evento, telefono, mensaje, codigo, status, reintentable }) {
  try {
    const crm = getCrm()
    if (!crm) return { omitido: 'sin_supabase' }

    if (await yaAvisado(crm, codigo)) return { omitido: 'ya_avisado' }

    await crm.from('eventos_sistema').insert({
      fuente: 'meta',
      nivel: 'error',
      mensaje: `CAPI ${evento} (${CUENTA}): ${String(mensaje || '').slice(0, 900)}`,
      // pedido_id va vacío A PROPÓSITO: estos eventos son de una conversación,
      // no de un pedido. El tablero tiene que saber pintar un error sin pedido.
      pedido_id: null,
      detalle: {
        origen: 'inbox',
        cuenta: CUENTA,
        evento,
        telefono,
        codigo: codigo ?? null,
        status: status ?? null,
        reintentable: Boolean(reintentable),
      },
    })

    // El texto va pensado para el chat de VENTAS: tiene que leerse de un vistazo
    // como "esto no es una venta, es algo roto", y decir qué pasa si no se hace
    // nada. Si no, en medio de los avisos de pedidos pasa desapercibido.
    await avisarTelegram(
      `🚨 *ALERTA — no es una venta*\n` +
      `Las señales de pauta a Meta están fallando en *${CUENTA}*.\n\n` +
      `Evento: ${evento}${codigo ? `  ·  código ${codigo}` : ''}\n` +
      `Meta dice: _${String(mensaje || '').slice(0, 300)}_\n\n` +
      (reintentable
        ? '🔁 Se reintenta solo cuando el cliente vuelva a escribir. Si es el token, cámbialo y se recupera sin perder nada.'
        : '🛑 Esto NO se reintenta solo: hay que revisarlo a mano en /dashboard/errores.') +
      `\n\n_Los repetidos se silencian ${SILENCIO_MIN} min para no inundar el chat._`
    )

    return { reportado: true }
  } catch (e) {
    // Fallar al reportar un fallo no puede tumbar nada.
    console.error('[eventos] reportarFalloCapi:', e.message)
    return { error: e.message }
  }
}
