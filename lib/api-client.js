// lib/api-client.js
// Reemplaza los webhooks de Make para operaciones de lectura/escritura en Sheets.
// Make sigue siendo el que ENVÍA mensajes por WhatsApp — eso no cambia.

const META_PHONE_ID = '1024077200794372'
const META_TOKEN    = 'EAANPXTy8AtABRAy2O15NMaQRM0JEBInRaZCQEhRZAMtM6QHJOEJmH0oCeElIFpEqmeteJz3KYOzMNrjbUj67WCVYj6Uiw5ZCygxopzkP1LurwWsJGpi59PSdGxrTjPABTKdblfhJvYNT5IB3X6IY3O15crFFmKZApfNnIVlEZCY18If17SKW7vMo8GniwAF2G1AZDZD'

// ── LEER DATOS ────────────────────────────────────────────────────
// Antes: fetchSheet via URL pública de Sheets (solo lectura, sin auth)
// Ahora: /api/mensajes y /api/contactos con Service Account (lectura+escritura)

export async function fetchRows() {
  try {
    const res = await fetch('/api/mensajes')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchRows:', err)
    return []
  }
}

export async function fetchContacts() {
  try {
    const res = await fetch('/api/contactos')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error('[api-client] fetchContacts:', err)
    return []
  }
}

export async function fetchRepliesFromSheet() {
  try {
    const res = await fetch('/api/respuestas')
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

// ── RESPUESTAS RÁPIDAS ────────────────────────────────────────────
// Antes: webhooks Make separados para leer/escribir
// Ahora: /api/respuestas con Service Account

export async function writeReply(accion, reply) {
  try {
    const res = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, id: reply.id, texto: reply.text, imagenUrl: reply.imageUrl }),
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
    const fd = new FormData()
    fd.append('file', videoFile, videoFile.name || 'video.mp4')
    fd.append('messaging_product', 'whatsapp')
    const uploadRes = await fetch(
      `https://graph.facebook.com/v19.0/${META_PHONE_ID}/media`,
      { method: 'POST', headers: { Authorization: `Bearer ${META_TOKEN}` }, body: fd }
    )
    const uploadData = await uploadRes.json()
    if (!uploadData.id) throw new Error(uploadData.error?.message || 'Upload fallido')
    return postSaliente({ Telefono: telefono, Nombre: nombre, VideoMediaId: uploadData.id })
  } catch (err) {
    console.error('[api-client] sendVideo:', err)
    return { ok: false, error: err.message }
  }
}

export const isDemo = () => false
