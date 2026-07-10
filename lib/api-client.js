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
  // Actualizar estado
  await patchContacto(telefono, 'estado', estado)
  // Actualizar modo IA si viene
  if (modo !== null) await patchContacto(telefono, 'modoIA', modo)
  // Actualizar alias si cambió
  if (alias) await patchContacto(telefono, 'alias', alias)
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
    return { ok: res.ok }
  } catch { return { ok: false } }
}

export async function sendReply(telefono, nombre, mensaje) {
  return postSaliente({ Telefono: telefono, Nombre: nombre, Mensaje: mensaje })
}

export async function sendImageUrl(telefono, nombre, imageUrl) {
  return postSaliente({ Telefono: telefono, Nombre: nombre, ImagenURL: imageUrl })
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

export async function sendVideo(telefono, nombre, videoFile) {
  try {
    // Subimos el video a través de nuestra ruta de servidor (el token de Meta ya no
    // se expone en el navegador). La ruta devuelve el MediaID.
    const fd = new FormData()
    fd.append('file', videoFile, videoFile.name || 'video.mp4')
    const uploadRes = await fetch('/api/media/upload', { method: 'POST', body: fd })
    const uploadData = await uploadRes.json()
    if (!uploadData.id) throw new Error(uploadData.error || 'Upload fallido')
    return postSaliente({ Telefono: telefono, Nombre: nombre, VideoMediaId: uploadData.id })
  } catch (err) {
    console.error('[api-client] sendVideo:', err)
    return { ok: false, error: err.message }
  }
}

export const isDemo = () => false
