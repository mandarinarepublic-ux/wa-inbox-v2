// lib/inbox-supabase.js — Implementaciones Supabase de la capa de datos del inbox.
// Mismo SHAPE de retorno que lib/mensajes.js / lib/contactos.js / lib/respuestas.js,
// para que las rutas no cambien. Modelo normalizado: conversaciones (=CONTACTOS) +
// mensajes (=MENSAJES) + respuestas_rapidas. Cuenta fija = CUENTA ('MANDI').
import { getSupabase, CUENTA, soloDigitos, canonTel } from './supabase.js'
import { phoneIdDeCanal, CANAL_POR_DEFECTO } from './canales.js'
import { contenidoTipoEspecial } from './wa-mensaje.js'
import { patchesDeMensaje } from './bandeja.js'
import { guardarAdjuntos } from './adjuntos-respuesta.js'

// ─── Conversación (contacto) ─────────────────────────────────────────────────

/** Devuelve el conversacion_id para (CUENTA, telefono), creándolo si no existe. */
async function getConvId(telefono, nombre = '', waId = '') {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  // upsert por (cuenta, telefono canónico): no pisa estado/alias/nombre editados.
  const { data, error } = await sb
    .from('conversaciones')
    .upsert({ cuenta: CUENTA, telefono: tel }, { onConflict: 'cuenta,telefono' })
    .select('conversacion_id')
    .single()
  if (error) throw error
  return data.conversacion_id
}

/** Fila conversaciones → shape de mapContactRow. */
function toContacto(c) {
  return {
    telefono: String(c.telefono || ''),
    nombre:   c.nombre_contacto || '',
    alias:    c.alias || '',
    estado:   String(c.estado || 'PENDIENTE').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente',
    waId:     c.wa_id || '',
    // Número por el que habla este contacto. Lo necesita cualquier envío
    // automático (cron de seguimientos) para responder por el canal correcto.
    phoneId:  c.phone_id || '',
    modoIA:   String(c.modo_ia || 'IA').toUpperCase() !== 'HUMANO',
    idVenta:  String(c.id_venta || '').trim(),
    notas:    c.notas || '',
    // Eje 2: temperatura del lead (pipeline manual). '' = sin clasificar.
    temperatura: String(c.temperatura || '').trim().toLowerCase(),
    ultimoMensajeAt:  c.ultimo_mensaje_at || null,
    ultimoEntranteAt: c.ultimo_entrante_at || null, // base de la ventana 24h
    ultimoSeguimientoAt: c.ultimo_seguimiento_at || null, // último auto-envío del cron
    alertaVentanaAt:     c.alerta_ventana_at || null,     // último aviso "caliente cerca de 24h"
    ultimoPushAt:        c.ultimo_push_at || null,        // último aviso de mensaje nuevo (push)
    ultimoAvisoTelegramAt: c.ultimo_aviso_telegram_at || null, // recordatorio de pendientes
  }
}

// Canal por defecto = el número principal (MANDI). La bandeja REPUBLIC pide el
// suyo. Sin este filtro las conversaciones de los dos números salen mezcladas en
// la misma lista y el vendedor no sabe a cuál está contestando.
const canalPorDefecto = () => phoneIdDeCanal(CANAL_POR_DEFECTO)

/**
 * Contactos del canal indicado. `canal = null` trae los de TODOS los números:
 * lo usan los lookups que no deben depender de la bandeja que se esté mirando.
 */
export async function getContactosSupabase(canal = canalPorDefecto()) {
  const sb = getSupabase()
  // PostgREST corta en 1000 filas por request. Con >1000 conversaciones, los contactos
  // que quedaban fuera NO aparecían en el mapa → se veían "pendiente" y cualquier cambio
  // de estado/temperatura se revertía al siguiente poll. Paginamos para traerlos TODOS.
  const pageSize = 1000
  let from = 0
  const filas = []
  for (;;) {
    let q = sb.from('conversaciones').select('*').eq('cuenta', CUENTA)
    if (canal) q = q.eq('phone_id', canal)   // canal null → todos los números
    const { data, error } = await q
      .order('conversacion_id', { ascending: true }) // orden estable para paginar sin huecos
      .range(from, from + pageSize - 1)
    if (error) throw error
    const lote = data || []
    filas.push(...lote)
    if (lote.length < pageSize) break
    from += pageSize
  }
  return filas.map(toContacto)
}

/** Upsert del contacto que acaba de escribir (webhook). No pisa nombre/waId no vacíos. */
export async function registrarContactoEntranteSupabase(telefono, nombre, waId) {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const { data: exist } = await sb
    .from('conversaciones').select('conversacion_id, nombre_contacto, wa_id, estado')
    .eq('cuenta', CUENTA).eq('telefono', tel).maybeSingle()

  if (!exist) {
    const { error } = await sb.from('conversaciones').insert({
      cuenta: CUENTA, telefono: tel, nombre_contacto: nombre || '', wa_id: waId || '',
      estado: 'PENDIENTE', modo_ia: 'HUMANO', // contacto nuevo → IA APAGADA (la prende un humano)
    })
    if (error && !/duplicate key/i.test(error.message)) throw error
    return { ok: true, creado: true }
  }
  const patch = {}
  if (nombre && !String(exist.nombre_contacto || '').trim()) patch.nombre_contacto = nombre
  if (waId && !String(exist.wa_id || '').trim()) patch.wa_id = waId
  // Un entrante REABRE la conversación: si estaba 'atendido' vuelve a PENDIENTE
  // porque necesita atención de nuevo. Sin esto, un cliente ya atendido que
  // vuelve a escribir NUNCA aparece en la bandeja y nadie lo ve.
  // No toca soporte/archivado/venta: son carriles deliberados. (Igual que IND.)
  if (String(exist.estado || '').trim().toUpperCase() === 'ATENDIDO') patch.estado = 'PENDIENTE'
  if (Object.keys(patch).length) {
    await sb.from('conversaciones').update(patch).eq('conversacion_id', exist.conversacion_id)
  }
  return { ok: true, creado: false }
}

/**
 * Asegura la conversación de un chat que abrimos NOSOTROS desde el celular (echo).
 * Si ya existe NO la toca: el estado es del dueño, y un echo no puede pisarlo.
 * Si no existe, nace ya atendida y con la IA apagada:
 *  - ATENDIDO porque el chat lo atendió un humano a mano; mandarlo a PENDIENTES
 *    sería pedir que alguien conteste algo que ya se contestó.
 *  - HUMANO porque el guard de "la IA arranca apagada" funciona por AUSENCIA del
 *    contacto en la agenda, y esta fila lo hace aparecer: con el default de la
 *    tabla ('IA'), MANDI AGENT respondería encima de una conversación que abrió
 *    una persona.
 */
