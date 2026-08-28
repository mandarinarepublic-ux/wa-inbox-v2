import { CANALES, CANAL_POR_DEFECTO, phoneIdDeCanal } from './canales.js'

// ── Canal activo (qué número se está atendiendo) ─────────────────────────────
// Vive a nivel de módulo a propósito: hay una decena de puntos de envío y de
// lectura, y pasar el canal por parámetro en todos era invitar a que alguno se
// olvidara y mandara por el número equivocado. La App lo fija al cambiar de
// bandeja y todo lo de abajo lo usa solo.
let CANAL_ACTIVO = phoneIdDeCanal(CANAL_POR_DEFECTO)
// La última versión que vio ESTA pestaña, por bandeja ('todos' o un phone_id).
const ETAGS = {}

export function setCanalActivo(id) {
  CANAL_ACTIVO = phoneIdDeCanal(id)
  // ☠️ Se olvidan TODAS las versiones. Cambiar de bandeja VACÍA la pantalla
  // (`setConvs([])` en App.jsx) y recarga; si el servidor contestara 304 porque
  // nada cambió desde la última vez que vimos esa bandeja, no habría nada que
  // conservar y el inbox quedaría EN BLANCO. Se limpian todas y no solo la
  // nueva porque acá la clave puede ser 'todos' (GENERAL), que no corresponde
  // al `id` que llega por parámetro.
  for (const k of Object.keys(ETAGS)) delete ETAGS[k]
}
export function getCanalActivo() { return CANAL_ACTIVO }
export { CANALES }
// lib/api-client.js
// Reemplaza los webhooks de Make para operaciones de lectura/escritura en Sheets.
// Make sigue siendo el que ENVÍA mensajes por WhatsApp — eso no cambia.

// El token de Meta YA NO vive aquí (este archivo se empaqueta en el navegador).
// La subida de video ahora pasa por /api/media/upload, que usa META_TOKEN
// server-side. Ver sendVideo() más abajo.

// ── LEER DATOS ────────────────────────────────────────────────────
// Antes: fetchSheet via URL pública de Sheets (solo lectura, sin auth)
// Ahora: /api/mensajes y /api/contactos con Service Account (lectura+escritura)

