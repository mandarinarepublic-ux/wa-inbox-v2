// app/api/admin/archivar-media/route.js — BACKFILL TEMPORAL de fotos entrantes.
// Recorre inbox.mensajes (esta cuenta) con fotos sin archivar (media_url vacío,
// media_id presente) y las sube a Supabase Storage vía archivarFoto, dejando la
// URL estable en media_url. ⏰ URGENTE: el media_id de Meta caduca (~30 días).
// Gate FAIL-CLOSED por MIG_KEY. ⚠️ BORRAR tras terminar el backfill.
// Uso: /api/admin/archivar-media?key=MIG_KEY&dias=30&limite=25   (llamar en bucle
//      hasta que restantes=0)
import { getSupabase, CUENTA } from '@/lib/supabase'
import { archivarFoto } from '@/lib/media-archive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TIPOS_IMG = ['imagen', 'image', 'sticker', 'foto']

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const key = process.env.MIG_KEY
  if (!key || searchParams.get('key') !== key) return Response.json({ error: 'no autorizado' }, { status: 401 })

  const dias   = Number(searchParams.get('dias') || 30)
  const limite = Math.min(Number(searchParams.get('limite') || 25), 60)
  const sb = getSupabase()

  try {
    // Candidatas: imagen sin media_url archivada, con media_id, de los últimos N días.
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await sb
      .from('mensajes')
      .select('wa_message_id, media_id, media_url, tipo, fecha')
      .eq('cuenta', CUENTA)
      .in('tipo', TIPOS_IMG)
      .is('media_url', null)
      .not('media_id', 'is', null)
      .gte('fecha', desde)
      .order('fecha', { ascending: false })
      .limit(limite)
    if (error) throw error

    const candidatas = data || []
    let ok = 0, fail = 0
    const errores = []
    for (const m of candidatas) {
      const url = await archivarFoto({ mediaId: m.media_id, wamid: m.wa_message_id })
      if (url) ok++
      else { fail++; errores.push(m.wa_message_id) }
    }

    // Cuántas quedan pendientes (para saber si hay que volver a llamar).
    const { count } = await sb
      .from('mensajes')
      .select('wa_message_id', { count: 'exact', head: true })
      .eq('cuenta', CUENTA)
      .in('tipo', TIPOS_IMG)
      .is('media_url', null)
      .not('media_id', 'is', null)
      .gte('fecha', desde)

    return Response.json({
      cuenta: CUENTA, procesadas: candidatas.length, archivadas: ok, fallidas: fail,
      restantes: count ?? null, errores: errores.slice(0, 10),
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
