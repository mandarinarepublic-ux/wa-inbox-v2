import { NextResponse } from 'next/server'

// Proxy de medios de WhatsApp/Meta.
// Las MediaURL de Meta (lookaside.fbsbx.com / graph.facebook.com) NO son públicas:
// exigen el token en la cabecera Authorization, cosa que un <img src> no puede mandar.
// Este endpoint baja la imagen con el token (server-side) y la devuelve al navegador.
// Preferimos ?id=<MediaID> porque no caduca (resuelve una URL fresca cada vez).
export const dynamic = 'force-dynamic'

const META_TOKEN = process.env.META_TOKEN || ''
const GRAPH = 'https://graph.facebook.com/v19.0'

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const id  = searchParams.get('id')
    let mediaUrl = searchParams.get('url')

    // Con el MediaID resolvemos una URL fresca (no caduca)
    if (id) {
      const metaRes = await fetch(`${GRAPH}/${id}`, {
        headers: { Authorization: `Bearer ${META_TOKEN}` },
      })
      if (!metaRes.ok) {
        return NextResponse.json({ error: 'media lookup failed', status: metaRes.status }, { status: 502 })
      }
      const meta = await metaRes.json()
      mediaUrl = meta.url
    }

    if (!mediaUrl) {
      return NextResponse.json({ error: 'falta id o url' }, { status: 400 })
    }

    const bin = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${META_TOKEN}` } })
    if (!bin.ok) {
      return NextResponse.json({ error: 'download failed', status: bin.status }, { status: 502 })
    }

    const contentType = bin.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await bin.arrayBuffer())
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // cache 1 día en el navegador
      },
    })
  } catch (err) {
    console.error('[/api/media]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
