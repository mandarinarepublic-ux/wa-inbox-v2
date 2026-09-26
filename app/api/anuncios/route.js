import { NextResponse } from 'next/server'
import { getAnunciosResumen, setEtiquetaAnuncio } from '@/lib/contactos'
import { completarAnunciosDesdeMeta } from '@/lib/anuncios-meta'
import { CUENTA } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Anuncios vistos por el inbox (con chats de 30 días) para la tarjeta
// "Bienvenida por anuncio" de AUTOS. Va detrás del login como todo lo del navegador.
export async function GET() {
  try {
    // Nombre, campaña y estado desde el Administrador de anuncios (best-effort,
    // 10 por carga, tope 3 s): un anuncio nuevo aparece con su nombre real.
    await Promise.race([
      completarAnunciosDesdeMeta(CUENTA).catch((e) => console.warn('[/api/anuncios] Meta:', e.message)),
      new Promise((r) => setTimeout(r, 3000)),
    ])
    const anuncios = await getAnunciosResumen()
    return NextResponse.json({ ok: true, anuncios })
  } catch (err) {
    console.error('[/api/anuncios GET]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const { source_id, etiqueta } = await req.json().catch(() => ({}))
    if (!source_id) return NextResponse.json({ ok: false, error: 'falta source_id' }, { status: 400 })
    await setEtiquetaAnuncio(source_id, etiqueta)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/anuncios PATCH]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
