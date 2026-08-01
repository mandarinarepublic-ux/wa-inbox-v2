// lib/capi.js — Señales de conversión a Meta desde el inbox (Conversions API,
// canal "business messaging").
//
// PARA QUÉ: hoy Meta ve el click en el anuncio y ahí se le corta el rastro. No
// sabe cuáles de esas conversaciones avanzaron ni cuáles compraron, así que
// optimiza a ciegas hacia quien abre un chat, no hacia quien paga. Esto le
// devuelve el final de la historia.
//
// LO QUE HACE DISTINTO A UN CAPI NORMAL (y por qué no se puede copiar del CRM):
//
//   1. `action_source: 'business_messaging'` + `messaging_channel: 'whatsapp'`.
//      NO 'website' ni 'chat'. Con otro action_source Meta acepta el evento
//      (200 OK) pero no lo atribuye a ningún anuncio: se pierde en silencio.
//
//   2. La llave de atribución es el `ctwa_clid`, no el email ni el teléfono. Sin
//      clid no hay nada que atribuir y el evento se descarta acá mismo. Ese clid
//      lo manda Meta en el `referral` del PRIMER mensaje que entra desde un
//      anuncio Click-to-WhatsApp, y vive en inbox.conversaciones.ctwa_clid.
//
//   3. Meta NO deduplica los eventos de business_messaging (a diferencia del
//      pixel web, donde el event_id le basta). La garantía de "un solo Lead por
//      contacto" es nuestra y la da el UNIQUE de inbox.capi_events.event_id: se
//      inserta ANTES de llamar a Meta, y si la fila ya existía no se envía. Un
//      chequeo previo tipo "select ... if not exists" tendría carrera con Meta
//      reintentando el mismo webhook.
//
//   4. El `whatsapp_business_account_id` sale del phone_id por el que entró el
//      click (lib/canales.js), no de una variable global: cada número está en
//      una WABA distinta.
//
// Purchase NO se manda desde acá: lo sigue enviando el CRM (lib/metaCapi.js),
// que es el único que sabe de pagos. Si el inbox mandara otro Purchase con un
// event_id distinto, Meta contaría la venta DOS veces.
//
// Nada de esto puede tumbar el webhook: todas las funciones devuelven un objeto
// y jamás lanzan.

import { getSupabase, CUENTA } from './supabase.js'
import { wabaIdDePhoneId } from './canales.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Cuántos mensajes ENTRANTES hacen falta para considerar el chat un Lead. */
export const LEAD_UMBRAL = Number(process.env.CAPI_LEAD_UMBRAL || 4)

/**
 * Ventana desde que se capturó el clid. Meta rechaza eventos de más de 7 días,
 * pero además un Lead que llega una semana tarde ya no le sirve para optimizar.
 */
const VENTANA_HORAS = Number(process.env.CAPI_VENTANA_HORAS || 72)

export function capiConfigurado() {
  return Boolean(process.env.META_CAPI_PIXEL_ID && process.env.META_CAPI_TOKEN)
}

/** event_id determinístico. Lleva `cuenta` porque MANDI e IND comparten base. */
function eventIdDe(evento, telefono) {
  return `${CUENTA}-${telefono}-${evento.toLowerCase()}`
}

/**
 * Envía un evento de conversión a Meta si el contacto vino de un anuncio.
 *
 * @param {'Lead'|'InitiateCheckout'} evento
 * @param {string} telefono
 * @param {number|null} value  monto estimado (solo InitiateCheckout)
 * @returns {Promise<{omitido?: string, enviado?: string, status?: number, error?: string}>}
 */
