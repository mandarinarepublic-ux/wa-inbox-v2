import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'

// Genera una SIGNED UPLOAD URL de Supabase Storage para que el navegador suba el
// archivo DIRECTO a Supabase, sin pasar por esta función de Vercel.
// Motivo: las funciones de Vercel cortan el body de la request en ~4.5 MB, así que
// un video real de celular no puede subirse por /api/media/upload. Subiendo directo
// a Supabase evitamos ese muro (WhatsApp permite video hasta 16 MB) y después el
// video se envía a Meta por LINK público (bucket `inbox-media` es público).
// El token/servicio de Supabase vive SOLO server-side; al navegador solo le llega
// una URL firmada de un solo uso para un path concreto.
export const dynamic = 'force-dynamic'

const BUCKET = 'inbox-media'
// WhatsApp Cloud API: límite duro de 16 MB para video.
const MAX_BYTES = 16 * 1024 * 1024
const EXT = {
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

export async function POST(req) {
  try {
    const { contentType = '', size = 0 } = await req.json().catch(() => ({}))
    const ct = String(contentType).split(';')[0].trim().toLowerCase()

    if (!ct.startsWith('video/') && !ct.startsWith('image/')) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    }
    if (size && Number(size) > MAX_BYTES) {
      return NextResponse.json({ error: 'El archivo supera el límite de 16 MB de WhatsApp' }, { status: 413 })
    }

    const ext  = EXT[ct] || (ct.startsWith('video/') ? 'mp4' : 'jpg')
    const kind = ct.startsWith('video/') ? 'videos' : 'fotos'
    const path = `${kind}/${CUENTA}/${crypto.randomUUID()}.${ext}`

    const sb = getSupabase()
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message || 'No se pudo crear la URL de subida' }, { status: 502 })
    }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
    if (!pub?.publicUrl) {
      return NextResponse.json({ error: 'Sin URL pública' }, { status: 502 })
    }

    return NextResponse.json({ uploadUrl: data.signedUrl, token: data.token, path, publicUrl: pub.publicUrl })
  } catch (err) {
    console.error('[/api/upload-url]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
