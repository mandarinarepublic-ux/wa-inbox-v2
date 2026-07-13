// app/api/admin/inbox-migrate/route.js — BACKFILL TEMPORAL Sheets → Supabase (inbox, cuenta=MANDI).
// Gate FAIL-CLOSED por MIG_KEY. ⚠️ BORRAR tras el cutover.
// Uso:
//   /api/admin/inbox-migrate?key=MIG_KEY&tabla=contactos
//   /api/admin/inbox-migrate?key=MIG_KEY&tabla=respuestas
//   /api/admin/inbox-migrate?key=MIG_KEY&tabla=mensajes&offset=0&limit=1500
import { readSheet } from '@/lib/sheets'
import { mapContactRow } from '@/lib/contactos'
import { mapMensajeRow } from '@/lib/mensajes'
import { mapRespuestaRow } from '@/lib/respuestas'
import { getSupabase, CUENTA, canonTel } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const key = process.env.MIG_KEY
  if (!key || searchParams.get('key') !== key) return Response.json({ error: 'no autorizado' }, { status: 401 })
  const tabla = searchParams.get('tabla')

  if (tabla === 'diag') {
    const v = process.env.DATA_BACKEND
    return Response.json({
      DATA_BACKEND: v,
      codes: v ? Array.from(v).map((c) => c.charCodeAt(0)) : null,
      esSupabase: v === 'supabase',
      cuenta: process.env.INBOX_CUENTA,
      supaUrlOk: Boolean(process.env.SUPABASE_URL),
      srkOk: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    })
  }

  const sb = getSupabase()

  try {
    // ── CONTACTOS → conversaciones ────────────────────────────────────────────
    if (tabla === 'contactos') {
      const rows = await readSheet('CONTACTOS')
      const cs = rows.filter(r => r[0] && r[0] !== 'Telefono' && r[0] !== 'telefono').map(mapContactRow)
      const byTel = new Map()
      for (const c of cs) { const t = canonTel(c.telefono); if (t) byTel.set(t, c) } // último gana (dedup)
      const filas = [...byTel.entries()].map(([tel, c]) => ({
        cuenta: CUENTA, telefono: tel,
        nombre_contacto: c.nombre || '', alias: c.alias || null,
        estado: (c.estado || 'PENDIENTE').toUpperCase(), modo_ia: c.modoIA ? 'IA' : 'HUMANO',
        wa_id: c.waId || null, id_venta: c.idVenta || null, notas: c.notas || null,
      }))
      let ok = 0; const errs = []
      for (const c of chunk(filas, 500)) {
        const { error } = await sb.from('conversaciones').upsert(c, { onConflict: 'cuenta,telefono' })
        if (error) errs.push(error.message); else ok += c.length
      }
      return Response.json({ tabla, leidas: cs.length, unicas: filas.length, escritas: ok, errores: errs.slice(0, 5) })
    }

    // ── RESPUESTAS_RAPIDAS → respuestas_rapidas ───────────────────────────────
    if (tabla === 'respuestas') {
      const rows = await readSheet('RESPUESTAS_RAPIDAS')
      const rs = rows.filter(r => r[1] && String(r[1]).trim() && String(r[0]).toLowerCase() !== 'id').map((r, i) => mapRespuestaRow(r, i))
      const filas = rs.map(r => ({
        cuenta: CUENTA, id: r.id, texto: r.text || '',
        imagenes: [r.imageUrl, ...Array.from({ length: 9 }, (_, k) => r[`imageUrl${k + 2}`])].filter(Boolean),
        botones: r.botones || [], activo: true,
      }))
      const { error } = await sb.from('respuestas_rapidas').upsert(filas, { onConflict: 'cuenta,id' })
      return Response.json({ tabla, escritas: error ? 0 : filas.length, error: error?.message })
    }

    // ── MENSAJES → mensajes (paginado por offset/limit) ───────────────────────
    if (tabla === 'mensajes') {
      const offset = parseInt(searchParams.get('offset') || '0', 10)
      const limit = parseInt(searchParams.get('limit') || '1500', 10)
      const rows = await readSheet('MENSAJES')
      const todos = rows
        .filter(r => r[1] && r[1] !== 'Telefono' && canonTel(r[1]).length >= 9)
        .map(mapMensajeRow)
      const slice = todos.slice(offset, offset + limit)

      // 1) Asegurar conversaciones para los teléfonos de este lote.
      const tels = [...new Set(slice.map(m => canonTel(m.telefono)).filter(Boolean))]
      for (const c of chunk(tels.map(t => ({ cuenta: CUENTA, telefono: t })), 500)) {
        await sb.from('conversaciones').upsert(c, { onConflict: 'cuenta,telefono' })
      }
      // 2) Mapa telefono→conversacion_id.
      const map = new Map()
      for (const c of chunk(tels, 300)) {
        const { data } = await sb.from('conversaciones').select('conversacion_id, telefono').eq('cuenta', CUENTA).in('telefono', c)
        for (const r of data || []) map.set(r.telefono, r.conversacion_id)
      }
      // 3) Insertar mensajes (idempotente por wamid).
      const filas = slice.map(m => ({
        conversacion_id: map.get(canonTel(m.telefono)),
        cuenta: CUENTA, telefono: m.telefono, nombre: m.nombre || '',
        direccion: m.direccion || 'ENTRANTE', tipo: m.tipo || 'texto', texto: m.mensaje || '',
        media_url: m.mediaUrl || null, media_id: m.mediaId || null,
        respuesta_ia: m.respuestaIA || null, foto_ia: m.imagenProducto || null,
        contexto_id: m.contextoId || null, wa_message_id: m.id || null,
        fecha: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
      })).filter(f => f.conversacion_id)
      let ok = 0; const errs = []
      for (const c of chunk(filas, 500)) {
        const conWa = c.filter(f => f.wa_message_id), sinWa = c.filter(f => !f.wa_message_id)
        if (conWa.length) { const { error } = await sb.from('mensajes').upsert(conWa, { onConflict: 'wa_message_id', ignoreDuplicates: true }); if (error) errs.push(error.message); else ok += conWa.length }
        if (sinWa.length) { const { error } = await sb.from('mensajes').insert(sinWa); if (error) errs.push(error.message); else ok += sinWa.length }
      }
      return Response.json({ tabla, total: todos.length, offset, procesados: slice.length, escritas: ok, hayMas: offset + limit < todos.length, errores: errs.slice(0, 5) })
    }

    return Response.json({ error: 'tabla debe ser contactos|respuestas|mensajes' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
