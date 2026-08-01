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
//      Y ese action_source trae su PROPIO vocabulario de eventos: 'Lead' no
//      existe acá, es 'LeadSubmitted'. Lo natural es escribir 'Lead' y Meta lo
//      rechaza (subcode 2804066). Antes de agregar un evento nuevo, comprobarlo:
//      la lista del pixel web no sirve de guía.
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
import { env } from './env.js'
import { reportarFalloCapi } from './eventos-sistema.js'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Cuántos mensajes ENTRANTES hacen falta para considerar el chat un Lead. */
export const LEAD_UMBRAL = Number(process.env.CAPI_LEAD_UMBRAL || 4)

/**
 * Venta en proceso: MÁS de 5 mensajes del cliente, o sea 6.
 * (Definición del negocio, 1-ago-2026. Ver revisarVentaEnProceso.)
 */
export const VENTA_UMBRAL = Number(process.env.CAPI_VENTA_UMBRAL || 6)

/**
 * Ventana desde que se capturó el clid. Un Lead que llega una semana tarde ya no
 * le sirve a Meta para optimizar, así que se corta a 3 días.
 */
const VENTANA_HORAS = Number(process.env.CAPI_VENTANA_HORAS || 72)

/**
 * La venta en proceso sí usa los 7 días completos: es la ventana de atribución
 * que Meta aplica al Click-to-WhatsApp, y una conversación que madura al cuarto
 * día es justo la que interesa reportar. Cortarla a 72 h como el Lead tiraría
 * señales buenas a la basura.
 */
const VENTANA_VENTA_HORAS = Number(process.env.CAPI_VENTANA_VENTA_HORAS || 168)

export function capiConfigurado() {
  return Boolean(env('META_CAPI_PIXEL_ID') && env('META_CAPI_TOKEN'))
}

/** event_id determinístico. Lleva `cuenta` porque MANDI e IND comparten base. */
function eventIdDe(evento, telefono) {
  return `${CUENTA}-${telefono}-${evento.toLowerCase()}`
}

