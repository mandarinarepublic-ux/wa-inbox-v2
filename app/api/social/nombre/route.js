import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { getTokenPagina, getFbPageId } from '@/lib/social-supabase'
import { resolverNombreSocial } from '@/lib/social-nombre'

// Nombre de un cliente de DM que quedó guardado sin nombre (se veía su PSID).
// El chat lo pide al abrir la conversación: lo busca en Meta y lo guarda en
// todas sus filas sin nombre, así la próxima vez ya sale de la base.
export const dynamic = 'force-dynamic'

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams
    const id = sp.get('id') || ''
    const canal = String(sp.get('canal') || '').toUpperCase() === 'IG' ? 'IG' : 'FB'
    if (!id) return NextResponse.json({ error: 'falta id' }, { status: 400 })

    const [token, pageId] = await Promise.all([getTokenPagina().catch(() => ''), getFbPageId().catch(() => '')])
    const { nombre, error } = await resolverNombreSocial({ id, canal, token, pageId })
    if (!nombre) {
      console.error('[/api/social/nombre] no resuelto:', canal, id.slice(-5), error)
      return NextResponse.json({ nombre: '', error })
    }

    // Guardia en el WHERE: solo filas sin nombre → idempotente.
    const sb = getSupabase()
    const { error: e2 } = await sb.from('social_mensajes').update({ nombre })
      .eq('cuenta', CUENTA).eq('canal', canal).eq('sender_id', id)
      .or('nombre.is.null,nombre.eq.')
    if (e2) console.error('[/api/social/nombre] no se pudo guardar:', e2.message)
    return NextResponse.json({ nombre })
  } catch (err) {
    console.error('[/api/social/nombre]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
