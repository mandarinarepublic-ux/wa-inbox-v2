import { NextResponse } from 'next/server'
import { resolverMediaId } from '@/lib/media-id'

// Resuelve VARIAS urls de foto a media_id de Meta EN PARALELO.
//
// Para qué: una respuesta rápida con 5 fotos se mandaba foto por foto, y cada
// envío incluía descargar la imagen y subirla a Meta (~5-8 s). En serie eso son
// 40 segundos con el inbox bloqueado. Acá se resuelven las 5 a la vez —el tiempo
// pasa a ser el de la más lenta, no la suma— y después el cliente solo dispara
// los mensajes, que ya van por media id y salen en milisegundos.
//
// La segunda vez ni siquiera se sube nada: `resolverMediaId` responde de la caché
// (inbox.media_cache), así que toda la operación termina en un parpadeo.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const META_TOKEN = process.env.META_TOKEN || ''
const MAX_URLS = 12   // 10 de una respuesta rápida + margen

export async function POST(req) {
  try {
    if (!META_TOKEN) return NextResponse.json({ ids: {} })   // el envío caerá a Make/link

    const { urls } = await req.json()
    const lista = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean).map(String))].slice(0, MAX_URLS)
    if (!lista.length) return NextResponse.json({ ids: {} })

    const resueltas = await Promise.all(lista.map(async (url) => {
      try {
        return [url, await resolverMediaId(url)]
      } catch (e) {
        // Que una foto no se pueda pre-resolver NO cancela el resto: esa se
        // mandará por link como siempre y /api/saliente decidirá qué hacer.
        console.error('[/api/media/precache] no se pudo resolver', url, '→', e.message)
        return [url, '']
      }
    }))

    const ids = {}
    for (const [url, id] of resueltas) if (id) ids[url] = id
    return NextResponse.json({ ids })
  } catch (err) {
    console.error('[/api/media/precache]', err)
    // Nunca rompemos el envío por esto: sin ids, el cliente manda por url.
    return NextResponse.json({ ids: {} })
  }
}