export async function fetchRows() {
  try {
    const res = await fetch(`/api/mensajes?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchRows:', err)
    return null
  }
}

// Lista lateral: último mensaje de CADA conversación sobre TODO el historial
// (no la ventana de 3000). Hace que aparezcan también los chats viejos.
export async function fetchLista() {
  try {
    const res = await fetch(`/api/lista?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchLista:', err)
    return null
  }
}

// Historial COMPLETO de un chat (al abrirlo). Evita el hilo truncado.
export async function fetchHilo(telefono, limite = 800, canal = '') {
  try {
    // `canal` explícito GANA sobre el del módulo, igual que en los envíos: el hilo
    // que se pide es el de la CONVERSACIÓN que se está abriendo, no el de la
    // pestaña. En GENERAL conviven los dos números y `CANAL_ACTIVO` es un valor
    // suelto del módulo que puede haber cambiado entre el clic y esta llamada.
    const c = canal || CANAL_ACTIVO
    const res = await fetch(`/api/hilo?phone=${encodeURIComponent(telefono)}&limite=${limite}&canal=${c}&t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchHilo:', err)
    return null
  }
}

// Búsqueda de texto en TODO el historial (server-side).
export async function buscarEnMensajes(q) {
  try {
    const res = await fetch(`/api/buscar?q=${encodeURIComponent(q)}&t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] buscarEnMensajes:', err)
    return []
  }
}

export async function fetchContacts() {
  try {
    const res = await fetch(`/api/contactos?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchContacts:', err)
    return null
  }
}

// Sync unificado: UN request por ciclo de polling (antes 3: lista+mensajes+contactos).
// SIN cache-buster ni no-store → deja que el edge (s-maxage) sirva una respuesta
// compartida entre pestañas. null en error → App.load() conserva lo previo.
export async function fetchInboxSync(todosLosCanales = false) {
  try {
    // La COLUMNA se pide sin filtro en la pestaña GENERAL. CANAL_ACTIVO NO sirve
    // para decidirlo: en GENERAL siempre hay uno armado (el del chat abierto,
    // Tarea 3) y la columna igual tiene que traer los dos números. El literal
    // 'todos' viaja explícito porque un `canal=` vacío lo lee la ruta como "sin
    // parámetro" y devolvería solo el número principal.
    // Red de seguridad: si CANAL_ACTIVO llegara nulo (no debería, ver el
    // arranque del módulo más arriba), pedir 'todos' es mejor que mandar la
    // URL con `canal=null` literal — la ruta lo tomaría como filtro real y la
    // columna quedaría vacía en vez de mostrar los dos números.
    const canal = (todosLosCanales || !CANAL_ACTIVO) ? 'todos' : CANAL_ACTIVO
    // ⚠️ La versión va por QUERY y vuelve en el CUERPO. Si nada cambió el
    // servidor contesta 304 sin cuerpo y acá se devuelve `{ sinCambios: true }`:
    // App.load() hace `sync?.lista ?? null`, así que eso conserva lo que ya está
    // en pantalla sin una línea extra allá. Medido: el 92% de los ciclos de
    // MANDI no trae nada nuevo.
    const v = ETAGS[canal] ? `&v=${encodeURIComponent(ETAGS[canal])}` : ''
    const res = await fetch(`/api/inbox-sync?canal=${canal}${v}`, { cache: 'no-store' })
    if (res.status === 304) return { sinCambios: true }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()   // { lista, rows, contactos, pendientes, v }
    if (data && data.v) ETAGS[canal] = data.v
    return data
  } catch (err) {
    console.error('[api-client] fetchInboxSync:', err)
    return null
  }
}

// Catálogo de la pestaña TIENDA. fuente='shopify' (online) | 'sucursal' (inventario físico).
// Sin `q` trae todo; el buscador filtra en el cliente.
export async function fetchProductos(q = '', fuente = 'shopify') {
  try {
    const params = new URLSearchParams()
    if (fuente && fuente !== 'shopify') params.set('fuente', fuente)
    if (q) params.set('q', q)
    const qs = params.toString()
    const res = await fetch(`/api/tienda${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    return d.products || []
  } catch (err) {
    console.error('[api-client] fetchProductos:', err)
    return []
  }
}

export async function fetchRepliesFromSheet() {
  try {
    const res = await fetch(`/api/respuestas?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchReplies:', err)
    return []
  }
}

// ── ACTUALIZAR CONTACTO ───────────────────────────────────────────
// Antes: POST a webhook Make → Make actualizaba Sheets
// Ahora: PATCH /api/contactos/estado → Service Account actualiza Sheets directo

async function patchContacto(telefono, campo, valor, phoneId = '') {
  try {
    const res = await fetch('/api/contactos/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // `phoneId` solo viaja para el campo 'estado': es el único que es de la
      // CONVERSACIÓN (uno por número). Nombre, alias, temperatura, notas y modo IA
      // son de la PERSONA y siguen siendo uno solo — mandarles un canal daría a
      // entender que el mismo cliente puede estar caliente por un número y frío
      // por el otro, que no es como se trabaja.
      body: JSON.stringify({ telefono, campo, valor, ...(phoneId ? { phoneId } : {}) }),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] patchContacto:', err)
    return { ok: false }
  }
}

export async function updateContact(telefono, nombre, estado, alias, forzarEstado = false, modo = null, phoneId = '') {
  // Actualizar estado. Devolvemos SU resultado ({ ok }) para que quien llama pueda
  // detectar el fallo, avisar y revertir el cambio optimista.
  //
  // `phoneId` = en qué CONVERSACIÓN se marca. Sin él se escribe solo el estado
  // viejo (uno por persona) y marcar atendido por un número apaga también la
  // conversación del otro — el agujero por el que se pierde un cliente que
  // escribió a los dos. Quien llama debe pasar el canal del chat abierto; si no
  // lo tiene, el comportamiento es el de antes y no rompe nada.
  const res = await patchContacto(telefono, 'estado', estado, phoneId || CANAL_ACTIVO)
  // Actualizar modo IA si viene
  if (modo !== null) await patchContacto(telefono, 'modoIA', modo)
  // Actualizar alias si cambió
  if (alias) await patchContacto(telefono, 'alias', alias)
  return res
}

// Eje 2: temperatura del lead (manual). '' / null limpia la clasificación.
export async function updateTemperatura(telefono, temperatura) {
  return patchContacto(telefono, 'temperatura', temperatura || '')
}

export async function toggleIAMode(telefono, nombre, estado, alias, modoIA) {
  return patchContacto(telefono, 'modoIA', modoIA ? 'IA' : 'HUMANO')
}

// ── NOTAS ─────────────────────────────────────────────────────────
// Varias notas por chat, cada una con su fecha (antes era una sola que se
// pisaba entera). Viven en su propia tabla, no en la columna del contacto.

export async function fetchNotas(telefono) {
  const r = await fetch(`/api/notas?telefono=${encodeURIComponent(telefono)}`, { cache: 'no-store' })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'No se pudieron leer las notas')
  return d.notas || []
}

export async function addNota(telefono, texto) {
  const r = await fetch('/api/notas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefono, texto }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'No se pudo guardar la nota')
  return d.nota
}

export async function editNota(id, texto) {
  const r = await fetch('/api/notas', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, texto }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'No se pudo editar la nota')
  return d.nota
}

export async function deleteNota(id) {
  const r = await fetch(`/api/notas?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'No se pudo borrar la nota')
  return d
}

export async function setIdVenta(telefono, idVenta) {
  return patchContacto(telefono, 'idVenta', idVenta)
}

// ── LINK PAGO (panel Ventas) ─────────────────────────────────────
// Genera el link dLocal y el texto listo para copiar. NO manda nada al chat:
// eso lo decide el vendedor con el botón Copiar.
export async function generarLinkPago(telefono, monto) {
  const r = await fetch('/api/linkpago', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefono, monto }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.ok) throw new Error(d.error || 'No se pudo generar el link de pago')
  return d // { ok, link, texto }
}

// ── RESPUESTAS RÁPIDAS ────────────────────────────────────────────
// Antes: webhooks Make separados para leer/escribir
// Ahora: /api/respuestas con Service Account

/**
 * El cuerpo que se manda a guardar una respuesta rápida.
 *
 * ☠️ ESTÁ APARTE Y PROBADO PORQUE ACÁ SE PERDIÓ EL AUDIO. Este objeto enumera los
 * campos A MANO, y cuando se agregaron los adjuntos ordenados nadie sumó
 * `adjuntos` a la lista: el editor lo guardaba bien, la base lo aceptaba bien, y
 * el campo moría en este intermediario. Rodrigo armó su respuesta con audio, la
 * guardó sin ningún error, y el audio no llegó a existir.
 *
 * Cualquier campo NUEVO de una respuesta rápida tiene que sumarse acá o pasa lo
 * mismo, en silencio. Por eso hay una prueba que lo vigila.
 */
export function cuerpoDeRespuesta(accion, reply = {}) {
  return {
    accion, id: reply.id, texto: reply.text,
    imagenUrl: reply.imageUrl || '',
    imagenUrl2: reply.imageUrl2 || '', imagenUrl3: reply.imageUrl3 || '',
    imagenUrl4: reply.imageUrl4 || '', imagenUrl5: reply.imageUrl5 || '',
    imagenUrl6: reply.imageUrl6 || '', imagenUrl7: reply.imageUrl7 || '',
    imagenUrl8: reply.imageUrl8 || '', imagenUrl9: reply.imageUrl9 || '',
    imagenUrl10: reply.imageUrl10 || '',
    // La lista ORDENADA (fotos y audios). Es la que lleva las notas de voz y el
    // orden en que el cliente los ve.
    adjuntos: Array.isArray(reply.adjuntos) ? reply.adjuntos : [],
    botones: Array.isArray(reply.botones) ? reply.botones : [],
  }
}

export async function writeReply(accion, reply) {
  try {
    const res = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoDeRespuesta(accion, reply)),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] writeReply:', err)
    return { ok: false }
  }
}

/** Guarda el orden completo de las respuestas rapidas. `ids` en su nuevo orden. */
export async function reorderReplies(ids) {
  try {
    const res = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'reordenar', ids }),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] reorderReplies:', err)
    return { ok: false }
  }
}

