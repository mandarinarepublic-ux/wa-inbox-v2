import { NextResponse } from 'next/server'

// Devuelve la publicación/anuncio de Instagram sobre el que comentó el cliente,
// para que el vendedor vea A QUÉ producto se refiere (el comentario suele ser un
// "precio?" suelto sin contexto). Usa el media.id que guardamos como ad_id.
// Lee de la Graph API con el token de página (mismo que usa /api/social/saliente).
export const dynamic = 'force-dynamic'
export const revalidate = 0

const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v19.0'

export async function GET(req) {
  try {
    const id = new URL(req.url).searchParams.get('id') || ''
    if (!id) return NextResponse.json({ error: 'falta id' }, { status: 400 })
    if (!FB_PAGE_TOKEN) return NextResponse.json({ error: 'sin token' }, { status: 200 })

    const fields = 'permalink,caption,media_url,thumbnail_url,media_type,timestamp'
    const res = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=${fields}&access_token=${encodeURIComponent(FB_PAGE_TOKEN)}`, {
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) {
      // Un anuncio "dark post" o media sin permiso puede no resolverse → no es fatal,
      // el chat simplemente no muestra la preview.
      return NextResponse.json({ error: data.error?.message || `HTTP ${res.status}` }, { status: 200 })
    }

    const esVideo = String(data.media_type || '').toUpperCase() === 'VIDEO'
    return NextResponse.json({
      permalink: data.permalink || '',
      caption:   data.caption || '',
      image:     esVideo ? (data.thumbnail_url || '') : (data.media_url || data.thumbnail_url || ''),
      mediaType: data.media_type || '',
      timestamp: data.timestamp || '',
    })
  } catch (err) {
    console.error('[/api/social/media]', err)
    return NextResponse.json({ error: err.message }, { status: 200 })
  }
}