export async function asegurarConversacionSalienteSupabase(telefono) {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const { data: exist } = await sb
    .from('conversaciones').select('conversacion_id')
    .eq('cuenta', CUENTA).eq('telefono', tel).maybeSingle()
  if (exist) return { ok: true, creado: false }
  const { error } = await sb.from('conversaciones').insert({
    cuenta: CUENTA, telefono: tel, estado: 'ATENDIDO', modo_ia: 'HUMANO',
  })
  if (error && !/duplicate key/i.test(error.message)) throw error
  return { ok: true, creado: true }
}

/** Setea un campo de la conversación por teléfono (crea la conversación si falta). */
async function setCampoContacto(telefono, campo, valor) {
  const sb = getSupabase()
  const tel = String(telefono)
  const convId = await getConvId(tel)
  const { error } = await sb.from('conversaciones').update({ [campo]: valor }).eq('conversacion_id', convId)
  if (error) throw error
  return { ok: true }
}

// ─── Bandeja (estado POR CANAL) ──────────────────────────────────────────────
//
// ⚠️ ESTAS FUNCIONES SON LA ÚNICA VERDAD sobre "¿le contesté?" y "¿está abierta la
// ventana?". `conversaciones.estado` sigue existiendo y sigue escribiéndose, pero
// SOLO para que el inbox de IND —que todavía no está migrado y lee la tabla
// vieja— no se entere de nada. Ver `updateEstadoSupabase`.
//
// La regla completa y el por qué están en lib/bandeja.js.
//
// ⚠️ NO EXISTE —y no debe volver a existir— una función que lea la tabla `bandeja`
// entera. El primer intento (19-ago) tenía `getBandejaSupabase(null)` y degradó el
// inbox de inmediato: como los dos contadores también la llamaban, salían TRES
// lecturas completas de 1.642 filas por cada ciclo de polling — 6 viajes de red y
// +142 kB en la ruta que ya es el 47 % del consumo de Vercel. Se notaba en el
// primer minuto de uso.
//
// El estado de bandeja viaja PEGADO a cada fila de la lista (vista
// `inbox.lista_bandeja`, ver getListaSupabase) y los contadores se agregan en la
// base (rpc `inbox.pendientes_bandeja`). Ninguna de las dos trae filas de más.

/**
 * Crea o actualiza la fila de bandeja de UNA conversación (teléfono + canal).
 *
 * `phoneId` es obligatorio y sin él NO escribe nada: una fila de bandeja sin canal
 * no significa nada, y aceptar un vacío la mandaría a la clave `''` donde se
 * mezclaría con cualquier otro mensaje que llegue sin canal. Devuelve `false` para
 * que quien llama pueda notarlo en vez de creer que guardó.
 */
async function upsertBandeja(telefono, phoneId, patch) {
  if (!phoneId) return false
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const { error } = await sb.from('bandeja').upsert(
    { cuenta: CUENTA, telefono: tel, phone_id: String(phoneId), ...patch, actualizado_en: new Date().toISOString() },
    { onConflict: 'cuenta,telefono,phone_id' },
  )
  if (error) throw error
  return true
}

/** Estado de bandeja de UNA conversación (teléfono + canal). */
export const updateEstadoBandejaSupabase = (tel, phoneId, estado) =>
  upsertBandeja(tel, phoneId, { estado: String(estado).toUpperCase() })

/**
 * Estado del contacto. Escribe en los DOS lados a propósito:
 *
 *  · `bandeja`        → la verdad nueva, por canal. Es lo que lee esta app.
 *  · `conversaciones` → lo que sigue leyendo el inbox de IND, que comparte esta
 *                       base y todavía no está migrado.
 *
 * ⚠️ NO quitar la segunda escritura hasta que IND también lea `bandeja`. Las filas
 * de `conversaciones` que se tocan acá son siempre de `cuenta='MANDI'`, así que
 * esto no puede alcanzar a los datos de IND — pero si MANDI dejara de escribirlas,
 * el CRM (que lee esa misma tabla para el chat del pedido) vería estados congelados.
 *
 * `phoneId` es opcional para no romper a los llamadores viejos; sin él solo escribe
 * el lado antiguo, que es exactamente lo que hacían antes.
 */
export const updateEstadoSupabase = async (tel, estado, phoneId = '') => {
  if (phoneId) await updateEstadoBandejaSupabase(tel, phoneId, estado)
  return setCampoContacto(tel, 'estado', String(estado).toUpperCase())
}
export const updateModoIASupabase   = (tel, modo)   => setCampoContacto(tel, 'modo_ia', modo)
export const updateNotasSupabase    = (tel, notas)  => setCampoContacto(tel, 'notas', notas)
export const updateAliasSupabase    = (tel, alias)  => setCampoContacto(tel, 'alias', alias)
export const updateIdVentaSupabase  = (tel, idV)    => setCampoContacto(tel, 'id_venta', idV)
// Eje 2: temperatura del lead. '' / null → limpia la clasificación.
export const updateTemperaturaSupabase = (tel, temp) =>
  setCampoContacto(tel, 'temperatura', temp ? String(temp).toLowerCase() : null)
// Tracking del cron de seguimientos (por conversacion_id, no crea si no existe).
export async function marcarSeguimientoSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'ultimo_seguimiento_at', ts || new Date().toISOString())
}
export async function marcarAlertaVentanaSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'alerta_ventana_at', ts || new Date().toISOString())
}
// Enfriamiento del aviso push de mensaje nuevo (1 por conversación cada 5 min).
export async function marcarPushSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'ultimo_push_at', ts || new Date().toISOString())
}
// Borra el enfriamiento: lo llama el envío de un HUMANO. Si ya contestaste, el
// próximo mensaje del cliente es información nueva y tiene que avisar, aunque hayan
// pasado 10 segundos desde el aviso anterior.
export async function limpiarPushSupabase(telefono) {
  return setCampoContacto(telefono, 'ultimo_push_at', null)
}
// Recordatorio de pendientes por Telegram: cuándo se avisó por última vez de este
// chat. Va en la base porque las funciones de Vercel son efímeras.
export async function marcarAvisoTelegramSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'ultimo_aviso_telegram_at', ts || new Date().toISOString())
}