// ── ENVIAR MENSAJES (sigue via Make — no cambia) ──────────────────

// El `Canal` explícito GANA sobre el del módulo. Motivo: las tandas de envío
// (una respuesta rápida de 5-10 fotos, un bucle de archivos) tardan segundos, y
// mientras salen el vendedor hace lo normal en GENERAL: clic en el siguiente
// chat. Ese clic mueve `CANAL_ACTIVO` al canal del chat nuevo, así que lo que
// faltaba de la tanda salía por el otro número. Quien envía congela el canal al
// ENCOLAR y lo pasa hasta acá; `CANAL_ACTIVO` queda de respaldo para los
// llamadores que no lo pasan (Contactos, plantillas), sin cambiarles nada.
//
// ⚠️ NO se arregla guardando y restaurando `CANAL_ACTIVO` alrededor de la tanda:
// las colas de chats distintos corren concurrentes a propósito y se pisarían
// entre ellas.
async function postSaliente(body) {
  try {
    const res = await fetch('/api/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, Canal: body.Canal || CANAL_ACTIVO }),
    })
    // Se devuelve el cuerpo para no perder avisos del servidor (p. ej. `citaOmitida`:
    // el mensaje salió pero sin la cita porque Meta la rechazó).
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: true, ...data }
    }
    // Propagamos el motivo real (p. ej. Meta rechaza el formato del video) para
    // poder mostrarlo en la UI en vez de un genérico "Error al enviar".
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error || `HTTP ${res.status}` }
  } catch (e) { return { ok: false, error: e.message } }
}

