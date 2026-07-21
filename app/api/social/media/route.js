import { NextResponse } from 'next/server'

// Devuelve la publicación/anuncio de Instagram sobre el que comentó el cliente,
// para que el vendedor vea A QUÉ producto se refiere. Usa el token de página.
// Estrategia: 1) media node directo; 2) fallback expandiendo el media del comentario.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v19.0'
const MEDIA_FIELDS = 'permalink,caption,media_url,thumbnail_url,media_type,timestamp'

function normaliza(m) {
  if (!m || (!m.permalink && !m.caption && !m.media_url && !m.thumbnail_url)) return null
  const esVideo = String(m.media_type || '').toUpperCase() === 'VIDEO'
  return {
    permalink: m.permalink || '',
    caption:   m.caption || '',
    image:     esVideo ? (m.thumbnail_url || '') : (m.media_url || m.thumbnail_url || ''),
    mediaType: m.media_type || '',
    timestamp: m.timestamp || '',
  }
}

async function graphGet(path, fields) {
  const res = await fetch(`${GRAPH}/${encodeURIComponent(path)}?fields=${fields}&access_token=${encodeURIComponent(FB_PAGE_TOKEN)}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && !data.error, status: res.status, data }
}

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams
    const id = sp.get('id') || ''
    const comment = sp.get('comment') || ''
    if (!id && !comment) return NextResponse.json({ error: 'falta id' }, { status: 400 })
    if (!FB_PAGE_TOKEN) { console.log('[media] SIN FB_PAGE_TOKEN'); return NextResponse.json({ error: 'sin token' }, { status: 200 }) }

    const diag = { id, comment }

    // 1) media node directo
    if (id) {
      const r = await graphGet(id, MEDIA_FIELDS)
      diag.node = r.data?.error ? r.data.error : Object.keys(r.data || {})
      const info = r.ok ? normaliza(r.data) : null
      if (info) { console.log('[media] OK node', JSON.stringify(diag)); return NextResponse.json(info) }
    }

    // 2) fallback: leer el comentario y expandir su media
    if (comment) {
      const r = await graphGet(comment, `media{${MEDIA_FIELDS}}`)
      diag.comment_res = r.data?.error ? r.data.error : Object.keys(r.data || {})
      diag.comment_media = r.data?.media ? Object.keys(r.data.media) : null
      const info = r.ok ? normaliza(r.data?.media) : null
      if (info) { console.log('[media] OK comment', JSON.stringify(diag)); return NextResponse.json(info) }
    }

    console.log('[media] NO RESUELTO', JSON.stringify(diag))
    return NextResponse.json({ error: 'no resuelto' }, { status: 200 })
  } catch (err) {
    console.error('[/api/social/media]', err)
    return NextResponse.json({ error: err.message }, { status: 200 })
  }
}