/** Lookup rápido de modo IA (para el webhook), por últimos 9 dígitos. */
export async function getModoIASupabase(telefono) {
  const contactos = await getContactosSupabase()
  const t9 = soloDigitos(telefono).slice(-9)
  const c = contactos.find((x) => soloDigitos(x.telefono).slice(-9) === t9)
  return c ? c.modoIA : true // nuevo → IA
}

// ─── Mensajes ────────────────────────────────────────────────────────────────

/** Fila mensajes → shape de mapMensajeRow. */
export function toMensaje(m) {
  const tipo = m.tipo || 'texto'
  return {
    id:             m.wa_message_id || '',
    telefono:       String(m.telefono || ''),
    nombre:         m.nombre || String(m.telefono || '') || 'Sin nombre',
    tipo,
    // Filas viejas (order/unsupported/system guardadas ANTES de que wa-mensaje.js
    // derivara la etiqueta en la ingestión) llegan con `texto` vacío. Se deriva
    // ACÁ, al leer, con la MISMA función que usa la ingestión (contenidoTipoEspecial)
    // — para el resto de tipos no aporta nada (devuelve '') y no cambia nada.
    // `m.raw` no siempre está disponible: las vistas de la lista lateral no lo
    // traen y el respaldo crudo arrancó el 16-jul-2026; sin él, la función ya sabe
    // devolver una etiqueta genérica en vez de reventar o esconder el mensaje.
    mensaje:        m.texto || contenidoTipoEspecial(tipo, m.raw) || '',
    mediaUrl:       m.media_url || '',
    timestamp:      m.fecha || '',
    direccion:      m.direccion || 'ENTRANTE',
    mediaId:        m.media_id || '',
    respuestaIA:    m.respuesta_ia || '',
    imagenProducto: m.foto_ia || '',
    contextoId:     m.contexto_id || '',
    botones:        m.botones || '',   // botones interactivos que enviamos (JSON)
    referral:       m.referral || null, // datos del anuncio Click-to-WhatsApp (pauta)
    estadoEntrega:  m.estado_entrega || '', // read receipts: sent|delivered|read|failed
    // Número por el que entró/salió ESTE mensaje. La consulta ya lo traía y el
    // mapeo lo botaba. Es el respaldo del canal cuando la ficha del contacto
    // todavía no llegó (ver openConv): sin él, un chat nuevo se respondería por
    // el canal que estuviera armado antes.
    phoneId:        m.phone_id || '',
    // Estado de bandeja DE ESTA CONVERSACIÓN (teléfono + número). Solo viene de
    // `lista_bandeja`; en las demás lecturas queda '' y la pantalla usa el estado
    // por persona, igual que antes.
    //
    // Viaja pegado al mensaje a propósito: cuando el estado se leía aparte, existía
    // un instante en que la fila estaba en pantalla sin su estado, y ese instante
    // pintaba TODAS las conversaciones como pendientes.
    estadoBandeja:  m.estado_bandeja ? String(m.estado_bandeja).trim().toLowerCase() : '',
    // Base de la ventana de 24 h DE ESTE CANAL. La de la ficha del contacto mezcla
    // los dos números: decía "abierta" porque el cliente había escrito hace un rato
    // por el OTRO número, y el mensaje moría en Meta con 131047.
    ultimoEntranteCanal: m.ultimo_entrante_canal || null,
  }
}

// Read receipts: actualiza el estado de entrega de un mensaje saliente por wamid.
// Solo AVANZA (sent→delivered→read); nunca retrocede si un status llega fuera de orden.
export async function actualizarEstadoEntregaSupabase(wamid, nuevo) {
  if (!wamid || !nuevo) return { ok: false }
  // Estados "anteriores" válidos desde los que se puede pasar a `nuevo`.
  const DESDE = { sent: [], delivered: ['sent'], read: ['sent', 'delivered'], failed: ['sent'] }
  const previos = DESDE[nuevo]
  if (!previos) return { ok: false } // estado desconocido → ignorar
  const sb = getSupabase()
  let q = sb.from('mensajes').update({ estado_entrega: nuevo }).eq('wa_message_id', wamid)
  // Actualiza solo si el estado actual es null o uno estrictamente anterior (anti-retroceso).
  q = previos.length
    ? q.or(`estado_entrega.is.null,estado_entrega.in.(${previos.join(',')})`)
    : q.is('estado_entrega', null)
  const { error } = await q
  if (error) throw error
  return { ok: true }
}

// Columnas base que necesita la UI, SIN `raw` (el jsonb del webhook). La usa
// getMensajesSupabase: es la consulta del POLLING (/api/inbox-sync), que
// corre cada ~20s por cada pestaña abierta y es el 47% de la factura de
// Vercel del dueño — no se le suma medio mega de jsonb por poll. Medido:
// 539 kB extra por ventana de 3.000 mensajes con `raw` puesto.
const COLS_MSG = 'wa_message_id, telefono, nombre, tipo, texto, media_url, fecha, direccion, media_id, respuesta_ia, foto_ia, contexto_id, botones, referral, estado_entrega, phone_id'

// Con `raw`: sin él toMensaje no puede reconstruir el detalle de un order/
// unsupported viejo al leerlo (ver contenidoTipoEspecial). Solo para
// getHiloSupabase y buscarMensajesSupabase — consultas POR CONVERSACIÓN,
// baratas, no la ruta caliente del polling. getListaSupabase NO puede
// sumarlo: sale de una VISTA (ultimos_mensajes/_canal) que no lo expone, y
// cambiar esa vista es tocar la base — así que la lista lateral se queda con
// la etiqueta genérica para las filas viejas (toMensaje ya sabe hacerlo sin
// `raw`; ver tests/inbox-supabase.test.js).
const COLS_MSG_RAW = `${COLS_MSG}, raw`