// `contextoId` opcional: wamid del mensaje que se está citando (responder a…).
// `canal` opcional: phone_id congelado al encolar (ver postSaliente). Vacío =
// se usa el canal activo del módulo.
export async function sendReply(telefono, nombre, mensaje, contextoId = '', canal = '') {
  return postSaliente({
    Telefono: telefono, Nombre: nombre, Mensaje: mensaje,
    ...(contextoId ? { ContextoId: contextoId } : {}),
    ...(canal ? { Canal: canal } : {}),
  })
}

// `mediaId` opcional: si ya lo tenemos pre-resuelto (ver precacheMedia), el envío
// se salta la descarga + subida a Meta y sale en milisegundos. `imageUrl` viaja
// igual para pintar la foto en el hilo.
// `contextoId` opcional y SIEMPRE al final: la cita va solo en la primera pieza
// de un envio (ver lib/cita.js). Meta acepta `context.message_id` en cualquier tipo.
export async function sendImageUrl(telefono, nombre, imageUrl, mediaId = '', canal = '', contextoId = '') {
  return postSaliente({
    Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl,
    ...(mediaId ? { ImagenMediaId: mediaId } : {}),
    ...(canal ? { Canal: canal } : {}),
    ...(contextoId ? { ContextoId: contextoId } : {}),
  })
}

/**
 * Pre-resuelve varias fotos a media_id de Meta, todas en paralelo y de una sola
 * llamada. Devuelve { url: mediaId }; las que no se pudieron resolver no vienen y
 * se mandan por url como siempre. Nunca lanza: es una optimización, no un paso
 * obligatorio del envío.
 *
 * ⚠️ El `canal` importa aunque esto sea "solo una optimización": un media_id de
 * Meta pertenece al phone_id que lo subió y NO sirve para el otro número. Si
 * esto se resolviera con el canal de la pestaña a la que el vendedor acaba de
 * saltar, los ids precacheados no valdrían para la tanda que todavía está
 * saliendo.
 */
export async function precacheMedia(urls, canal = '') {
  const lista = (urls || []).filter(Boolean)
  if (!lista.length) return {}
  try {
    const res  = await fetch('/api/media/precache', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: lista, canal: canal || CANAL_ACTIVO }),
    })
    const data = await res.json().catch(() => ({}))
    return data?.ids || {}
  } catch (err) {
    console.error('[api-client] precacheMedia:', err)
    return {}
  }
}

