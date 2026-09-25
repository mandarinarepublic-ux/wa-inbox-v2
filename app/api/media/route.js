import { NextResponse } from 'next/server'
import { hostPermitidoParaProxy, llevaToken } from '@/lib/fuente-media'

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
        // Un 4xx de Meta es definitivo (media_id caducado o de un número borrado):
        // 404 cacheable para que el navegador no lo vuelva a pedir en cada ciclo.
        // 502 queda solo para fallas de Meta o de red, que sí vale reintentar.
        const definitivo = metaRes.status >= 400 && metaRes.status < 500
        console.warn(`[/api/media] lookup ${id} → ${metaRes.status}`)
        return NextResponse.json(
          { error: 'media no disponible', status: metaRes.status },
          { status: definitivo ? 404 : 502, headers: definitivo ? { 'Cache-Control': 'public, max-age=86400' } : {} }
        )
      }
      const meta = await metaRes.json()
      mediaUrl = meta.url
    }

    if (!mediaUrl) {
      return NextResponse.json({ error: 'falta id o url' }, { status: 400 })
    }
    // ☠️ Sin esta lista, `?url=https://cualquier-sitio` recibía el META_TOKEN en la
    // cabecera (auditoría 25-sep). Y el token solo viaja a la API de Meta, no a su CDN.
    if (!hostPermitidoParaProxy(mediaUrl)) {
      return NextResponse.json({ error: 'host no permitido' }, { status: 400 })
    }

    const bin = await fetch(mediaUrl, llevaToken(mediaUrl) ? { headers: { Authorization: `Bearer ${META_TOKEN}` } } : {})
    if (!bin.ok) {
      const definitivo = bin.status >= 400 && bin.status < 500
      console.warn(`[/api/media] descarga → ${bin.status}`)
      return NextResponse.json(
        { error: 'media no disponible', status: bin.status },
        { status: definitivo ? 404 : 502, headers: definitivo ? { 'Cache-Control': 'public, max-age=86400' } : {} }
      )
    }

    const contentType = bin.headers.get('content-type') || 'application/octet-stream'
    const buf = Buffer.from(await bin.arrayBuffer())
    const total = buf.length

    // Soporte de Range (HTTP 206): los elementos <audio>/<video> del navegador piden
    // "Range: bytes=0-" y NECESITAN Content-Length + Accept-Ranges para reproducir/
    // buscar. Sin esto, las notas de voz de WhatsApp (audio/ogg) mostraban el
    // reproductor pero NO sonaban en Chrome/Edge/Safari de escritorio.
    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400', // cache 1 día en el navegador
    }

    const range = req.headers.get('range')
    const m = range && /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end   = m[2] ? parseInt(m[2], 10) : total - 1
      if (start >= total || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
        })
      }
      const chunk = buf.subarray(start, end + 1)
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(chunk.length),
        },
      })
    }

    return new NextResponse(buf, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    })
  } catch (err) {
    console.error('[/api/media]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