// Descarta lo que NO TIENE NADA para pintar (ni texto, ni media, ni botones) →
// evita chats fantasma. Es la CUARTA vez que este filtro se come mensajes de
// verdad (antes: fotos sin caption, notas de voz sin mediaId, order/
// unsupported/system). Esta vez eran reaction/edit/revoke/contacts y hasta un
// 'texto' que llegó de verdad vacío — pero YA NO caen acá: lib/wa-mensaje.js
// (contenidoTipoEspecial) le arma un `contenido` no vacío a CUALQUIER tipo,
// conocido o no, así que pasan por el camino normal de "hay mensaje" sin que
// este filtro tenga que conocerlos uno por uno.
//
// La regla ya no es "lista de tipos que se salvan": es "todo tipo se salva,
// salvo que realmente no haya nada". Lo que sigue cayendo (y con razón):
//   (a) teléfono malformado (< 9 dígitos) — fila corrupta, no una persona.
//   (b) un tipo con media propio (imagen/video/audio/documento/sticker,
//       contenidoTipoEspecial los deja en '' a propósito) que llegó SIN
//       mediaId, SIN caption y SIN botones — ahí sí no hay absolutamente
//       nada que mostrar, ni con la etiqueta genérica.
// Cualquier otro tipo, con o sin texto, ya no puede quedar vacío: "sin texto"
// dejó de ser sinónimo de "no pasó nada".
export const esPintable = (m) =>
  soloDigitos(m.telefono).length >= 9 &&
  (String(m.mensaje).trim() || String(m.mediaUrl).trim() || String(m.mediaId).trim() || String(m.botones).trim())

/** Últimos N mensajes (equivale a getMensajes de la hoja, ya filtrado). */
export async function getMensajesSupabase(limite = 3000, canal = canalPorDefecto()) {
  const sb = getSupabase()
  let q = sb.from('mensajes').select(COLS_MSG).eq('cuenta', CUENTA)
  if (canal) q = q.eq('phone_id', canal)   // canal null → todos los números (pestaña GENERAL)
  const { data, error } = await q.order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || [])
    .reverse() // cronológico asc, como el tail de Sheets
    .map(toMensaje)
    .filter(esPintable)
}

/**
 * HISTORIAL COMPLETO de un chat (últimos `limite` mensajes de ESE teléfono).
 * Match tolerante por los últimos 9 dígitos (en la base conviven 0987… y 593987…).
 * Antes la UI armaba el hilo desde la ventana global de 3000: los chats fuera de
 * esos ~3 días salían truncados. Con esto el hilo completo se pide por chat.
 */
export async function getHiloSupabase(telefono, limite = 800, canal = canalPorDefecto()) {
  const t9 = soloDigitos(telefono).slice(-9)
  if (t9.length < 9) return []
  const sb = getSupabase()
  const { data, error } = await sb
    .from('mensajes').select(COLS_MSG_RAW).eq('cuenta', CUENTA).eq('phone_id', canal)
    .like('telefono', `%${t9}`)
    .order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || []).reverse().map(toMensaje).filter(esPintable)
}

/**
 * Empaqueta una lectura en páginas para saltar el tope de 1000 filas por
 * request de PostgREST. Es la SEGUNDA vez que este límite muerde este
 * archivo — la primera fue `getContactosSupabase`, arriba, que ya pagina
 * así. La próxima vez que se toque este archivo hay que revisar TODAS las
 * lecturas con `.limit(...)`, no asumir que la que se está mirando es la
 * única que corta en 1000.
 *
 * `fetchPage(from, to)` trae una página cruda (0-indexed, inclusive). Se
 * acumula hasta juntar `limite` filas o hasta que una página vuelva más
 * corta de lo pedido — ahí no quedan más filas que traer. Función PURA (no
 * toca Supabase) a propósito: así se puede probar el corte de páginas con un
 * `fetchPage` falso, sin red — ver tests/inbox-supabase.test.js.
 */
/**
 * Las filas de `inbox.bandeja` agrupadas por teléfono: { telefono → [filas] }.
 * Alimenta a CONTACTOS, que es la AGENDA y por eso no tiene canal propio.
 *
 * ⚠️ PAGINADO A PROPÓSITO. MANDI tiene 1.775 filas de bandeja y PostgREST corta en
 * 1.000 **ignorando un `.limit()` mayor y sin avisar**. Sin `paginarLimite` esto
 * devolvería 1.000 filas calladito y cientos de clientes quedarían sin canal — o sea,
 * el mismo bug que vinimos a arreglar, servido desde el otro lado.
 *
 * El orden es (telefono, phone_id) porque tiene que ser TOTAL: ordenar por algo
 * que empata pierde filas entre página y página.
 */
export async function getBandejasPorTelefonoSupabase() {
  const sb = getSupabase()
  const filas = await paginarLimite(async (from, to) => {
    const { data, error } = await sb
      .from('bandeja')
      .select('telefono, phone_id, estado, ultimo_entrante_at, ultimo_mensaje_at')
      .eq('cuenta', CUENTA)
      .order('telefono', { ascending: true })
      .order('phone_id', { ascending: true })
      .range(from, to)
    if (error) throw error
    return data
  })
  const mapa = new Map()
  for (const f of filas) {
    const arr = mapa.get(f.telefono)
    if (arr) arr.push(f)
    else mapa.set(f.telefono, [f])
  }
  return mapa
}

export async function paginarLimite(fetchPage, limite = Infinity, pageSize = 1000) {
  let from = 0
  const filas = []
  for (;;) {
    const restantes = limite - filas.length
    if (restantes <= 0) break
    const tope = Math.min(pageSize, restantes)
    const lote = await fetchPage(from, from + tope - 1)
    filas.push(...(lote || []))
    if (!lote || lote.length < tope) break
    from += tope
  }
  return filas
}