// Envía una foto del computador SIN depender de que Meta pueda descargarla de un
// hosting externo: sube el archivo a Meta (media id) y manda por id. `imageUrl` es
// la url permanente (Supabase Storage) que solo sirve para pintar el hilo; puede ir vacía.
export async function sendImageFile(telefono, nombre, file, imageUrl = '', canal = '') {
  try {
    const fd = new FormData()
    fd.append('file', file, file.name || 'imagen.jpg')
    const uploadRes  = await fetch('/api/media/upload', { method: 'POST', body: fd })
    const uploadData = await uploadRes.json()
    if (!uploadData.id) throw new Error(uploadData.error || 'Upload fallido')
    return postSaliente({
      Telefono: telefono, Nombre: nombre,
      ImagenMediaId: uploadData.id, ImagenURL: imageUrl,
      ...(canal ? { Canal: canal } : {}),
    })
  } catch (err) {
    console.error('[api-client] sendImageFile:', err)
    // Último recurso: si teníamos url pública, que el servidor intente por ahí.
    // El canal congelado viaja también acá: el respaldo no puede salir por otro
    // número que el envío que acaba de fallar.
    if (imageUrl) return postSaliente({ Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl, ...(canal ? { Canal: canal } : {}) })
    return { ok: false, error: err.message }
  }
}

export async function sendInteractiveButtons(telefono, nombre, body, buttons, canal = '', contextoId = '') {
  const botonesFormateados = buttons.map(b => ({
    type: 'reply', reply: { id: b.id, title: b.title }
  }))
  return postSaliente({
    Telefono: telefono, Nombre: nombre,
    TipoMensaje: 'interactive_buttons',
    Cuerpo: body,
    Botones: JSON.stringify(botonesFormateados),
    ...(canal ? { Canal: canal } : {}),
    ...(contextoId ? { ContextoId: contextoId } : {}),
  })
}

// WhatsApp Cloud API: límite duro de 16 MB para video.
const MAX_VIDEO_BYTES = 16 * 1024 * 1024
// El tope del documento NO lo pone WhatsApp (permite 100 MB) sino el bucket
// inbox-media, que corta en 25 MB. Mismo numero que /api/upload-url.
const MAX_DOC_BYTES = 25 * 1024 * 1024

// Detecta el códec de video leyendo el fourcc del contenedor MP4/MOV.
// WhatsApp SOLO acepta H.264 ('avc1'); si el video es HEVC/H.265 ('hvc1'/'hev1')
// Meta lo acepta y luego lo marca failed (error 131053). iPhone y muchos Android
// graban en HEVC por defecto, así que lo detectamos ANTES de enviar para avisar.
// Devuelve 'hevc' | 'h264' | 'unknown' (unknown = dejamos pasar, mejor intentar).
async function sniffVideoCodec(file) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const has = (sig) => {
      const first = sig.charCodeAt(0)
      for (let i = 0; i + 4 <= buf.length; i++) {
        if (buf[i] !== first) continue
        if (buf[i+1] === sig.charCodeAt(1) && buf[i+2] === sig.charCodeAt(2) && buf[i+3] === sig.charCodeAt(3)) return true
      }
      return false
    }
    if (has('hvc1') || has('hev1')) return 'hevc'
    if (has('avc1') || has('avc3')) return 'h264'
    return 'unknown'
  } catch { return 'unknown' }
}

// Envía un video subiéndolo DIRECTO del navegador a Supabase Storage (esquiva el
// muro de ~4.5 MB de las funciones de Vercel) y luego se lo manda a Meta por LINK
// público. Así funciona con videos reales de celular, hasta 16 MB.
/**
 * Manda un audio como NOTA DE VOZ (la burbuja del micrófono con las ondas).
 *
 * Convierte antes de subir: Meta solo pinta la nota de voz si el archivo es
 * OGG/Opus, y Fish Audio —de donde salen estos audios— exporta MP3. Sin la
 * conversión llegaría como archivo adjunto: suena igual pero se ve como un envío
 * masivo en vez de una persona hablándote, que es justo lo contrario de para lo
 * que se manda la voz de la marca.
 *
 * Si la conversión falla NO manda el original a escondidas. Devuelve el error y
 * quien llama decide, porque mandar un adjunto cuando se pidió una nota de voz es
 * exactamente el patrón de "la pantalla miente" que este inbox viene arrastrando.
 *
 * El codificador (385 KB) se carga SOLO acá, la primera vez que alguien manda un
 * audio: quien nunca use esto no paga nada al abrir el inbox.
 */
