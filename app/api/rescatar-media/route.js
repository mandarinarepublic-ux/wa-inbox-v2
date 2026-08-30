import { NextResponse } from 'next/server'
import { getSupabase, CUENTA } from '@/lib/supabase'
import { archivarMedia } from '@/lib/media-archive'

// Rescate de la media entrante que quedó colgando del `media_id` de Meta.
//
// ⚠️ POR QUÉ EXISTE, con números (medido el 29-ago-2026). Entre el 13-jul y el
// 3-ago el bucket `inbox-media` rechazaba `audio/*`, así que durante tres semanas
// NINGUNA nota de voz se archivó: quedaron colgadas del `media_id`, que Meta
// borra a los ~30 días. Desde el 10-ago se archiva el 100% — la causa ya está
// arreglada y esto NO es un parche permanente, es un rescate de una sola vez.
//
//   IND    155 rescatables · 130 ya perdidos · ~21 se pierden por día
//   MANDI   19 rescatables ·  34 ya perdidos ·  ~2 por día
//
// Se procesa DE LO MÁS VIEJO A LO MÁS NUEVO a propósito: los del 31-jul están a
// horas de que Meta los borre; los del 3-ago tienen días de margen.
//
// Idempotente: `archivarMedia` no re-baja lo que ya tiene `media_url`, y la
// consulta solo trae filas sin archivar. Se puede correr las veces que haga falta.
//
// Va por lotes porque cada archivo son dos viajes (bajar de Meta, subir al
// bucket): meter los 155 en una sola invocación se pasaría del tiempo máximo y
// se perderían TODOS los del lote, no solo el que falló.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Cuántos a la vez contra Meta. No es por velocidad: es para no pedirle 25
// archivos de golpe y que empiece a rechazar por ritmo — ahí perderíamos
// rescatables que sí estaban disponibles.
const EN_PARALELO = 5

export async function GET(req) {
  try {
    const url = new URL(req.url)
    const limite = Math.min(Math.max(parseInt(url.searchParams.get('limite') || '20', 10) || 20, 1), 50)
    // `?ver=1` solo cuenta, no toca nada. Para mirar cuánto queda sin gastar
    // llamadas a Meta.
    const soloVer = url.searchParams.get('ver') === '1'

    const sb = getSupabase()
    // Meta borra a los ~30 días, pero el límite es aproximado. Se piden 31 a
    // propósito: la asimetría manda. Intentar uno que ya no está cuesta una
    // llamada y devuelve "no estaba"; NO intentar uno que sí estaba pierde una
    // nota de voz de un cliente para siempre.
    const desde = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

    const base = sb.from('mensajes')
      .select('wa_message_id, media_id, tipo, fecha', { count: 'exact' })
      .eq('cuenta', CUENTA)
      .eq('direccion', 'ENTRANTE')
      .is('media_url', null)
      .not('media_id', 'is', null)
      .gte('fecha', desde)

    if (soloVer) {
      const { count, error } = await base.limit(1)
      if (error) throw error
      return NextResponse.json({ ok: true, quedan: count ?? 0, rescatados: 0 })
    }

    // Más viejo primero: es el que está por vencerse.
    const { data, count, error } = await base.order('fecha', { ascending: true }).limit(limite)
    if (error) throw error

    const filas = data || []
    let rescatados = 0
    const fallidos = []

    for (let i = 0; i < filas.length; i += EN_PARALELO) {
      const lote = filas.slice(i, i + EN_PARALELO)
      const res = await Promise.all(lote.map(async (m) => {
        // `archivarMedia` es best-effort y NUNCA lanza: devuelve la url o null.
        const u = await archivarMedia({ mediaId: m.media_id, wamid: m.wa_message_id })
        return { m, u }
      }))
      for (const { m, u } of res) {
        if (u) rescatados += 1
        // Se dice CUÁLES fallaron y de qué fecha son. Un rescate que solo dice
        // "12 de 20" no deja saber si lo que falla es lo viejo (Meta ya lo borró,
        // normal) o lo nuevo (ahí sí hay algo roto).
        else fallidos.push({ tipo: m.tipo, fecha: m.fecha })
      }
    }

    return NextResponse.json({
      ok: true,
      procesados: filas.length,
      rescatados,
      // Los que Meta ya no tiene. Es el resultado esperado para los más viejos:
      // no es un error del rescate, es que llegamos tarde a esos.
      no_estaban_en_meta: fallidos.length,
      quedan: Math.max(0, (count ?? filas.length) - rescatados),
      detalle_fallidos: fallidos.slice(0, 10),
    })
  } catch (err) {
    console.error('[/api/rescatar-media]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