/**
 * Lista lateral: el ÚLTIMO mensaje de CADA conversación, sobre TODO el historial.
 * Hace que aparezcan también los chats viejos que quedaban fuera de la ventana de
 * getMensajesSupabase(3000) — el bug de "no aparece el cliente / se borraron los
 * mensajes".
 *
 * ⚠️ SON DOS VISTAS, y cuál se usa depende de la pestaña. No se pueden unificar:
 * cada una responde una pregunta distinta y las dos preguntas son legítimas.
 *
 * · Pestaña de UN NÚMERO → `ultimos_mensajes_canal`, que es DISTINCT ON (cuenta,
 *   telefono, phone_id): una fila por conversación Y POR CANAL.
 *
 *   Con `ultimos_mensajes` (una sola fila por persona, con el phone_id de su ÚLTIMO
 *   mensaje) filtrada por número, quien escribió a los dos aparecía SOLO en la
 *   pestaña del que usó más recientemente y **desaparecía de la otra**, aunque ahí
 *   tuviera cientos de mensajes. Medido el 11-ago-2026 en MANDARINA: 27 personas y
 *   2.107 mensajes invisibles así, con un caso de 1.552 mensajes de una sola
 *   persona. Es el mismo bug que IND destapó y arregló el 10-ago.
 *
 *   De regalo es ~4× más rápida (244 ms → 63 ms): con phone_id dentro de la clave
 *   del DISTINCT ON, el filtro por número baja al escaneo en vez de materializar
 *   todas las conversaciones y descartar después.
 *
 * · Pestaña GENERAL (canal null) → `ultimos_mensajes`, la de siempre. Acá se quiere
 *   JUSTO LO CONTRARIO: una sola cola con una fila por persona. Con la vista por
 *   canal, quien escribió a los dos números saldría DOS VECES en la misma columna.
 *
 * ⚠️ SEGUNDA vuelta del mismo bug del tope de 1000 filas por request de
 * PostgREST: `.limit(limite)` con limite=4000 se quedaba callado en las
 * primeras 1000 filas por `fecha`, y todo lo más viejo que eso —441
 * conversaciones en el 1024077200794372, medido el 12-ago-2026— dejaba de
 * existir para el navegador. `getContactosSupabase` ya había pisado este
 * rastrillo antes. Se pagina con `paginarLimite`, igual que ahí.
 *
 * El orden de paginación NO puede ser solo `fecha DESC`: no es una clave
 * única (dos conversaciones pueden compartir el mismo timestamp) y Postgres
 * no promete el mismo desempate entre dos requests `.range` separados — eso
 * puede repetir una fila en dos páginas y saltarse otra, que es EXACTAMENTE
 * el bug que se está arreglando. Se agrega `telefono` como desempate: es la
 * clave del DISTINCT ON de las dos vistas (única por fila, con o sin canal),
 * así que fecha+telefono es un orden total y estable entre páginas. El orden
 * final tampoco importa para la pantalla: `lib/orden-bandeja.js` reordena la
 * lista por timestamp en el cliente antes de pintarla.
 */
export async function getListaSupabase(limite = 4000, canal = canalPorDefecto()) {
  const sb = getSupabase()
  const filas = await paginarLimite(async (from, to) => {
    // SIEMPRE `ultimos_mensajes_canal`, también en GENERAL (canal = null).
    //
    // Antes GENERAL leía `ultimos_mensajes`, que colapsa a UNA fila por persona
    // quedándose con el último mensaje venga del número que venga. Para quien
    // escribió a los dos, eso ESCONDÍA una conversación entera: el 20-ago un
    // mensaje de prueba por MANDI desapareció de la bandeja porque otro entró por
    // REPUBLIC ocho segundos después.
    //
    // `ultimos_mensajes_canal` hace `DISTINCT ON (cuenta, telefono, phone_id)`, o
    // sea una fila por conversación Y POR CANAL — que es justo lo que hay que
    // mostrar. Ya estaba en producción alimentando los contadores por bandeja.
    //
    // ⚠️ LA VISTA NO SE TOCA: el inbox de IND lee `ultimos_mensajes_canal`, y
    // todavía no está migrado. `lista_bandeja` es una vista NUEVA construida
    // encima, que le pega el estado de bandeja a cada fila.
    //
    // El estado viaja CON la fila y no en una lectura aparte, y eso no es un
    // detalle de rendimiento: el primer intento traía la tabla `bandeja` entera
    // por separado, y como el mapa arranca vacío y "sin fila" significa PENDIENTE,
    // al abrir el inbox TODAS las conversaciones se pintaban pendientes hasta que
    // llegaba la respuesta. Pegado a la fila, ese instante no existe.
    let q = sb
      .from('lista_bandeja')
      // contexto_id y referral SON NECESARIOS: el último mensaje de cada chat sale de
      // acá, y sin ellos la cita del cliente y la tarjeta de pauta no se pintaban
      // justo en el mensaje más reciente (el que uno mira al probar).
      .select('wa_message_id, telefono, nombre, tipo, texto, media_url, fecha, direccion, media_id, botones, estado_entrega, contexto_id, referral, phone_id, estado_bandeja, ultimo_entrante_canal')
      .eq('cuenta', CUENTA)
    if (canal) q = q.eq('phone_id', canal)   // canal null → todos los números (pestaña GENERAL)
    const { data, error } = await q
      .order('fecha', { ascending: false })
      .order('telefono', { ascending: true })
      // ⚠️ `phone_id` HACE FALTA para que el orden sea TOTAL. Con una fila por
      // (cliente, número), `fecha + telefono` ya NO es único: el mismo cliente
      // puede tener su último mensaje de los DOS canales con la misma marca de
      // tiempo. No es teórico — pasó tres veces en agosto con el número de
      // Rodrigo (18-ago 11:53:20 y 12:03:00, 17-ago 17:31:21) y con otros dos
      // clientes.
      //
      // Sin desempate total, Postgres no promete el mismo orden entre dos
      // requests `.range()`, así que una página puede repetir una fila y saltarse
      // otra — y esa otra desaparece del inbox sin avisar. Es el rastrillo de
      // PostgREST que ya mordió TRES veces en este proyecto.
      .order('phone_id', { ascending: true })
      .range(from, to)
    if (error) throw error
    return data
  }, limite)
  return filas.map(toMensaje).filter(esPintable)
}

/** Búsqueda de texto en TODO el historial (server-side), más recientes primero. */
export async function buscarMensajesSupabase(q, limite = 300) {
  const term = String(q || '').trim()
  if (term.length < 2) return []
  const sb = getSupabase()
  const { data, error } = await sb
    .from('mensajes').select(COLS_MSG_RAW).eq('cuenta', CUENTA)
    .ilike('texto', `%${term}%`)
    .order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || []).map(toMensaje).filter(esPintable)
}

/** Un mensaje por wamid (para citas). */
export async function getMensajeByIdSupabase(id) {
  const sb = getSupabase()
  const { data } = await sb.from('mensajes').select('*').eq('wa_message_id', id).maybeSingle()
  return data ? toMensaje(data) : null
}

/**
 * Guarda un mensaje (entrante o saliente). Idempotente por wamid (ON CONFLICT).
 * Asegura la conversación y actualiza ultimo_mensaje_at.
 * @param m { id(wamid), telefono, nombre, tipo, mensaje, mediaUrl, timestamp,
 *           direccion('ENTRANTE'|'SALIENTE'), mediaId, respuestaIA, imagenProducto, contextoId, botones, referral }
 */