/**
 * Convierte un audio a nota de voz (si hace falta), lo sube y devuelve su url.
 *
 * Está separado del envío porque los dos caminos lo necesitan: mandarlo al toque
 * en un chat, y GUARDARLO en una respuesta rápida. En el segundo caso la
 * conversión ocurre UNA sola vez —al guardar la respuesta— y de ahí en adelante
 * usarla solo manda el link, sin cargar el codificador ni hacer esperar a nadie.
 */
export async function subirAudioNota(audioFile, { onProgreso } = {}) {
  if (audioFile.size > MAX_VIDEO_BYTES) {
    throw new Error('El audio supera el límite de 16 MB de WhatsApp')
  }
  const { necesitaConversion, convertirANotaDeVoz } = await import('./audio-nota-voz.js')

  let archivo = audioFile
  let contentType = audioFile.type || 'audio/ogg'
  if (necesitaConversion(audioFile)) {
    try {
      archivo = await convertirANotaDeVoz(audioFile, { onProgreso })
      contentType = 'audio/ogg'
    } catch (e) {
      throw new Error(`No se pudo convertir el audio a nota de voz: ${e.message}`)
    }
  }

  // Mismo camino que el video: URL firmada, subida DIRECTA a Supabase (sin el
  // muro de 4,5 MB de Vercel) y Meta baja el archivo del link.
  const signed = await (await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, size: archivo.size }),
  })).json()
  if (!signed.uploadUrl) throw new Error(signed.error || 'No se pudo preparar la subida')

  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', archivo, 'nota.ogg')
  const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: form })
  if (!put.ok) {
    const detalle = await put.text().catch(() => '')
    throw new Error(`No se pudo subir el audio (HTTP ${put.status}) ${detalle.slice(0, 140)}`.trim())
  }
  return signed.publicUrl
}

export async function sendAudio(telefono, nombre, audioFile, canal = '', { onProgreso } = {}) {
  try {
    const url = await subirAudioNota(audioFile, { onProgreso })
    return postSaliente({ Telefono: telefono, Nombre: nombre, AudioURL: url, ...(canal ? { Canal: canal } : {}) })
  } catch (err) {
    console.error('[api-client] sendAudio:', err)
    return { ok: false, error: err.message || 'No se pudo enviar el audio' }
  }
}

/**
 * Manda un audio que YA está subido y en OGG/Opus, por su link.
 *
 * Lo usan las respuestas rápidas: ahí el audio se convirtió UNA sola vez, al
 * guardar la respuesta, y de ahí en adelante solo se manda la url. Por eso sale
 * tan rápido como una foto cacheada, sin cargar el codificador ni hacer esperar
 * al vendedor cada vez que usa la misma respuesta.
 */
export async function enviarAudioUrl(telefono, nombre, audioUrl, canal = '', contextoId = '') {
  return postSaliente({
    Telefono: telefono, Nombre: nombre, AudioURL: audioUrl,
    ...(canal ? { Canal: canal } : {}),
    ...(contextoId ? { ContextoId: contextoId } : {}),
  })
}

/**
 * Mandar un documento YA SUBIDO, por link. Es a `sendDocumento` lo que
 * `enviarAudioUrl` es a `sendAudio`: lo usan las respuestas rapidas, donde el
 * archivo se subio una sola vez al guardar la respuesta.
 *
 * ⚠️ `nombreArchivo` viene guardado en el adjunto. Si faltara —una respuesta
 * guardada antes de que existiera el campo— se manda "documento" en vez del
 * uuid del bucket, que es lo que veria el cliente.
 */
/**
 * Subir un documento al bucket y devolver su url publica, SIN enviarlo.
 * Lo usa el editor de respuestas rapidas: el archivo se sube una sola vez, al
 * guardar, y despues cada envio solo manda el link.
 */
