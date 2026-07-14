// lib/media-archive.js — Archiva media ENTRANTE de WhatsApp a Supabase Storage.
//
// Al recibir una foto, Meta solo nos da un `media_id` temporal (caduca ~30 días y
// exige el token para bajarse). Este módulo baja el binario UNA vez y lo guarda en
// nuestro bucket público `inbox-media`, dejando una URL ESTABLE en
// inbox.mensajes.media_url. Desde ahí el CRM y el inbox la leen directo con un
// <img src>, sin depender de Meta y sin que la foto caduque nunca.
//
// Best-effort: nunca lanza (se llama en segundo plano). Idempotente por wamid.
import { getSupabase, CUENTA } from './supabase.js'

const META_TOKEN = process.env.META_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v19.0'
const BUCKET = 'inbox-media'

// Extensión de archivo según el MIME que devuelve Meta.
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

// wamid → nombre de archivo seguro (los wamid traen '=', '/', etc.).
const safeName = (wamid) => String(wamid || '').replace(/[^a-zA-Z0-9._-]/g, '_')

/**
 * Archiva la foto de un mensaje entrante y devuelve la URL pública (o null).
 * - Idempotente: si el mensaje ya tiene media_url, no re-baja ni re-sube.
 * - Best-effort: cualquier fallo se loguea y devuelve null (no rompe el webhook).
 * @param {{ mediaId:string, wamid:string, cuenta?:string }} args
 */
export async function archivarFoto({ mediaId, wamid, cuenta = CUENTA }) {
  try {
    if (!mediaId || !wamid) return null
    if (!META_TOKEN) { console.warn('[media-archive] sin META_TOKEN'); return null }
    const sb = getSupabase()

    // Idempotencia: si el mensaje ya tiene media_url archivada, salir.
    const { data: existente } = await sb
      .from('mensajes').select('media_url').eq('wa_message_id', wamid).maybeSingle()
    if (existente && existente.media_url) return existente.media_url

    // 1) Resolver una URL fresca del media_id (la de Meta caduca; el id no).
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${META_TOKEN}` },
    })
    if (!metaRes.ok) { console.warn('[media-archive] lookup', metaRes.status); return null }
    const meta = await metaRes.json()
    if (!meta?.url) return null

    // 2) Bajar el binario (Meta exige el token en el header).
    const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${META_TOKEN}` } })
    if (!bin.ok) { console.warn('[media-archive] download', bin.status); return null }
    const contentType = (bin.headers.get('content-type') || meta.mime_type || 'image/jpeg').split(';')[0].trim()
    const ext = EXT[contentType] || 'jpg'
    const buf = Buffer.from(await bin.arrayBuffer())

    // 3) Subir al bucket público (upsert = idempotente por path).
    const path = `${cuenta}/${safeName(wamid)}.${ext}`
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true })
    if (upErr) { console.warn('[media-archive] upload', upErr.message); return null }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = pub?.publicUrl || null
    if (!publicUrl) return null

    // 4) Escribir la URL estable en la fila del mensaje.
    const { error: updErr } = await sb
      .from('mensajes').update({ media_url: publicUrl }).eq('wa_message_id', wamid)
    if (updErr) console.warn('[media-archive] update media_url', updErr.message)

    return publicUrl
  } catch (e) {
    console.warn('[media-archive] falló:', e?.message || e)
    return null
  }
}