export async function guardarMensajeSupabase(m) {
  const sb = getSupabase()
  const tel = String(m.telefono || '')
  const convId = await getConvId(tel, m.nombre, tel)
  const fila = {
    conversacion_id: convId,
    cuenta: CUENTA,
    telefono: tel,
    nombre: m.nombre || '',
    direccion: m.direccion || 'ENTRANTE',
    tipo: m.tipo || 'texto',
    texto: m.mensaje || '',
    media_url: m.mediaUrl || null,
    media_id: m.mediaId || null,
    respuesta_ia: m.respuestaIA || null,
    foto_ia: m.imagenProducto || null,
    contexto_id: m.contextoId || null,
    botones: m.botones || null,   // requiere columna `botones` (text/jsonb) en inbox.mensajes
    referral: m.referral || null, // datos del anuncio (pauta) — columna `referral` (jsonb)
    raw: m.raw || null,           // respaldo: objeto crudo del mensaje tal cual de Meta (jsonb)
    // Canal: por QUÉ número de los nuestros entró o salió. Con dos números en la
    // misma tabla es lo único que permite separar las bandejas y saber por dónde
    // responder. Sale de value.metadata.phone_number_id del webhook.
    phone_id: m.phoneId || null,
    wa_message_id: m.id || null,
    fecha: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
  }
  // Idempotente: si el wamid ya existe, no duplica.
  const q = m.id
    ? sb.from('mensajes').upsert(fila, { onConflict: 'wa_message_id', ignoreDuplicates: true })
    : sb.from('mensajes').insert(fila)
  const { error } = await q
  if (error && !/duplicate key/i.test(error.message)) throw error
  // Refrescar ultimo_mensaje_at (cualquier dirección) y, solo si es ENTRANTE,
  // ultimo_entrante_at → base exacta de la ventana 24h y de la reactivación.
  // QUÉ se actualiza y POR QUÉ vive en `patchesDeMensaje` (lib/bandeja.js), como
  // función pura y con pruebas: es la lógica que mató 9 mensajes en agosto y no
  // podía seguir enterrada entre dos `await` donde nadie la puede ejercitar.
  //
  // Resumen: solo un ENTRANTE dice por dónde habla el cliente; un saliente dice por
  // dónde hablamos nosotros, que no sirve para decidir por dónde responder.
  const { conv: patchConv, bandeja: patchBandeja } = patchesDeMensaje(fila)
  await sb.from('conversaciones').update(patchConv).eq('conversacion_id', convId)

  // La bandeja DE ESTE CANAL: lo que permite que un cliente esté pendiente por un
  // número y atendido por el otro.
  //
  // No va envuelto en un catch mudo a propósito: si esto fallara en silencio, la
  // conversación desaparecería de su bandeja y el cliente se volvería invisible —
  // el bug más reincidente de este inbox. Que reviente y se vea.
  if (patchBandeja) await upsertBandeja(fila.telefono, fila.phone_id, patchBandeja)
  return { ok: true }
}

/**
 * Pendientes por canal: { [phone_id]: n }. Alimenta el contador de CADA pestaña,
 * incluida la que no se está mirando — que es justo la que importa: sin ese aviso
 * la otra bandeja se vuelve invisible y ahí se pierden clientes.
 *
 * ⚠️ TIENE QUE CONTAR IGUAL QUE LA LISTA, y por eso no puede leer
 * `conversaciones.phone_id` como hacía antes. Ese campo guarda el número del ÚLTIMO
 * mensaje de la persona: hay UNO por persona, no uno por canal. Mientras la lista
 * usaba la misma regla los dos coincidían por accidente; en cuanto la lista pasó a
 * `ultimos_mensajes_canal` (arriba) dejaron de coincidir, y una persona pendiente
 * que habló por los dos números quedaba VISIBLE en las dos bandejas pero CONTADA en
 * una sola. O sea un botón en 0 con un chat sin contestar debajo — exactamente lo
 * que rompe la garantía con la que se trabaja:
 *
 *   "si tengo esa bandeja vacía, he contestado a todas las personas"
 *
 * La vista `inbox.pendientes_por_canal` cuenta por el canal del MENSAJE, igual que
 * la lista. Su total suma MÁS que el número de personas pendientes, y está bien:
 * quien tiene un mensaje sin contestar en las dos bandejas debe aparecer en las dos.
 *
 * Nota: la vista solo devuelve canales con al menos un pendiente. Un número con
 * cero no sale, y la interfaz ya trata "sin entrada" como 0.
 */
export async function contarPendientesPorCanalSupabase() {
  // Agregado EN LA BASE (rpc `inbox.pendientes_bandeja`), no trayendo filas.
  //
  // ☠️ EL PRIMER INTENTO HIZO EXACTAMENTE LO CONTRARIO Y DEGRADÓ EL INBOX. Traía
  // la tabla `bandeja` entera y contaba en JavaScript; como `contarPendientesTotal`
  // llamaba a esta función, salían TRES lecturas completas de 1.642 filas por cada
  // ciclo de polling — en la ruta que ya es el 47 % del consumo de Vercel. Medido:
  // 0,7 ms de base cada una, pero 6 viajes de red extra y +142 kB por ciclo.
  // Rodrigo lo notó en el primer minuto de uso.
  //
  // Agregado acá: 0,1 ms, 2 filas, un viaje.
  //
  // ⚠️ NO se usa la vista `pendientes_por_canal` —que sería lo natural— porque LA
  // LEE EL INBOX DE IND, que sigue con el modelo viejo. Se queda intacta.
  const sb = getSupabase()
  const { data, error } = await sb.rpc('pendientes_bandeja', { p_cuenta: CUENTA })
  if (error) throw error
  const out = {}
  for (const c of data || []) {
    out[c.phone_id || 'sin-canal'] = Number(c.pendientes) || 0
  }
  return out
}

/**
 * Pendientes de la pestaña GENERAL.
 *
 * ⚠️ ESTO CAMBIÓ DE SIGNIFICADO EL 20-ago, y la regla que manda es la misma de
 * siempre: **el contador tiene que contar exactamente lo que se ve debajo.**
 *
 * Antes GENERAL mostraba una fila por PERSONA (leía `ultimos_mensajes`), así que el
 * botón contaba personas. Hoy GENERAL muestra una fila por (persona, número) — quien
 * escribió a los dos aparece DOS veces, a propósito — así que el botón cuenta FILAS.
 * Es la suma de los canales, y ahora sí es lo correcto: cada fila es una
 * conversación que alguien tiene que contestar.
 *
 * Un contador que no cuadra con lo que se ve abajo es peor que no tener contador:
 * rompe la garantía con la que se trabaja, *"si tengo esa bandeja vacía, he
 * contestado a todas las personas"*.
 */
export async function contarPendientesTotalSupabase() {
  const porCanal = await contarPendientesPorCanalSupabase()
  return Object.values(porCanal).reduce((a, n) => a + n, 0)
}