export async function subirDocumento(file) {
  const nombreArchivo = String(file?.name || '').trim() || 'documento'
  const contentType = file?.type || 'application/octet-stream'

  const signed = await (await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, size: file?.size || 0, filename: nombreArchivo }),
  })).json()
  if (!signed.uploadUrl) throw new Error(signed.error || 'No se pudo preparar la subida')

  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', file, nombreArchivo)
  const put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: form })
  // ⚠️ res.ok: sin esto un rechazo del bucket devolveria una url que no existe y
  // la respuesta rapida quedaria guardada apuntando a la nada.
  if (!put.ok) {
    const detalle = await put.text().catch(() => '')
    throw new Error(`No se pudo subir el documento (HTTP ${put.status}) ${detalle.slice(0, 140)}`.trim())
  }
  return { url: signed.publicUrl, nombre: nombreArchivo }
}

export async function enviarDocumentoUrl(telefono, nombre, docUrl, nombreArchivo = '', canal = '', contextoId = '') {
  return postSaliente({
    Telefono: telefono, Nombre: nombre,
    DocURL: docUrl,
    DocNombre: String(nombreArchivo || '').trim() || 'documento',
    ...(canal ? { Canal: canal } : {}),
    ...(contextoId ? { ContextoId: contextoId } : {}),
  })
}

/**
 * Mandar un DOCUMENTO (pdf, docx, xlsx, dwg, zip... lo que sea).
 *
 * Mismo camino que sendVideo: se pide una URL firmada, el archivo sube DIRECTO a
 * Supabase (no pasa por Vercel, que corta el body en ~4,5 MB) y Meta lo descarga
 * del link publico.
 *
 * Diferencias con el video:
 *  - Se manda `DocNombre`: es el nombre que ve el cliente. Sin el, WhatsApp
 *    muestra el uuid del archivo.
 *  - Se manda `DocCaption`: el documento SI acepta texto pegado (el audio no),
 *    asi que el mensaje del vendedor viaja con el archivo en vez de aparte.
 *  - Se pasa `canal`: el documento tiene que salir por el MISMO numero al que
 *    el cliente escribio. Sin eso Meta lo rechaza con 131047 si la ventana de
 *    ese otro numero esta cerrada — el bug que se arreglo el 21-ago.
 */
export async function sendDocumento(telefono, nombre, docFile, caption = '', canal = '') {
  try {
    if (docFile.size > MAX_DOC_BYTES) {
      const mb = Math.round(MAX_DOC_BYTES / (1024 * 1024))
      return { ok: false, error: `El documento pesa ${(docFile.size / (1024 * 1024)).toFixed(1)} MB y el límite es ${mb} MB` }
    }
    const nombreArchivo = String(docFile.name || '').trim() || 'documento'
    // Si el navegador no supo el tipo, se manda uno generico: el bucket lo acepta
    // y WhatsApp no lo necesita para un documento.
    const contentType = docFile.type || 'application/octet-stream'

    const signed = await (await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `filename` es lo que /api/upload-url usa para la extension del archivo
      // guardado; el nombre que ve el cliente viaja aparte, en DocNombre.
      body: JSON.stringify({ contentType, size: docFile.size, filename: nombreArchivo }),
    })).json()
    if (!signed.uploadUrl) throw new Error(signed.error || 'No se pudo preparar la subida')

    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', docFile, nombreArchivo)
    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'x-upsert': 'true' },
      body: form,
    })
    // ⚠️ Mirar res.ok: fetch NO lanza con 4xx/5xx. Sin esto, un rechazo del bucket
    // seguiria de largo y se mandaria a Meta un link que no existe.
    if (!put.ok) {
      const detalle = await put.text().catch(() => '')
      throw new Error(`No se pudo subir el documento (HTTP ${put.status}) ${detalle.slice(0, 140)}`.trim())
    }

    return postSaliente({
      Telefono: telefono,
      Nombre: nombre,
      DocURL: signed.publicUrl,
      DocNombre: nombreArchivo,
      DocCaption: String(caption || '').trim(),
      ...(canal ? { Canal: canal } : {}),
    })
  } catch (err) {
    console.error('[api-client] sendDocumento:', err)
    return { ok: false, error: err.message }
  }
}

