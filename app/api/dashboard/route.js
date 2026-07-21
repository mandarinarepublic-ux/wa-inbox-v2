import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

// Dashboard COMBINADO (Mandarina + IND + total). Inbox desde Supabase (RPCs); ventas ($)
// del CRM (Sheet cacheado). Filtros estilo Meta por rango de fecha + sección "HOY" fija.
// Query: ?rango=hoy|ayer|7d|30d|mes|rango  (+ ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD si rango)
export const dynamic = 'force-dynamic'

const MES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES = { ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,oct:9,nov:10,dic:11 }
function parseFechaCrm(s) {
  const m = String(s || '').match(/^(\d{1,2})([A-Za-z]{3})(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  return mes == null ? null : { y: Number(m[3]), m: mes, d: Number(m[1]) }
}

const EC = -5           // Ecuador = UTC-5 (sin horario de verano)
const H  = 86400000
const pad2 = (x) => String(x).padStart(2, '0')
const ecParts   = (date) => { const e = new Date(date.getTime() + EC * 3600000); return { y: e.getUTCFullYear(), m: e.getUTCMonth(), d: e.getUTCDate() } }
const ecDayStart = (y, m, d) => new Date(Date.UTC(y, m, d, -EC, 0, 0)) // 00:00 en Ecuador, en UTC
const n = (v) => Number(v || 0)

const TIENDAS = [
  { id: 'MANDARINA', cuenta: 'MANDI', label: 'Mandarina' },
  { id: 'INDSTORE',  cuenta: 'IND',   label: 'IND Store' },
]

// Rango [desde, hasta) en UTC según el preset (o rango custom), alineado a días de Ecuador.
function calcRango(rango, desdeQ, hastaQ) {
  const t = ecParts(new Date())
  const hoy = ecDayStart(t.y, t.m, t.d)
  const manana = new Date(hoy.getTime() + H)
  switch (rango) {
    case 'hoy':  return { desde: hoy, hasta: manana }
    case 'ayer': return { desde: new Date(hoy.getTime() - H), hasta: hoy }
    case 'semana': { // esta semana, lunes como inicio
      const dow = new Date(Date.UTC(t.y, t.m, t.d)).getUTCDay() // 0=Dom..6=Sáb
      const desdeMon = (dow + 6) % 7 // días desde el lunes
      return { desde: new Date(hoy.getTime() - desdeMon * H), hasta: manana }
    }
    case '30d':  return { desde: new Date(hoy.getTime() - 29 * H), hasta: manana }
    case 'rango': {
      const a = String(desdeQ || '').split('-').map(Number), b = String(hastaQ || '').split('-').map(Number)
      if (a.length === 3 && b.length === 3) {
        return { desde: ecDayStart(a[0], a[1] - 1, a[2]), hasta: new Date(ecDayStart(b[0], b[1] - 1, b[2]).getTime() + H) }
      }
      return { desde: ecDayStart(t.y, t.m, 1), hasta: manana }
    }
    default: return { desde: ecDayStart(t.y, t.m, 1), hasta: manana } // 'mes'
  }
}

// Periodos del eje X (día o mes) + granularidad.
function buildPeriods(desde, hasta) {
  const spanDays = Math.round((hasta - desde) / H)
  const gran = spanDays <= 62 ? 'day' : 'month'
  const periods = []
  if (gran === 'day') {
    for (let ts = desde.getTime(); ts < hasta.getTime(); ts += H) {
      const p = ecParts(new Date(ts + H / 2))
      periods.push({ key: `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`, label: `${p.d} ${MES_ABR[p.m]}` })
    }
  } else {
    const s = ecParts(new Date(desde.getTime() + H / 2)), e = ecParts(new Date(hasta.getTime() - H / 2))
    let y = s.y, m = s.m
    while (y < e.y || (y === e.y && m <= e.m)) {
      periods.push({ key: `${y}-${pad2(m + 1)}`, label: `${MES_ABR[m]} ${String(y).slice(2)}` })
      if (++m > 11) { m = 0; y++ }
    }
  }
  return { gran, periods }
}

const pct = (num, den) => den ? Math.round((num / den) * 100) : null

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const rango = searchParams.get('rango') || 'mes'
    const { desde, hasta } = calcRango(rango, searchParams.get('desde'), searchParams.get('hasta'))
    const { gran, periods } = buildPeriods(desde, hasta)
    const periodKeys = periods.map(p => p.key)

    // Rango "HOY" (siempre, independiente del filtro)
    const t = ecParts(new Date())
    const hoyDesde = ecDayStart(t.y, t.m, t.d), hoyHasta = new Date(hoyDesde.getTime() + H)
    // Ventana de pedidos a traer del CRM (Supabase): cubre el rango seleccionado y HOY.
    const ventasLo = new Date(Math.min(desde.getTime(), hoyDesde.getTime()))
    const ventasHi = new Date(Math.max(hasta.getTime(), hoyHasta.getTime()))

    const sb = getSupabase()
    const [convRes, serieRes, perRes, hoyRes, pedidos] = await Promise.all([
      sb.rpc('dashboard_conversaciones'),
      sb.rpc('dashboard_series',  { p_desde: desde.toISOString(), p_hasta: hasta.toISOString(), p_gran: gran }),
      sb.rpc('dashboard_periodo', { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() }),
      sb.rpc('dashboard_periodo', { p_desde: hoyDesde.toISOString(), p_hasta: hoyHasta.toISOString() }),
      // Ventas ($) del CRM — ahora desde Supabase (schema crm), no del Google Sheet.
      sb.schema('crm').from('pedidos')
        .select('tienda_id, fecha_pedido, monto_total')
        .gte('fecha_pedido', ventasLo.toISOString())
        .lt('fecha_pedido', ventasHi.toISOString())
        .then(r => r?.data || [], () => []),
    ])
    for (const r of [convRes, serieRes, perRes, hoyRes]) if (r.error) throw r.error

    // Pedidos del CRM normalizados: tienda + monto + fecha (en día de Ecuador).
    const pedidosVentas = (pedidos || []).map(p => ({
      tienda: String(p.tienda_id || '').toUpperCase(),
      monto:  n(p.monto_total),
      f:      p.fecha_pedido ? ecParts(new Date(p.fecha_pedido)) : null,
    }))

    const convBy = Object.fromEntries((convRes.data || []).map(r => [r.cuenta, r]))
    const perBy  = Object.fromEntries((perRes.data  || []).map(r => [r.cuenta, r]))
    const hoyBy  = Object.fromEntries((hoyRes.data  || []).map(r => [r.cuenta, r]))
    const serieBy = {}
    for (const r of (serieRes.data || [])) (serieBy[r.cuenta] ||= {})[r.periodo] = r

    const zero = () => Object.fromEntries(periodKeys.map(k => [k, 0]))
    const enRango = (p) => { const dt = ecDayStart(p.y, p.m, p.d); return dt >= desde && dt < hasta }
    const esHoy   = (p) => { const dt = ecDayStart(p.y, p.m, p.d); return dt >= hoyDesde && dt < hoyHasta }
    const periodKey = (p) => gran === 'day' ? `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}` : `${p.y}-${pad2(p.m + 1)}`

    function computeTienda(cuenta, tiendaId) {
      const c = convBy[cuenta] || {}, per = perBy[cuenta] || {}, hoy = hoyBy[cuenta] || {}, serie = serieBy[cuenta] || {}

      const salientesPorPeriodo = zero(), leadsPorPeriodo = zero()
      for (const k of periodKeys) { salientesPorPeriodo[k] = n(serie[k]?.salientes); leadsPorPeriodo[k] = n(serie[k]?.leads) }

      // Ventas del CRM (por TIENDA_ID): total del rango, por periodo, y HOY.
      const ventasNPorPeriodo = zero(), ventasMontoPorPeriodo = zero()
      let ventasTotal = 0, ventasMonto = 0, ventasHoy = 0, ventasMontoHoy = 0
      for (const p of pedidosVentas) {
        if (p.tienda !== tiendaId) continue
        const f = p.f; if (!f) continue
        const monto = p.monto
        if (esHoy(f)) { ventasHoy++; ventasMontoHoy += monto }
        if (!enRango(f)) continue
        const k = periodKey(f)
        if (k in ventasNPorPeriodo) { ventasNPorPeriodo[k]++; ventasMontoPorPeriodo[k] += monto }
        ventasTotal++; ventasMonto += monto
      }

      const leads = n(per.leads), leadsCont = n(per.leads_contestados)
      const rastreados = n(per.rastreados), leidos = n(per.leidos)
      return {
        // Estado actual (no depende del filtro)
        totalContactos: n(c.total),
        estados:     { pendiente: n(c.pendiente), atendido: n(c.atendido), soporte: n(c.soporte), archivado: n(c.archivado) },
        temperatura: { caliente: n(c.caliente), tibio: n(c.tibio), frio: n(c.frio) },
        ventasInbox: n(c.ventas), sinResponder: n(c.sin_responder),
        // KPIs del rango
        leads, leadsContestados: leadsCont, leadsContestadosPct: pct(leadsCont, leads),
        salientes: n(per.salientes), entrantes: n(per.entrantes),
        rastreados, leidos, readRate: pct(leidos, rastreados),
        respAvgSeg: n(per.resp_avg_seg), respN: n(per.resp_n),
        tiempoRespMin: n(per.resp_n) ? Math.round(n(per.resp_avg_seg) / 60) : null,
        ventasTotal, ventasMonto: Math.round(ventasMonto * 100) / 100,
        ticket: ventasTotal ? Math.round((ventasMonto / ventasTotal) * 100) / 100 : null,
        conversion: leads ? Math.round((ventasTotal / leads) * 1000) / 10 : null, // %
        salientesPorPeriodo, leadsPorPeriodo, ventasNPorPeriodo,
        ventasMontoPorPeriodo: Object.fromEntries(Object.entries(ventasMontoPorPeriodo).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        // HOY (siempre)
        hoy: {
          porContestar: n(c.pendiente),
          nuevos: n(hoy.leads),
          entrantes: n(hoy.entrantes),
          salientes: n(hoy.salientes),
          ventas: ventasHoy, ventasMonto: Math.round(ventasMontoHoy * 100) / 100,
          calientes: n(c.caliente),
        },
      }
    }

    const porTienda = {}
    for (const tt of TIENDAS) porTienda[tt.id] = { label: tt.label, ...computeTienda(tt.cuenta, tt.id) }

    // Total combinado
    const total = {
      totalContactos: 0, estados: { pendiente: 0, atendido: 0, soporte: 0, archivado: 0 },
      temperatura: { caliente: 0, tibio: 0, frio: 0 }, ventasInbox: 0, sinResponder: 0,
      leads: 0, leadsContestados: 0, salientes: 0, entrantes: 0, rastreados: 0, leidos: 0,
      ventasTotal: 0, ventasMonto: 0,
      salientesPorPeriodo: zero(), leadsPorPeriodo: zero(), ventasNPorPeriodo: zero(), ventasMontoPorPeriodo: zero(),
      hoy: { porContestar: 0, nuevos: 0, entrantes: 0, salientes: 0, ventas: 0, ventasMonto: 0, calientes: 0 },
    }
    let respSeg = 0, respN = 0
    for (const id of Object.keys(porTienda)) {
      const x = porTienda[id]
      total.totalContactos += x.totalContactos; total.ventasInbox += x.ventasInbox; total.sinResponder += x.sinResponder
      total.leads += x.leads; total.leadsContestados += x.leadsContestados
      total.salientes += x.salientes; total.entrantes += x.entrantes
      total.rastreados += x.rastreados; total.leidos += x.leidos
      total.ventasTotal += x.ventasTotal; total.ventasMonto += x.ventasMonto
      respSeg += x.respAvgSeg * x.respN; respN += x.respN
      for (const e of Object.keys(total.estados)) total.estados[e] += x.estados[e]
      for (const e of Object.keys(total.temperatura)) total.temperatura[e] += x.temperatura[e]
      for (const k of Object.keys(total.hoy)) total.hoy[k] += x.hoy[k]
      for (const k of periodKeys) {
        total.salientesPorPeriodo[k] += x.salientesPorPeriodo[k]
        total.leadsPorPeriodo[k] += x.leadsPorPeriodo[k]
        total.ventasNPorPeriodo[k] += x.ventasNPorPeriodo[k]
        total.ventasMontoPorPeriodo[k] += x.ventasMontoPorPeriodo[k]
      }
    }
    total.ventasMonto = Math.round(total.ventasMonto * 100) / 100
    total.hoy.ventasMonto = Math.round(total.hoy.ventasMonto * 100) / 100
    total.tiempoRespMin = respN ? Math.round(respSeg / respN / 60) : null
    total.readRate = pct(total.leidos, total.rastreados)
    total.leadsContestadosPct = pct(total.leadsContestados, total.leads)
    total.conversion = total.leads ? Math.round((total.ventasTotal / total.leads) * 1000) / 10 : null
    total.ticket = total.ventasTotal ? Math.round((total.ventasMonto / total.ventasTotal) * 100) / 100 : null

    return NextResponse.json({ generadoEn: new Date().toISOString(), rango, gran, periods, porTienda, total })
  } catch (err) {
    console.error('[/api/dashboard]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
