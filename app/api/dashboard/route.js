import { NextResponse } from 'next/server'
import { getContactos } from '@/lib/contactos'
import { mapMensajeRow } from '@/lib/mensajes'
import { readMensajesFull } from '@/lib/cache'
import { readCrmPedidos } from '@/lib/crm'
import { parseDate } from '@/lib/utils'

// Métricas del inbox para el /dashboard. Lee estado actual (CONTACTOS), actividad e
// historial (MENSAJES, últimas ~3000 filas) y ventas del CRM (PEDIDOS, tienda MANDARINA).
export const dynamic = 'force-dynamic'

const TIENDA = 'MANDARINA' // esta línea = Mandarina Republic
const MES_ABR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// Fecha del CRM: "18Jun2026 10:27:28"
const MESES = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 }
function parseFechaCrm(s) {
  const m = String(s || '').match(/^(\d{1,2})([A-Za-z]{3})(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  if (mes == null) return null
  return new Date(Number(m[3]), mes, Number(m[1]))
}

export async function GET() {
  try {
    const [contactos, mensajeRows, pedidos] = await Promise.all([
      getContactos().catch(() => []),
      readMensajesFull().catch(() => []),
      readCrmPedidos().catch(() => []),
    ])
    // Mapear + saltar header/filas inválidas
    const mensajes = mensajeRows
      .filter(r => r[1] && r[1] !== 'Telefono')
      .map(mapMensajeRow)

    // ── Últimos 6 meses (etiquetas) ────────────────────────────────
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: ym(d), label: `${MES_ABR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` })
    }
    const monthKeys = months.map(m => m.key)
    const zero = () => Object.fromEntries(monthKeys.map(k => [k, 0]))

    // ── 1) Estados actuales ────────────────────────────────────────
    const estados = { pendiente: 0, atendido: 0, ventaproceso: 0, venta: 0, soporte: 0, archivado: 0 }
    for (const c of contactos) {
      const e = String(c.estado || 'pendiente').toLowerCase()
      if (estados[e] != null) estados[e]++
    }

    // ── 2) Actividad + leads por mes; agrupar mensajes por teléfono ─
    const salientesPorMes = zero()
    const firstMsg = {}      // tel -> Date más antigua (para leads)
    const byTel = {}         // tel -> [{d, dir}]
    for (const m of mensajes) {
      const d = parseDate(m.timestamp)
      if (!d || isNaN(d.getTime())) continue
      const k = ym(d)
      if (m.direccion === 'SALIENTE' && k in salientesPorMes) salientesPorMes[k]++
      if (!firstMsg[m.telefono] || d < firstMsg[m.telefono]) firstMsg[m.telefono] = d
      ;(byTel[m.telefono] ||= []).push({ d, dir: m.direccion })
    }
    const leadsPorMes = zero()
    for (const t in firstMsg) { const k = ym(firstMsg[t]); if (k in leadsPorMes) leadsPorMes[k]++ }

    // ── 3) Tiempo de respuesta + chats sin responder >24h ──────────
    let sumRespMs = 0, nResp = 0, sinResponder = 0
    const nowMs = Date.now()
    for (const t in byTel) {
      const arr = byTel[t].sort((a, b) => a.d - b.d)
      const iIn = arr.findIndex(x => x.dir === 'ENTRANTE')
      if (iIn >= 0) {
        const out = arr.slice(iIn + 1).find(x => x.dir === 'SALIENTE')
        if (out) { sumRespMs += (out.d - arr[iIn].d); nResp++ }
      }
      const last = arr[arr.length - 1]
      if (last && last.dir === 'ENTRANTE' && (nowMs - last.d) > 24 * 3600 * 1000) sinResponder++
    }
    const tiempoRespMin = nResp ? Math.round(sumRespMs / nResp / 60000) : null

    // ── 4) Ventas por mes (CRM, tienda MANDARINA) ──────────────────
    const ventasNPorMes = zero()
    const ventasMontoPorMes = zero()
    let ventasTotalPeriodo = 0, ventasMontoPeriodo = 0
    for (const p of pedidos) {
      if (String(p.TIENDA_ID || '').toUpperCase() !== TIENDA) continue
      const d = parseFechaCrm(p.FECHA_PEDIDO)
      if (!d) continue
      const k = ym(d)
      if (k in ventasNPorMes) {
        const monto = Number(p.MONTO_TOTAL || 0) || 0
        ventasNPorMes[k]++
        ventasMontoPorMes[k] += monto
        ventasTotalPeriodo++
        ventasMontoPeriodo += monto
      }
    }

    return NextResponse.json({
      tienda: TIENDA,
      generadoEn: new Date().toISOString(),
      totalContactos: contactos.length,
      estados,
      months,
      salientesPorMes,
      leadsPorMes,
      ventasNPorMes,
      ventasMontoPorMes: Object.fromEntries(Object.entries(ventasMontoPorMes).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      ventasTotalPeriodo,
      ventasMontoPeriodo: Math.round(ventasMontoPeriodo * 100) / 100,
      tiempoRespMin,
      sinResponder,
    })
  } catch (err) {
    console.error('[/api/dashboard]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