export async function sendVideo(telefono, nombre, videoFile, canal = '') {
  try {
    if (videoFile.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: 'El video supera el límite de 16 MB de WhatsApp' }
    }
    // WhatsApp solo acepta H.264. Si es HEVC/H.265 avisamos ANTES de enviar
    // (si no, Meta lo acepta y lo marca failed después, sin que se note el motivo).
    if (await sniffVideoCodec(videoFile) === 'hevc') {
      return { ok: false, error: 'Video en formato HEVC/H.265: WhatsApp no lo acepta. Convertilo a MP4 (H.264) y reenvialo.' }
    }
    const contentType = videoFile.type || 'video/mp4'

    // 1) Pedimos al servidor una URL firmada de subida (request chico: NO sube el
    //    archivo por Vercel, solo pide el permiso).
    const signed = await (await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, size: videoFile.size }),
    })).json()
    if (!signed.uploadUrl) throw new Error(signed.error || 'No se pudo preparar la subida')

    // 2) Subimos el archivo DIRECTO a Supabase por la URL firmada. Replicamos el
    //    formato que usa el SDK de Supabase: PUT multipart con el archivo en el
    //    campo vacío ('') + cacheControl.
    const form = new FormData()
    form.append('cacheControl', '3600')
    form.append('', videoFile, videoFile.name || 'video.mp4')
    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'x-upsert': 'true' },
      body: form,
    })
    if (!put.ok) {
      const detalle = await put.text().catch(() => '')
      throw new Error(`No se pudo subir el video (HTTP ${put.status}) ${detalle.slice(0, 140)}`.trim())
    }

    // 3) Enviamos a Meta por link público (Meta descarga el video de Supabase).
    return postSaliente({ Telefono: telefono, Nombre: nombre, VideoURL: signed.publicUrl, ...(canal ? { Canal: canal } : {}) })
  } catch (err) {
    console.error('[api-client] sendVideo:', err)
    return { ok: false, error: err.message }
  }
}

// ── CONTACTOS (directorio) + PLANTILLAS + AUTOMATIZACIONES ────────

// Lista de contactos con marca dentro/fuera de la ventana de 24h.
export async function fetchDirectorio() {
  try {
    const res = await fetch(`/api/directorio?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchDirectorio:', err)
    return { ok: false, contactos: [] }
  }
}

// Plantillas aprobadas de la WABA (para escribir fuera de 24h).
// Va con `canal` porque cada número está en una WABA distinta y las plantillas
// son de la WABA: sin esto, en REPUBLIC se listaban las de MANDI y el envío
// moría con (#132001).
export async function fetchPlantillas() {
  try {
    const res = await fetch(`/api/plantillas?canal=${CANAL_ACTIVO}&t=${Date.now()}`, { cache: 'no-store' })
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchPlantillas:', err)
    return { ok: false, templates: [] }
  }
}

// Envío de una PLANTILLA. Devuelve el JSON (incluye error de Meta si lo hubiera).
export async function sendTemplate(telefono, nombre, tpl, canal = '') {
  try {
    const res = await fetch('/api/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Igual que en postSaliente: sin esto la plantilla sale por el número
        // principal aunque estés en la bandeja del otro.
        // Una plantilla al numero equivocado muere igual que un texto libre.
        Canal: canal || CANAL_ACTIVO,
        Telefono: telefono, Nombre: nombre || '',
        TipoMensaje: 'template',
        TemplateName: tpl.name,
        TemplateLang: tpl.language,
        TemplateBodyParams: JSON.stringify(tpl.bodyParams || []),
        TemplateHeaderParams: JSON.stringify(tpl.headerParams || []),
        TemplateHeaderImage: tpl.headerImage || '',
        TemplatePreview: tpl.preview || `📋 Plantilla: ${tpl.name}`,
      }),
    })
    return await res.json().catch(() => ({ ok: res.ok }))
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function getAutomatizaciones() {
  try {
    const res = await fetch(`/api/automatizaciones?t=${Date.now()}`, { cache: 'no-store' })
    return await res.json()
  } catch (err) {
    console.error('[api-client] getAutomatizaciones:', err)
    return { ok: false, config: null }
  }
}

export async function saveAutomatizaciones(patch) {
  try {
    const res = await fetch('/api/automatizaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return await res.json().catch(() => ({ ok: res.ok }))
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export const isDemo = () => false