/**
 * Envía un evento de conversión a Meta si el contacto vino de un anuncio.
 *
 * OJO CON EL NOMBRE DEL EVENTO: el canal de mensajería tiene su propio
 * vocabulario y NO es el del pixel web. 'Lead' —que es lo natural y lo que dice
 * medio internet— Meta lo rechaza con `business_messaging`; el que corresponde es
 * 'LeadSubmitted'. Se descubrió en producción el 1-ago (error_subcode 2804066).
 *
 * @param {'LeadSubmitted'|'InitiateCheckout'} evento
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
      access_token: env('META_CAPI_TOKEN'),
    }

    let res, body
    try {
      res = await fetch(`${GRAPH}/${env('META_CAPI_PIXEL_ID')}/events`, {
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
      await reportarFalloCapi({ evento, telefono, mensaje: e.message, reintentable: true })
      return { error: e.message, reintentable: true }
    }

    await sb.from('capi_events')
      .update({ http_status: res.status, meta_response: body })
      .eq('event_id', eventId)

    if (!res.ok) {
      // `message` suele ser un "Invalid parameter" que no dice nada; el que
      // explica de verdad es `error_user_msg`. La primera falla real (1-ago) fue
      // "Invalid parameter" en el log y, enterrado en el JSON, un mensaje que
      // decía exactamente qué configurar en Meta. Se prefiere el útil.
      const detalle = body?.error?.error_user_msg || body?.error?.message || `HTTP ${res.status}`
      console.error(`[capi] ${evento} ${telefono}: ${detalle}`)

      // Qué se reintenta y qué no, que es la diferencia entre perder un contacto
      // y perderlos todos:
      //
      //  - 5xx: problema de Meta. Se reintenta.
      //  - Token vencido o sin permisos (190/102/10/200/294): el problema es
      //    NUESTRO y se arregla poniendo un token bueno. Si dejáramos la marca,
      //    cada contacto tocado durante la falla quedaría quemado para siempre,
      //    porque el UNIQUE le cierra la puerta y nadie lo reintenta jamás. Y
      //    esto no es hipotético: el token de página caducó el 24-jun y nadie se
      //    enteró hasta semanas después. Se borra la marca y el próximo mensaje
      //    del cliente lo vuelve a intentar solo.
      //  - El resto de 4xx (un clid inválido, por ejemplo) sí es culpa del dato:
      //    ahí la marca se queda, porque reintentar no lo va a arreglar y solo
      //    golpearía a Meta con cada mensaje que entre.
      // La pregunta que decide es una sola: ¿esto se arregla tocando algo
      // NUESTRO? Si sí, hay que reintentar, porque si no, cada contacto tocado
      // durante la falla queda quemado para siempre.
      const codigo = Number(body?.error?.code)
      const subcodigo = Number(body?.error?.error_subcode)
      const esCulpaNuestra =
        [190, 102, 10, 200, 294].includes(codigo) ||   // token vencido o sin permisos
        subcodigo === 2804132                          // falta asociar la WABA al dataset

      const reintentable = res.status >= 500 || esCulpaNuestra
      if (reintentable) await sb.from('capi_events').delete().eq('event_id', eventId)

      // Al tablero de errores del CRM (/dashboard/errores) + aviso por Telegram.
      // Los repetidos se silencian ahí adentro: un token muerto son cientos de
      // mensajes con el mismo problema, y hay que contarlo UNA vez.
      await reportarFalloCapi({
        evento, telefono, mensaje: detalle, codigo, status: res.status, reintentable,
      })

      return { error: detalle, codigo, status: res.status, reintentable }
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
    // OJO: normalizarReferral() rellena los campos que faltan con CADENA VACÍA,
    // no con null. Un anuncio que no es Click-to-WhatsApp (un post promocionado)
    // trae referral pero sin click id, y ahí `ctwa_clid` llega como ''. Guardarlo
    // sería peor que no guardar nada: no sirve para atribuir Y deja el candado
    // puesto, así que si el cliente después entra por un anuncio de verdad su
    // clid bueno ya no entraría. Por eso el guard es `!clid` y no `clid == null`.
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
      // Gana el primero, pero una cadena vacía no cuenta como "primero" (quedaron
      // 48 así del backfill inicial; ver migración capi_ctwa_clid_vacio_a_null).
      .or('ctwa_clid.is.null,ctwa_clid.eq.')
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

    // 'LeadSubmitted', no 'Lead': ver la nota en enviarEventoCapi.
    return await enviarEventoCapi({ evento: 'LeadSubmitted', telefono })
  } catch (e) {
    console.error('[capi] revisarLeadAutomatico:', e.message)
    return { error: e.message }
  }
}

/**
 * Venta en proceso → InitiateCheckout.
 *
 * Definición del negocio (1-ago-2026): el chat cuenta como venta en proceso si
 * se cumple CUALQUIERA de las tres:
 *
 *   - está marcado 🔥 CALIENTE
 *   - está en la bandeja SOPORTE
 *   - el cliente mandó MÁS DE 5 mensajes (o sea 6 o más)
 *
 * Las tres se leen de la base, nunca del que llama: así da igual desde dónde se
 * invoque (el webhook cuando entra un mensaje, o la ruta de estado cuando un
 * agente toca un botón) y el resultado es el mismo. La repetición no cuesta
 * nada: el UNIQUE de capi_events deja pasar un solo InitiateCheckout por
 * contacto.
 *
 * No hay relleno hacia atrás: si un contacto se marca CALIENTE con dos mensajes,
 * sale InitiateCheckout y NO se manda el Lead que nunca ocurrió. Meta espera un
 * embudo real, no uno reconstruido.
 */
export async function revisarVentaEnProceso(telefono) {
  try {
    if (!capiConfigurado() || !telefono) return { omitido: 'no_aplica' }

    const sb = getSupabase()

    const { data: conv } = await sb
      .from('conversaciones')
      .select('ctwa_clid, ctwa_captured_at, temperatura, estado')
      .eq('cuenta', CUENTA)
      .eq('telefono', telefono)
      .maybeSingle()

    if (!conv?.ctwa_clid) return { omitido: 'sin_ctwa_clid' }

    const capturado = conv.ctwa_captured_at ? new Date(conv.ctwa_captured_at).getTime() : 0
    if (!capturado) return { omitido: 'sin_fecha_captura' }
    if ((Date.now() - capturado) / 3.6e6 > VENTANA_VENTA_HORAS) return { omitido: 'fuera_de_ventana' }

    const caliente = String(conv.temperatura || '').toLowerCase() === 'caliente'
    const soporte  = String(conv.estado || '').toUpperCase() === 'SOPORTE'

    let motivo = caliente ? 'caliente' : soporte ? 'soporte' : null

    // El conteo solo se pide si hace falta: con la marca manual ya alcanza.
    if (!motivo) {
      const { count } = await sb
        .from('mensajes')
        .select('mensaje_id', { count: 'exact', head: true })
        .eq('cuenta', CUENTA)
        .eq('telefono', telefono)
        .eq('direccion', 'ENTRANTE')
      if ((count || 0) < VENTA_UMBRAL) return { omitido: 'bajo_umbral', entrantes: count || 0 }
      motivo = `${count}_entrantes`
    }

    const r = await enviarEventoCapi({ evento: 'InitiateCheckout', telefono })
    return { ...r, motivo }
  } catch (e) {
    console.error('[capi] revisarVentaEnProceso:', e.message)
    return { error: e.message }
  }
}
