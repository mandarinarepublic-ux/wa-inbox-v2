import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { readCrmPedidos } from '@/lib/crm'

// Dashboard COMBINADO (Mandarina + IND + total). Métricas del INBOX salen de Supabase
// (RPCs de agregación, frescas), y las VENTAS ($) del CRM (Sheet nativo, cacheado).
// Filtro: ?meses=3|6|12.
export const dynamic = 'force-dynamic'

const MES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const MESES = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 }
function parseFechaCrm(s) {
  const m = String(s || '').match(/^(\d{1,2})([A-Za-z]{3})(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  return mes == null ? null : new Date(Number(m[3]), mes, Number(m[1]))
}

// Tienda del CRM ↔ cuenta del inbox
const TIENDAS = [
  { id: 'MANDARINA', cuenta: 'MANDI', label: 'Mandarina' },
  { id: 'INDSTORE',  cuenta: 'IND',   label: 'IND Store' },
]
const n = (v) => Number(v || 0)

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const meses = Math.min(12, Math.max(1, parseInt(searchParams.get('meses'), 10) || 6))

    const now = new Date()
    const months = []
    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: ym(d), label: `${MES_ABR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` })
    }
    const monthKeys = months.map(m => m.key)
    const desdeISO = new Date(now.getFullYear(), now.getMonth() - (meses - 1), 1).toISOString()

    const sb = getSupabase()
    const [convRes, serieRes, resumenRes, pedidos] = await Promise.all([
      sb.rpc('dashboard_conversaciones'),
      sb.rpc('dashboard_series', { p_desde: desdeISO }),
      sb.rpc('dashboard_resumen', { p_desde: desdeISO }),
      readCrmPedidos().catch(() => []),
    ])
    if (convRes.error) throw convRes.error
    if (serieRes.error) throw serieRes.error
    if (resumenRes.error) throw resumenRes.error

    const convByCuenta   = Object.fromEntries((convRes.data || []).map(r => [r.cuenta, r]))
    const resumByCuenta  = Object.fromEntries((resumenRes.data || []).map(r => [r.cuenta, r]))
    // series: { cuenta: { mes: {salientes, leads} } }
    const serieByCuenta = {}
    for (const r of (serieRes.data || [])) {
      (serieByCuenta[r.cuenta] ||= {})[r.mes] = { salientes: n(r.salientes), leads: n(r.leads) }
    }

    const zero = () => Object.fromEntries(monthKeys.map(k => [k, 0]))

    function computeTienda(cuenta, tiendaId) {
      const c = convByCuenta[cuenta] || {}
      const s = resumByCuenta[cuenta] || {}
      const serie = serieByCuenta[cuenta] || {}

      const salientesPorMes = zero(), leadsPorMes = zero()
      for (const k of monthKeys) {
        salientesPorMes[k] = serie[k]?.salientes || 0
        leadsPorMes[k]     = serie[k]?.leads || 0
      }

      // Ventas ($) desde el CRM, filtradas por TIENDA_ID.
      const ventasNPorMes = zero(), ventasMontoPorMes = zero()
      let ventasTotal = 0, ventasMonto = 0
      for (const p of pedidos) {
        if (String(p.TIENDA_ID || '').toUpperCase() !== tiendaId) continue
        const d = parseFechaCrm(p.FECHA_PEDIDO); if (!d) continue
        const k = ym(d); if (!monthKeys.includes(k)) continue
        const monto = n(p.MONTO_TOTAL)
        ventasNPorMes[k]++; ventasMontoPorMes[k] += monto
        ventasTotal++; ventasMonto += monto
      }

      const rastreados = n(s.rastreados), leidos = n(s.leidos)
      return {
        totalContactos: n(c.total),
        estados:     { pendiente: n(c.pendiente), atendido: n(c.atendido), soporte: n(c.soporte), archivado: n(c.archivado) },
        temperatura: { caliente: n(c.caliente), tibio: n(c.tibio), frio: n(c.frio) },
        ventasInbox: n(c.ventas),        // conversaciones con pedido creado
        sinResponder: n(c.sin_responder), // backlog reciente (<30d) sin responder >24h
        tiempoRespMin: n(s.resp_n) ? Math.round(n(s.resp_avg_seg) / 60) : null,
        readRate: rastreados ? Math.round((leidos / rastreados) * 100) : null,
        rastreados, leidos,
        salientesPorMes, leadsPorMes,
        ventasNPorMes,
        ventasMontoPorMes: Object.fromEntries(Object.entries(ventasMontoPorMes).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        ventasTotal, ventasMonto: Math.round(ventasMonto * 100) / 100,
      }
    }

    const porTienda = {}
    for (const t of TIENDAS) porTienda[t.id] = { label: t.label, ...computeTienda(t.cuenta, t.id) }

    // Total combinado
    const total = {
      totalContactos: 0,
      estados:     { pendiente: 0, atendido: 0, soporte: 0, archivado: 0 },
      temperatura: { caliente: 0, tibio: 0, frio: 0 },
      ventasInbox: 0, sinResponder: 0,
      salientesPorMes: zero(), leadsPorMes: zero(), ventasNPorMes: zero(), ventasMontoPorMes: zero(),
      ventasTotal: 0, ventasMonto: 0, rastreados: 0, leidos: 0,
    }
    let respSegSum = 0, respN = 0
    for (const id of Object.keys(porTienda)) {
      const t = porTienda[id]
      total.totalContactos += t.totalContactos
      total.ventasInbox += t.ventasInbox; total.sinResponder += t.sinResponder
      total.ventasTotal += t.ventasTotal; total.ventasMonto += t.ventasMonto
      total.rastreados += t.rastreados; total.leidos += t.leidos
      for (const e of Object.keys(total.estados)) total.estados[e] += t.estados[e]
      for (const e of Object.keys(total.temperatura)) total.temperatura[e] += t.temperatura[e]
      for (const k of monthKeys) {
        total.salientesPorMes[k] += t.salientesPorMes[k]
        total.leadsPorMes[k] += t.leadsPorMes[k]
        total.ventasNPorMes[k] += t.ventasNPorMes[k]
        total.ventasMontoPorMes[k] += t.ventasMontoPorMes[k]
      }
      if (t.tiempoRespMin != null) { respSegSum += t.tiempoRespMin; respN++ }
    }
    total.ventasMonto = Math.round(total.ventasMonto * 100) / 100
    total.ventasMontoPorMes = Object.fromEntries(Object.entries(total.ventasMontoPorMes).map(([k, v]) => [k, Math.round(v * 100) / 100]))
    total.tiempoRespMin = respN ? Math.round(respSegSum / respN) : null
    total.readRate = total.rastreados ? Math.round((total.leidos / total.rastreados) * 100) : null

    return NextResponse.json({ generadoEn: new Date().toISOString(), meses, months, porTienda, total })
  } catch (err) {
    console.error('[/api/dashboard]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
