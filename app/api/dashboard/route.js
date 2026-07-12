import { NextResponse } from 'next/server'
import { readSheetFrom } from '@/lib/sheets'
import { readCrmPedidos } from '@/lib/crm'
import { parseDate } from '@/lib/utils'

// Dashboard COMBINADO: lee la hoja de MANDI y la de IND (misma Service Account) +
// las ventas del CRM (por TIENDA_ID). Devuelve métricas por tienda y el total.
// Filtro: ?meses=3|6|12 (ventana de tiempo).
export const dynamic = 'force-dynamic'

const MANDI_SHEET = process.env.SHEET_ID || '1ZQ_vIhKsDBnAUjitOB3zP-4MDbdmsv7hdDgnqNbOkak'
const IND_SHEET   = process.env.IND_SHEET_ID || '1ObNIff1ypeFW7PfuAjeoiGBJCDyZU4etIsbGpyB-Nqk'
const TIENDAS = [
  { id: 'MANDARINA', label: 'Mandarina', sheet: MANDI_SHEET },
  { id: 'INDSTORE',  label: 'IND Store', sheet: IND_SHEET },
]

const MES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const MESES = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 }
function parseFechaCrm(s) {
  const m = String(s || '').match(/^(\d{1,2})([A-Za-z]{3})(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  return mes == null ? null : new Date(Number(m[3]), mes, Number(m[1]))
}

const ESTADO_KEYS = ['pendiente', 'atendido', 'ventaproceso', 'venta', 'soporte', 'archivado']

// Calcula todas las métricas de UNA tienda
function computeTienda(contRows, msgRows, pedidos, tiendaId, monthKeys) {
  const zero = () => Object.fromEntries(monthKeys.map(k => [k, 0]))
  const inRange = (k) => monthKeys.includes(k)

  // Estados actuales (CONTACTOS: A=Tel D=Estado)
  const estados = Object.fromEntries(ESTADO_KEYS.map(k => [k, 0]))
  let totalContactos = 0
  for (const r of contRows) {
    const tel = r[0]; if (!tel || tel === 'Telefono' || tel === 'telefono') continue
    totalContactos++
    const e = String(r[3] || 'pendiente').replace(/[\s ]+/g, ' ').trim().toLowerCase() || 'pendiente'
    if (estados[e] != null) estados[e]++
  }

  // Mensajes (MENSAJES: B=Tel G=Fecha H=Direccion)
  const salientesPorMes = zero()
  const firstMsg = {}, byTel = {}
  for (const r of msgRows) {
    const tel = r[1]; if (!tel || tel === 'Telefono') continue
    const dir = String(r[7] || '').toUpperCase()
    const d = parseDate(r[6])
    if (!d || isNaN(d.getTime())) continue
    const k = ym(d)
    if (dir === 'SALIENTE' && inRange(k)) salientesPorMes[k]++
    if (!firstMsg[tel] || d < firstMsg[tel]) firstMsg[tel] = d
    ;(byTel[tel] ||= []).push({ d, dir })
  }
  const leadsPorMes = zero()
  for (const t in firstMsg) { const k = ym(firstMsg[t]); if (inRange(k)) leadsPorMes[k]++ }

  // Tiempo de respuesta + sin responder >24h
  let sumRespMs = 0, nResp = 0, sinResponder = 0
  const nowMs = Date.now()
  for (const t in byTel) {
    const arr = byTel[t].sort((a, b) => a.d - b.d)
    const iIn = arr.findIndex(x => x.dir === 'ENTRANTE')
    if (iIn >= 0) { const out = arr.slice(iIn + 1).find(x => x.dir === 'SALIENTE'); if (out) { sumRespMs += (out.d - arr[iIn].d); nResp++ } }
    const last = arr[arr.length - 1]
    if (last && last.dir === 'ENTRANTE' && (nowMs - last.d) > 24 * 3600 * 1000) sinResponder++
  }

  // Ventas (CRM, filtrado por TIENDA_ID)
  const ventasNPorMes = zero(), ventasMontoPorMes = zero()
  let ventasTotal = 0, ventasMonto = 0
  for (const p of pedidos) {
    if (String(p.TIENDA_ID || '').toUpperCase() !== tiendaId) continue
    const d = parseFechaCrm(p.FECHA_PEDIDO); if (!d) continue
    const k = ym(d); if (!inRange(k)) continue
    const monto = Number(p.MONTO_TOTAL || 0) || 0
    ventasNPorMes[k]++; ventasMontoPorMes[k] += monto
    ventasTotal++; ventasMonto += monto
  }

  return {
    totalContactos, estados,
    salientesPorMes, leadsPorMes,
    ventasNPorMes,
    ventasMontoPorMes: Object.fromEntries(Object.entries(ventasMontoPorMes).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    ventasTotal, ventasMonto: Math.round(ventasMonto * 100) / 100,
    tiempoRespMin: nResp ? Math.round(sumRespMs / nResp / 60000) : null,
    sinResponder,
  }
}

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

    const pedidos = await readCrmPedidos().catch(() => [])
    const porTienda = {}
    await Promise.all(TIENDAS.map(async (t) => {
      const [cont, msgs] = await Promise.all([
        readSheetFrom(t.sheet, 'CONTACTOS').catch(() => []),
        readSheetFrom(t.sheet, 'MENSAJES').catch(() => []),
      ])
      porTienda[t.id] = { label: t.label, ...computeTienda(cont, msgs, pedidos, t.id, monthKeys) }
    }))

    // Total combinado
    const zero = () => Object.fromEntries(monthKeys.map(k => [k, 0]))
    const total = {
      totalContactos: 0, estados: Object.fromEntries(ESTADO_KEYS.map(k => [k, 0])),
      salientesPorMes: zero(), leadsPorMes: zero(), ventasNPorMes: zero(), ventasMontoPorMes: zero(),
      ventasTotal: 0, ventasMonto: 0, sinResponder: 0,
    }
    for (const id of Object.keys(porTienda)) {
      const t = porTienda[id]
      total.totalContactos += t.totalContactos
      total.ventasTotal += t.ventasTotal; total.ventasMonto += t.ventasMonto; total.sinResponder += t.sinResponder
      for (const e of ESTADO_KEYS) total.estados[e] += t.estados[e]
      for (const k of monthKeys) {
        total.salientesPorMes[k] += t.salientesPorMes[k]
        total.leadsPorMes[k] += t.leadsPorMes[k]
        total.ventasNPorMes[k] += t.ventasNPorMes[k]
        total.ventasMontoPorMes[k] += t.ventasMontoPorMes[k]
      }
    }
    total.ventasMonto = Math.round(total.ventasMonto * 100) / 100
    total.ventasMontoPorMes = Object.fromEntries(Object.entries(total.ventasMontoPorMes).map(([k, v]) => [k, Math.round(v * 100) / 100]))

    return NextResponse.json({ generadoEn: new Date().toISOString(), meses, months, porTienda, total })
  } catch (err) {
    console.error('[/api/dashboard]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
