import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'

// Sube una foto de RESPUESTAS RÁPIDAS a nuestro bucket público `inbox-media` y
// devuelve la URL pública. Antes esto iba a imgbb (tercero, con la API key
// incrustada en el bundle del navegador): cuando imgbb le respondía 500 a los
// servidores de Meta, las fotos salían como `failed`. Guardándolas nosotros, la
// URL es estable y ya no depende de nadie más.
export const dynamic = 'force-dynamic'

const BUCKET = 'inbox-media'
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export async function POST(req) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!file) return NextResponse.json({ error: 'falta el archivo' }, { status: 400 })

    const contentType = (file.type || 'image/jpeg').split(';')[0].trim()
    const ext = EXT[contentType] || 'jpg'
    const buf = Buffer.from(await file.arrayBuffer())

    // Nombre único: la foto de una respuesta rápida no tiene una clave natural.
    const path = `respuestas/${CUENTA}/${crypto.randomUUID()}.${ext}`

    const sb = getSupabase()
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType, upsert: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 502 })

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
    if (!pub?.publicUrl) return NextResponse.json({ error: 'sin URL pública' }, { status: 502 })

    return NextResponse.json({ url: pub.publicUrl })
  } catch (err) {
    console.error('[/api/upload-foto]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
