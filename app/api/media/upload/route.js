import { NextResponse } from 'next/server'

// Sube un archivo (video) a Meta y devuelve el MediaID, para luego enviarlo por
// WhatsApp. Antes esto lo hacía el NAVEGADOR directo contra graph.facebook.com, lo
// que obligaba a incrustar el META_TOKEN en el bundle del cliente (fuga de seguridad).
// Ahora el token vive SOLO en el servidor (process.env.META_TOKEN, el mismo que ya
// usa /api/media). El cliente solo manda el archivo aquí.
export const dynamic = 'force-dynamic'

const META_TOKEN    = process.env.META_TOKEN || ''
const META_PHONE_ID = process.env.META_PHONE_ID || '1024077200794372'
const GRAPH = 'https://graph.facebook.com/v19.0'

export async function POST(req) {
  try {
    if (!META_TOKEN) {
      return NextResponse.json({ error: 'META_TOKEN no configurado en el servidor' }, { status: 500 })
    }
    const form = await req.formData()
    const file = form.get('file')
    if (!file) {
      return NextResponse.json({ error: 'falta el archivo' }, { status: 400 })
    }

    // Reenviamos el archivo a Meta con el token server-side.
    const fd = new FormData()
    fd.append('file', file, file.name || 'video.mp4')
    fd.append('messaging_product', 'whatsapp')

    const res = await fetch(`${GRAPH}/${META_PHONE_ID}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}` },
      body: fd,
    })
    const data = await res.json()
    if (!data.id) {
      return NextResponse.json(
        { error: data.error?.message || 'Upload fallido en Meta' },
        { status: 502 }
      )
    }
    return NextResponse.json({ id: data.id })
  } catch (err) {
    console.error('[/api/media/upload]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
