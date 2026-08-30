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
    // Cuántos saltar. Sirve para avanzar cuando un tramo entero está muerto y
    // bloquea la fila (ver el comentario de `dias` abajo).
    const saltar = Math.max(parseInt(url.searchParams.get('saltar') || '0', 10) || 0, 0)
    // Ventana en días. 28 por defecto: ver abajo.
    const dias = Math.min(Math.max(parseInt(url.searchParams.get('dias') || '28', 10) || 28, 1), 60)

    // ── CONTROL: ¿el 400 de Meta significa "ya no existe" o "pedido mal hecho"? ──
    // `?control=1` toma el media_id de un mensaje RECIENTE que SÍ se archivó bien
    // —o sea, uno que sabemos que existía— y le hace el mismo lookup. Si ese
    // también da 400, el problema es el token o la petición, y seguir corriendo
    // el rescate es perder el tiempo. Si da 200, entonces 400 = caducado.
    if (url.searchParams.get('control') === '1') {
      const sbC = getSupabase()
      const { data: reciente } = await sbC.from('mensajes')
        .select('media_id, fecha').eq('cuenta', CUENTA).eq('direccion', 'ENTRANTE')
        .not('media_id', 'is', null).not('media_url', 'is', null)
        .order('fecha', { ascending: false }).limit(1).maybeSingle()
      if (!reciente?.media_id) return NextResponse.json({ ok: false, error: 'sin media reciente para controlar' })
      const r = await fetch(`https://graph.facebook.com/v19.0/${reciente.media_id}`, {
        headers: { Authorization: `Bearer ${process.env.META_TOKEN || ''}` },
      })
      return NextResponse.json({
        ok: true,
        control: 'lookup de una media RECIENTE que sí se archivó',
        fecha_de_esa_media: reciente.fecha,
        status: r.status,
        veredicto: r.ok
          ? 'La petición y el token están BIEN → el 400 de las otras significa que Meta ya las borró'
          : 'También falla con una media reciente → el problema NO es que hayan caducado',
      })
    }

    const sb = getSupabase()
    // ⚠️ 28 días por defecto, NO 31 — y el motivo es un error que ya cometí.
    //
    // La primera versión pedía 31 días "por si acaso", razonando que intentar uno
    // vencido cuesta poco. Pero la fila se ordena de más viejo a más nuevo, así
    // que los 50 primeros eran SIEMPRE los de julio, todos muertos. Cinco
    // corridas seguidas reintentaron exactamente los mismos 50 y nunca llegaron a
    // los de agosto, que sí estaban vivos. Los muertos TAPABAN a los vivos.
    //
    // La lección: una ventana generosa no es gratis cuando hay una fila ordenada
    // detrás. Ahora la ventana solo trae candidatos plausibles, y `?dias=` y
    // `?saltar=` quedan para forzar a mano si hace falta.
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

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
    // ☠️ MÁS NUEVO PRIMERO. Es la SEGUNDA corrección al mismo criterio y la
    // evidencia mandó las dos veces.
    //
    // Empecé por los más viejos razonando "son los que están por vencerse". Suena
    // bien y es falso: los más viejos ya están vencidos. Medido en producción —
    // 100 intentos, 100 fallos, todos de archivos de entre 27 y 28 días. Meta ya
    // no los tiene, así que ordenar por urgencia teórica solo garantizaba
    // gastar cada lote en los que NUNCA iban a volver.
    //
    // Lo que sí se puede rescatar son los más nuevos, y en IND hay documentos de
    // hace 3 días esperando al final de la fila. Más nuevo primero rescata lo
    // rescatable; si algo se queda sin intentar, es lo que menos chance tenía.
    //
    // `?orden=viejo` fuerza el orden anterior, por si alguna vez hace falta.
    const masViejoPrimero = url.searchParams.get('orden') === 'viejo'
    const { data, count, error } = await base
      .order('fecha', { ascending: masViejoPrimero })
      .range(saltar, saltar + limite - 1)
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
      ventana_dias: dias,
      saltados: saltar,
      detalle_fallidos: fallidos.slice(0, 10),
    })
  } catch (err) {
    console.error('[/api/rescatar-media]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