// ─── Entregas fallidas ───────────────────────────────────────────────────────

/**
 * Mensajes que NO le llegaron al cliente desde `desdeISO`, con el motivo real de
 * Meta y el otro número por el que sí se le puede escribir.
 *
 * El código del error NO está en `inbox.mensajes` (ahí solo queda 'failed'): vive
 * dentro del payload crudo del webhook. El cruce lo hace la rpc.
 */
export async function getEntregasFallidasSupabase(desdeISO) {
  const sb = getSupabase()
  const { data, error } = await sb.rpc('entregas_fallidas', {
    p_cuenta: CUENTA,
    p_desde: desdeISO,
  })
  if (error) throw error
  return data || []
}

/**
 * Marca de agua del aviso de fallidos: hasta qué momento ya se avisó.
 *
 * Vive en `inbox.app_config` para que sobreviva a los despliegues. Sin marca, la
 * primera corrida mira solo la última hora: al encender esto por primera vez no
 * tiene sentido avisar de los 14 mensajes que murieron en agosto — eso ya se sabe
 * y llenaría el aviso de historia vieja justo cuando hay que aprender a leerlo.
 */
export async function getMarcaAvisoFallidosSupabase() {
  const sb = getSupabase()
  const { data } = await sb.from('app_config').select('valor')
    .eq('clave', `ultimo_aviso_fallidos_${CUENTA}`).maybeSingle()
  return data?.valor || null
}

export async function setMarcaAvisoFallidosSupabase(iso) {
  const sb = getSupabase()
  const { error } = await sb.from('app_config')
    .upsert({ clave: `ultimo_aviso_fallidos_${CUENTA}`, valor: String(iso) }, { onConflict: 'clave' })
  if (error) throw error
  return { ok: true }
}

/**
 * Respaldo crudo (estilo histórico de Make): guarda el POST COMPLETO del webhook
 * de Meta tal cual, antes de parsear, en inbox.webhook_eventos. Best-effort:
 * nunca debe frenar el 200 a Meta; los errores se logean y se tragan.
 * @param payload el body completo del webhook (req.json())
 */
export async function guardarEventoCrudoSupabase(payload) {
  try {
    const sb = getSupabase()
    // Extrae wamids y clasifica el tipo de evento para poder buscar/filtrar luego.
    const wamids = []
    let hayMsgs = false, hayStatus = false
    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        const v = change?.value || {}
        for (const m of v?.messages || []) { hayMsgs = true; if (m?.id) wamids.push(String(m.id)) }
        if ((v?.statuses || []).length) hayStatus = true
      }
    }
    const tipo = hayMsgs && hayStatus ? 'mixto' : hayMsgs ? 'mensajes' : hayStatus ? 'statuses' : 'otro'
    const { error } = await sb.from('webhook_eventos').insert({
      cuenta: CUENTA,
      tipo_evento: tipo,
      wamids: wamids.length ? wamids : null,
      payload,
    })
    if (error) throw error
    return { ok: true }
  } catch (e) {
    console.error('[webhook_eventos] respaldo crudo falló:', e.message)
    return { ok: false }
  }
}

/** ¿Ya existe un mensaje con ese wamid? (dedup del webhook). */
export async function existeWamidSupabase(wamid) {
  if (!wamid) return false
  const sb = getSupabase()
  const { data } = await sb.from('mensajes').select('mensaje_id').eq('wa_message_id', wamid).maybeSingle()
  return Boolean(data)
}

/** Historial [{role,content}] para el bot IA (equivale a /api/conversacion). */
export async function getConversacionSupabase(telefono, limite = 40) {
  const sb = getSupabase()
  const t9 = soloDigitos(telefono).slice(-9)
  const { data, error } = await sb
    .from('mensajes').select('telefono, direccion, texto, fecha').eq('cuenta', CUENTA)
    .order('fecha', { ascending: true })
  if (error) throw error
  const delTel = (data || []).filter((m) => soloDigitos(m.telefono).slice(-9) === t9 && String(m.texto || '').trim())
  const turnos = []
  for (const m of delTel) {
    const role = String(m.direccion).toUpperCase() === 'SALIENTE' ? 'assistant' : 'user'
    if (turnos.length && turnos[turnos.length - 1].role === role) {
      turnos[turnos.length - 1].content += '\n' + m.texto
    } else {
      turnos.push({ role, content: m.texto })
    }
  }
  const recorte = turnos.slice(-limite)
  if (recorte.length && recorte[recorte.length - 1].role === 'user') recorte.pop() // el último user es el actual
  return recorte
}

// ─── Respuestas rápidas ──────────────────────────────────────────────────────

function toRespuesta(r) {
  const imgs = Array.isArray(r.imagenes) ? r.imagenes : []
  const obj = { id: r.id, text: r.texto || '', imageUrl: imgs[0] || '' }
  for (let k = 2; k <= 10; k++) obj[`imageUrl${k}`] = imgs[k - 1] || ''
  obj.botones = (Array.isArray(r.botones) ? r.botones : []).slice(0, 3)
  // Audios guardados en la respuesta (OGG/Opus): salen como NOTA DE VOZ. Van en su
  // propia columna y no dentro de `imagenes`, para que nadie tenga que adivinar
  // si esa url es una foto o una voz.
  obj.audios = (Array.isArray(r.audios) ? r.audios : []).filter(Boolean)
  // La lista ORDENADA (fotos y audios mezclados como los cargó el vendedor). Es la
  // que manda al enviar; `imagenes`/`imageUrlN` quedan de respaldo para las
  // respuestas viejas y para IND. Ver lib/adjuntos-respuesta.js.
  obj.adjuntos = Array.isArray(r.adjuntos) ? r.adjuntos : []
  return obj
}

export async function getRespuestasSupabase() {
  const sb = getSupabase()
  // Orden explicito: antes no habia ninguno y el resultado era el que Postgres
  // devolvia por casualidad, que podia cambiar solo entre recargas. El desempate
  // por fecha va DESCENDENTE para no contradecir que lo nuevo entra arriba.
  const { data, error } = await sb
    .from('respuestas_rapidas').select('*').eq('cuenta', CUENTA).eq('activo', true)
    .order('orden', { ascending: true })
    .order('fecha', { ascending: false })
  if (error) throw error
  // ⚠️ El filtro mira si hay ALGO que mandar, no solo texto.
  //
  // Antes exigía texto, y desde que una respuesta puede ser solo un audio o solo
  // fotos, eso las habría hecho desaparecer de la lista sin decir nada — el mismo
  // patrón del filtro que escondió 126 conversaciones: lo que no encaja en el
  // molde no se avisa, se borra de la vista.
  const hayAlgo = (r) => String(r.texto || '').trim()
    || (Array.isArray(r.audios)   && r.audios.filter(Boolean).length)
    || (Array.isArray(r.imagenes) && r.imagenes.filter(Boolean).length)
  return (data || []).filter(hayAlgo).map(toRespuesta)
}

