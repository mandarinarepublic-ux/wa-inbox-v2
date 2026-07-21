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

async function patchContacto(telefono, campo, valor) {
  try {
    const res = await fetch('/api/contactos/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono, campo, valor }),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] patchContacto:', err)
    return { ok: false }
  }
}

export async function updateContact(telefono, nombre, estado, alias, forzarEstado = false, modo = null) {
  // Actualizar estado. Devolvemos SU resultado ({ ok }) para que quien llama pueda
  // detectar el fallo, avisar y revertir el cambio optimista.
  const res = await patchContacto(telefono, 'estado', estado)
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

export async function saveNotes(telefono, nombre, notas) {
  return patchContacto(telefono, 'notas', notas)
}

export async function setIdVenta(telefono, idVenta) {
  return patchContacto(telefono, 'idVenta', idVenta)
}

// ── RESPUESTAS RÁPIDAS ────────────────────────────────────────────
// Antes: webhooks Make separados para leer/escribir
// Ahora: /api/respuestas con Service Account

export async function writeReply(accion, reply) {
  try {
    const res = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accion, id: reply.id, texto: reply.text,
        imagenUrl: reply.imageUrl || '',
        imagenUrl2: reply.imageUrl2 || '', imagenUrl3: reply.imageUrl3 || '',
        imagenUrl4: reply.imageUrl4 || '', imagenUrl5: reply.imageUrl5 || '',
        imagenUrl6: reply.imageUrl6 || '', imagenUrl7: reply.imageUrl7 || '',
        imagenUrl8: reply.imageUrl8 || '', imagenUrl9: reply.imageUrl9 || '',
        imagenUrl10: reply.imageUrl10 || '',
        botones: Array.isArray(reply.botones) ? reply.botones : [],
      }),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] writeReply:', err)
    return { ok: false }
  }
}

// ── ENVIAR MENSAJES (sigue via Make — no cambia) ──────────────────

async function postSaliente(body) {
  try {
    const res = await fetch('/api/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    // Propagamos el motivo real (p. ej. Meta rechaza el formato del video) para
    // poder mostrarlo en la UI en vez de un genérico "Error al enviar".
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error || `HTTP ${res.status}` }
  } catch (e) { return { ok: false, error: e.message } }
}

export async function sendReply(telefono, nombre, mensaje) {
  return postSaliente({ Telefono: telefono, Nombre: nombre, Mensaje: mensaje })
}

export async function sendImageUrl(telefono, nombre, imageUrl) {
  return postSaliente({ Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl })
}

// Envía una foto del computador SIN depender de que Meta pueda descargarla de un
// hosting externo: sube el archivo a Meta (media id) y manda por id. `imageUrl` es
// la url permanente (Supabase Storage) que solo sirve para pintar el hilo; puede ir vacía.
export async function sendImageFile(telefono, nombre, file, imageUrl = '') {
  try {
    const fd = new FormData()
    fd.append('file', file, file.name || 'imagen.jpg')
    const uploadRes  = await fetch('/api/media/upload', { method: 'POST', body: fd })
    const uploadData = await uploadRes.json()
    if (!uploadData.id) throw new Error(uploadData.error || 'Upload fallido')
    return postSaliente({
      Telefono: telefono, Nombre: nombre,
      ImagenMediaId: uploadData.id, ImagenURL: imageUrl,
    })
  } catch (err) {
    console.error('[api-client] sendImageFile:', err)
    // Último recurso: si teníamos url pública, que el servidor intente por ahí.
    if (imageUrl) return postSaliente({ Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl })
    return { ok: false, error: err.message }
  }
}

export async function sendInteractiveButtons(telefono, nombre, body, buttons) {
  const botonesFormateados = buttons.map(b => ({
    type: 'reply', reply: { id: b.id, title: b.title }
  }))
  return postSaliente({
    Telefono: telefono, Nombre: nombre,
    TipoMensaje: 'interactive_buttons',
    Cuerpo: body,
    Botones: JSON.stringify(botonesFormateados),
  })
}

// WhatsApp Cloud API: límite duro de 16 MB para video.
const MAX_VIDEO_BYTES = 16 * 1024 * 1024

// Envía un video subiéndolo DIRECTO del navegador a Supabase Storage (esquiva el
// muro de ~4.5 MB de las funciones de Vercel) y luego se lo manda a Meta por LINK
// público. Así funciona con videos reales de celular, hasta 16 MB.
export async function sendVideo(telefono, nombre, videoFile) {
  try {
    if (videoFile.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: 'El video supera el límite de 16 MB de WhatsApp' }
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
    return postSaliente({ Telefono: telefono, Nombre: nombre, VideoURL: signed.publicUrl })
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
export async function fetchPlantillas() {
  try {
    const res = await fetch(`/api/plantillas?t=${Date.now()}`, { cache: 'no-store' })
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchPlantillas:', err)
    return { ok: false, templates: [] }
  }
}

// Envío de una PLANTILLA. Devuelve el JSON (incluye error de Meta si lo hubiera).
export async function sendTemplate(telefono, nombre, tpl) {
  try {
    const res = await fetch('/api/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