export async function enviarEventoCapi({ evento, telefono, value = null }) {
  try {
    if (!capiConfigurado()) return { omitido: 'capi_no_configurado' }
    if (!telefono) return { omitido: 'sin_telefono' }

    const sb = getSupabase()

    const { data: conv } = await sb
      .from('conversaciones')
      .select('ctwa_clid, ctwa_phone_id, ctwa_captured_at')
      .eq('cuenta', CUENTA)
      .eq('telefono', telefono)
      .maybeSingle()

    // Sin click ID no hay atribución posible. No es un error: es la mayoría de
    // los chats (los que no vienen de pauta).
    if (!conv?.ctwa_clid) return { omitido: 'sin_ctwa_clid' }

    const wabaId = wabaIdDePhoneId(conv.ctwa_phone_id)
    if (!wabaId) return { omitido: 'phone_id_desconocido' }

    const eventId = eventIdDe(evento, telefono)

    // Dedup: si el UNIQUE rebota, este contacto ya tiene su evento. Se inserta
    // ANTES de llamar a Meta a propósito (ver nota 3 arriba).
    const { error: errInsert } = await sb.from('capi_events').insert({
      cuenta: CUENTA,
      telefono,
      event_name: evento,
      event_id: eventId,
      ctwa_clid: conv.ctwa_clid,
      waba_id: wabaId,
      value,
    })
    if (errInsert) return { omitido: 'ya_enviado' }

    const payload = {
      data: [{
        event_name: evento,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: {
          whatsapp_business_account_id: wabaId,
          ctwa_clid: conv.ctwa_clid,
        },
        ...(value != null && {
          custom_data: { currency: 'USD', value: Number(parseFloat(value).toFixed(2)) },
        }),
      }],
      access_token: process.env.META_CAPI_TOKEN,
    }

    let res, body
    try {
      res = await fetch(`${GRAPH}/${process.env.META_CAPI_PIXEL_ID}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      body = await res.json().catch(() => ({}))
    } catch (e) {
      // Falla de red: es transitoria, así que se borra la marca para que el
      // próximo mensaje del cliente lo reintente. Si se dejara puesta, un corte
      // de dos segundos costaría el Lead de ese contacto para siempre.
      await sb.from('capi_events').delete().eq('event_id', eventId)
      console.error(`[capi] ${evento} ${telefono}: ${e.message}`)
      return { error: e.message, reintentable: true }
    }

    await sb.from('capi_events')
      .update({ http_status: res.status, meta_response: body })
      .eq('event_id', eventId)

    if (!res.ok) {
      const detalle = body?.error?.message || `HTTP ${res.status}`
      console.error(`[capi] ${evento} ${telefono}: ${detalle}`)
      // 5xx = problema de Meta, se reintenta. 4xx = token o clid malos: la marca
      // se deja puesta para no golpear a Meta en cada mensaje que entre, y el
      // http_status queda guardado para verlo en la query de salud.
      if (res.status >= 500) {
        await sb.from('capi_events').delete().eq('event_id', eventId)
        return { error: detalle, reintentable: true }
      }
      return { error: detalle, status: res.status }
    }

    return { enviado: evento, eventId, status: res.status, recibidos: body?.events_received ?? 0 }
  } catch (e) {
    console.error(`[capi] ${evento} ${telefono}:`, e.message)
    return { error: e.message }
  }
}

/**
 * Guarda el ctwa_clid del anuncio en la conversación. Se llama por cada mensaje
 * entrante; los que no traen referral no hacen nada.
 *
 * GANA EL PRIMERO, nunca se pisa: si el cliente vuelve a entrar por otro anuncio
 * semanas después, la venta le pertenece al anuncio que lo trajo. Eso lo asegura
 * el `.is('ctwa_clid', null)` del update, no un if en JavaScript (dos mensajes
 * del mismo lote podrían pisarse entre ellos).
 *
 * El clid ya se venía guardando en inbox.mensajes.referral desde el 14-jul; esto
 * lo promueve a la conversación, que es donde el CRM puede encontrarlo meses
 * después al registrar la venta.
 */
export async function capturarCtwaClid({ telefono, referral, phoneId }) {
  try {
    const clid = referral?.ctwa_clid
    if (!clid || !telefono) return { omitido: 'sin_referral' }

    const sb = getSupabase()
    const { data } = await sb
      .from('conversaciones')
      .update({
        ctwa_clid: clid,
        ctwa_source_id: referral.source_id || null,
        ctwa_phone_id: phoneId || null,
        ctwa_captured_at: new Date().toISOString(),
      })
      .eq('cuenta', CUENTA)
      .eq('telefono', telefono)
      .is('ctwa_clid', null)
      .select('telefono')

    return data?.length ? { capturado: clid } : { omitido: 'ya_tenia' }
  } catch (e) {
    console.error('[capi] capturarCtwaClid:', e.message)
    return { error: e.message }
  }
}

/**
 * Lead automático: el contacto vino de un anuncio y ya escribió lo suficiente
 * como para no ser un curioso.
 *
 * El umbral es de mensajes ENTRANTES, no del estado de la bandeja ni de la
 * etiqueta 🔥 CALIENTE: esas las pone un humano y mezclan ventas con soporte,
 * así que como señal para Meta serían ruido.
 */
export async function revisarLeadAutomatico(telefono) {
  try {
    if (!capiConfigurado() || !telefono) return { omitido: 'no_aplica' }

    const sb = getSupabase()

    const { data: conv } = await sb
      .from('conversaciones')
      .select('ctwa_clid, ctwa_captured_at')
      .eq('cuenta', CUENTA)
      .eq('telefono', telefono)
      .maybeSingle()

    if (!conv?.ctwa_clid) return { omitido: 'sin_ctwa_clid' }

    const capturado = conv.ctwa_captured_at ? new Date(conv.ctwa_captured_at).getTime() : 0
    if (!capturado) return { omitido: 'sin_fecha_captura' }
    const horas = (Date.now() - capturado) / 3.6e6
    if (horas > VENTANA_HORAS) return { omitido: 'fuera_de_ventana' }

    // head:true → solo el conteo, no trae las filas (son miles por chat).
    const { count } = await sb
      .from('mensajes')
      .select('mensaje_id', { count: 'exact', head: true })
      .eq('cuenta', CUENTA)
      .eq('telefono', telefono)
      .eq('direccion', 'ENTRANTE')

    if ((count || 0) < LEAD_UMBRAL) return { omitido: 'bajo_umbral', entrantes: count || 0 }

    return await enviarEventoCapi({ evento: 'Lead', telefono })
  } catch (e) {
    console.error('[capi] revisarLeadAutomatico:', e.message)
    return { error: e.message }
  }
}