function imgsFromExtras(imagenUrl, extras = {}) {
  const imgs = [imagenUrl || '']
  for (let k = 2; k <= 10; k++) imgs.push(extras[`imagenUrl${k}`] || '')
  return imgs.map((s) => String(s || '')).filter((s, i) => i === 0 || s) // conserva pos1 aunque vacía
}
/** Audios de una respuesta rápida. Se aceptan varios por si algún día hacen falta. */
/**
 * Qué se guarda de los adjuntos: la lista ORDENADA y, en paralelo, la lista vieja
 * de solo fotos.
 *
 * La doble escritura es a propósito y es la misma decisión que con
 * `conversaciones.estado`: `imagenes` la lee el inbox de IND, que todavía no sabe
 * de audios ni de orden. Dejar de escribirla lo dejaría sin las fotos.
 */
function adjuntosParaGuardar(imagenUrl, extras = {}) {
  // Si la interfaz manda la lista ordenada, manda ella.
  if (Array.isArray(extras.adjuntos) && extras.adjuntos.length) {
    const g = guardarAdjuntos(extras.adjuntos)
    return { adjuntos: g.adjuntos, imagenes: g.imagenes, audios: g.adjuntos.filter(a => a.tipo === 'audio').map(a => a.url) }
  }
  // Si no (llamador viejo), se arma desde lo de siempre y el orden es fotos y luego audios.
  const imgs = imgsFromExtras(imagenUrl, extras).filter(Boolean)
  const auds = audiosFrom(extras)
  const g = guardarAdjuntos([
    ...imgs.map(url => ({ tipo: 'imagen', url })),
    ...auds.map(url => ({ tipo: 'audio', url })),
  ])
  return { adjuntos: g.adjuntos, imagenes: imgsFromExtras(imagenUrl, extras), audios: auds }
}

function audiosFrom(extras = {}) {
  const a = Array.isArray(extras.audios) ? extras.audios : (extras.audioUrl ? [extras.audioUrl] : [])
  return a.map((s) => String(s || '').trim()).filter(Boolean)
}
function botonesFrom(extras = {}) {
  const b = Array.isArray(extras.botones) ? extras.botones : (extras.botones ? String(extras.botones).split('|') : [])
  return b.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
}

export async function addRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  const sb = getSupabase()
  const fila = {
    cuenta: CUENTA, id, texto,
    ...adjuntosParaGuardar(imagenUrl, extras),
    botones: botonesFrom(extras),
    activo: true,
  }
  // Una respuesta NUEVA entra PRIMERA: el orden menor que exista, menos uno. Puede
  // quedar negativo y da igual, solo se usa para ordenar; el primer reordenamiento
  // manual renumera desde 0.
  //
  // Si la fila YA existe no se toca el orden. Sin esta comprobacion, editar el texto
  // mandaria la respuesta arriba: corriges una tilde y se te desordena la lista.
  const { data: existe } = await sb
    .from('respuestas_rapidas').select('id')
    .eq('cuenta', CUENTA).eq('id', id).maybeSingle()
  if (!existe) {
    const { data: menor } = await sb
      .from('respuestas_rapidas').select('orden').eq('cuenta', CUENTA)
      .order('orden', { ascending: true }).limit(1).maybeSingle()
    fila.orden = (Number.isFinite(menor?.orden) ? menor.orden : 0) - 1
  }
  const { error } = await sb.from('respuestas_rapidas')
    .upsert(fila, { onConflict: 'cuenta,id' })
  if (error) throw error
  return { ok: true }
}

// Editar NO reordena. Escribe los campos de contenido y deja `orden` como estaba.
export async function editRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  const sb = getSupabase()
  // Se pide `select` sobre el propio update (no un select aparte antes) para saber
  // en el mismo viaje si la fila existia. Hace falta: la interfaz mete la respuesta
  // nueva en el estado local ANTES de que el alta termine de guardarse (alta
  // optimista), y el boton de editar ya queda activo sobre esa fila. Si el usuario
  // edita y guarda en esa ventana, este `update` no encuentra ninguna fila y, sin
  // este chequeo, seria un no-op silencioso: el alta llegaria despues con el texto
  // ORIGINAL y pisaria la correccion sin que nadie se entere.
  const { data, error } = await sb.from('respuestas_rapidas').update({
    texto,
    ...adjuntosParaGuardar(imagenUrl, extras),
    botones: botonesFrom(extras),
    activo: true,
  }).eq('cuenta', CUENTA).eq('id', id).select('id')
  if (error) throw error
  if (!data || !data.length) {
    // La fila todavia no existia: crearla es lo correcto (es lo que hacia el
    // upsert de antes) y `addRespuestaSupabase` ya calcula el `orden` de una
    // respuesta nueva (la menor menos uno). No reintroduce el problema del orden:
    // cuando la fila SI existe -el caso normal de editar- este camino no se toma.
    return addRespuestaSupabase(id, texto, imagenUrl, extras)
  }
  return { ok: true }
}
export async function deleteRespuestaSupabase(id) {
  const sb = getSupabase()
  const { error } = await sb.from('respuestas_rapidas').delete().eq('cuenta', CUENTA).eq('id', id)
  if (error) throw error
  return { ok: true }
}

/**
 * Reescribe el orden completo: `ids` en su nuevo orden -> orden = 0,1,2...
 * Se manda la lista entera (y no "intercambia estas dos") a proposito: asi no
 * quedan huecos ni empates, que es lo que volvia impredecible el orden. Con una
 * docena de filas el coste es irrelevante, y repetir la misma llamada deja lo mismo.
 */
export async function reordenarRespuestasSupabase(ids) {
  const sb = getSupabase()
  const lista = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!lista.length) return { ok: true, actualizadas: 0 }
  for (let i = 0; i < lista.length; i++) {
    const { error } = await sb.from('respuestas_rapidas')
      .update({ orden: i }).eq('cuenta', CUENTA).eq('id', lista[i])
    if (error) throw error
  }
  return { ok: true, actualizadas: lista.length }
}
