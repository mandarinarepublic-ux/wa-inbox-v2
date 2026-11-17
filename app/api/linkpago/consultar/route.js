import { NextResponse } from 'next/server'
import { consultarLink, notaDeConsulta } from '@/lib/payphone'
import { crearNota, listarNotas } from '@/lib/notas'
import { getSupabase, soloDigitos } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── 🔎 CONSULTAR pagos Payphone del chat (botón del panel Ventas, 16-nov-2026) ──
// Payphone no le avisa al inbox cuando pagan (la "notificación externa" nunca se
// activó). Este botón le pregunta a Payphone por los links Payphone de ESTE chat
// de los últimos 7 días (los guarda lib/registro-link-pago.js en crm.links_pago):
//   · actualiza el estado en crm.links_pago (el REPORTE DE PAGOS del CRM lo ve),
//   · si está pagado y no hay nota de esa transacción, deja la nota VERDE.
// No le escribe nada al cliente.
//
// Va detrás del candado (NO está en lib/rutas-publicas.js): solo el panel logueado.
//
// POST { telefono } → { ok, links: [{ id, valor, estado, transactionId, tarjeta, creado_en }] }
const DIAS = 7
const MAX_LINKS = 10

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const tel = soloDigitos(body?.telefono)
    if (!tel) return NextResponse.json({ ok: false, error: 'Falta telefono' }, { status: 400 })

    const crm = getSupabase().schema('crm')
    const desde = new Date(Date.now() - DIAS * 24 * 3600 * 1000).toISOString()
    const { data: filas, error } = await crm.from('links_pago')
      .select('id, valor, estado, transaction_id, tarjeta, client_tx_id, creado_en')
      .eq('proveedor', 'PAYPHONE')
      .eq('celular', tel)
      .gte('creado_en', desde)
      .order('creado_en', { ascending: false })
      .limit(MAX_LINKS)
    if (error) throw new Error(error.message)

    let notas = null
    const links = []
    for (const f of filas || []) {
      // Un link ya PAGADO no cambia: no se vuelve a preguntar.
      if (f.estado === 'PAGADO' || !f.client_tx_id) {
        links.push({ id: f.id, valor: Number(f.valor), estado: f.estado, transactionId: f.transaction_id, tarjeta: f.tarjeta, creado_en: f.creado_en })
        continue
      }
      let c
      try {
        c = await consultarLink(f.client_tx_id)
      } catch (e) {
        console.error('[/api/linkpago/consultar]', f.client_tx_id, e.message)
        links.push({ id: f.id, valor: Number(f.valor), estado: f.estado, error: 'Payphone no respondió', creado_en: f.creado_en })
        continue
      }

      const cambio = { revisado_en: new Date().toISOString() }
      if (c.estado !== f.estado) cambio.estado = c.estado
      if (c.transactionId) cambio.transaction_id = c.transactionId
      if (c.tarjeta) cambio.tarjeta = c.tarjeta
      if (c.estado === 'PAGADO') cambio.pagado_en = c.fecha ? new Date(c.fecha).toISOString() : new Date().toISOString()
      const { error: eUp } = await crm.from('links_pago').update(cambio).eq('id', f.id)
      if (eUp) console.error('[/api/linkpago/consultar] update', f.id, eUp.message)

      const nota = notaDeConsulta(c, f.valor)
      if (nota) {
        // Sin duplicar: si ya hay una nota con esta transacción, no se repite.
        if (!notas) notas = await listarNotas(tel).catch(() => [])
        const marca = `Payphone #${c.transactionId}`
        if (!notas.some((n) => String(n?.texto || '').includes(marca))) {
          const creada = await crearNota(tel, nota.texto, nota.tipo).catch((e) => {
            console.error('[/api/linkpago/consultar] nota', e.message); return null
          })
          if (creada) notas.unshift(creada)
        }
      }
      links.push({ id: f.id, valor: Number(f.valor), estado: c.estado, transactionId: c.transactionId, tarjeta: c.tarjeta, creado_en: f.creado_en })
    }

    return NextResponse.json({ ok: true, links })
  } catch (err) {
    console.error('[/api/linkpago/consultar]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
