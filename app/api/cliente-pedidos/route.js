import { NextResponse } from 'next/server'
import { readCrmPedidos, readCrmDetalle, readCrmClientes } from '@/lib/crm'

// La caché real vive en unstable_cache (60s dentro de lib/crm). La ruta es dinámica
// porque filtra por el teléfono del request.
export const dynamic = 'force-dynamic'

const digits = (s) => String(s || '').replace(/\D/g, '')
// Núcleo local del número Ecuador: sin país (593) ni cero inicial → 9 dígitos.
const tail9  = (s) => digits(s).replace(/^593/, '').replace(/^0+/, '').slice(-9)

function telefonoCoincide(a, b) {
  const da = digits(a), db = digits(b)
  if (!da || !db) return false
  if (da.includes(db) || db.includes(da)) return true
  const ta = tail9(a), tb = tail9(b)
  return ta.length >= 8 && ta === tb
}

// Fecha del CRM: "14Jun2026 20:53:00" → Date
const MESES = { ene:0, feb:1, mar:2, abr:3, may:4, jun:5, jul:6, ago:7, sep:8, oct:9, nov:10, dic:11 }
const MES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function parseFechaCrm(s) {
  const m = String(s || '').match(/^(\d{1,2})([A-Za-z]{3})(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  if (mes == null) return null
  return new Date(Number(m[3]), mes, Number(m[1]))
}
function fechaCorta(s) {
  const d = parseFechaCrm(s)
  if (!d) return String(s || '').split(' ')[0] || ''
  return `${d.getDate()} ${MES_ABR[d.getMonth()]} ${d.getFullYear()}`
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const telefono = searchParams.get('telefono') || ''
  const idVenta  = searchParams.get('idVenta')  || ''
  if (!telefono && !idVenta) {
    return NextResponse.json({ error: 'Falta el parámetro telefono' }, { status: 400 })
  }

  let pedidos, detalle, clientes
  try {
    [pedidos, detalle, clientes] = await Promise.all([
      readCrmPedidos(), readCrmDetalle(), readCrmClientes(),
    ])
  } catch (err) {
    console.error('[/api/cliente-pedidos] no se pudo leer MANDARINACRM:', err?.message || err)
    return NextResponse.json(
      {
        error: 'No se pudo leer MANDARINACRM. Comparte el Sheet (lectura) con la Service Account del inbox.',
        compartirCon: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '(GOOGLE_SERVICE_ACCOUNT_EMAIL no definido)',
        detalle: String(err?.message || err).slice(0, 200),
      },
      { status: 502 },
    )
  }

  // 1. CLIENTE_IDs cuyo CELULAR coincide con el teléfono buscado
  const clienteIds = new Set(
    clientes
      .filter(c => telefonoCoincide(c.CELULAR, telefono))
      .map(c => String(c.CLIENTE_ID || '').trim())
      .filter(Boolean)
  )

  // 2. Pedidos del cliente (por CLIENTE_ID) o cuyo PEDIDO_ID == idVenta guardado en el inbox
  const idV = String(idVenta || '').trim()
  const mios = pedidos.filter(p => {
    const cid = String(p.CLIENTE_ID || '').trim()
    const pid = String(p.PEDIDO_ID || '').trim()
    return (cid && clienteIds.has(cid)) || (idV && pid && pid === idV)
  })

  // 3. Items activos por pedido (SUBESTADO != ELIMINADO), vinculados por PEDIDO_ID
  const detActivo = detalle.filter(d => String(d.SUBESTADO || '').toUpperCase() !== 'ELIMINADO')
  const itemsDe = (pid) => detActivo
    .filter(d => String(d.PEDIDO_ID || '').trim() === pid)
    .map(d => ({
      producto: d.PRODUCTO_NOMBRE || '',
      talla:    d.TALLA || '',
      color:    d.COLOR || '',
      cantidad: Number(d.CANTIDAD || 1) || 1,
      precio:   Number(d.PRECIO_UNIT || d.SUBTOTAL || 0) || 0,
    }))

  const CRM_URL = (process.env.MANDARINACRM_URL || 'https://mandarina-pro-sales.vercel.app').replace(/\/$/, '')

  const out = mios
    .map(p => {
      const pid = String(p.PEDIDO_ID || '').trim()
      return {
        id:         pid,
        fecha:      fechaCorta(p.FECHA_PEDIDO),
        _ts:        parseFechaCrm(p.FECHA_PEDIDO)?.getTime() || 0,
        estado:     p.ESTADO_PEDIDO || '',
        estadoPago: p.ESTADO_PAGO || '',
        total:      Number(p.MONTO_TOTAL || 0) || 0,
        url:        pid ? `${CRM_URL}/dashboard/pedido/${encodeURIComponent(pid)}` : '',
        items:      itemsDe(pid),
      }
    })
    .sort((a, b) => b._ts - a._ts)

  const totalGastado = out.reduce((s, p) => s + (p.total || 0), 0)

  return NextResponse.json({
    telefono,
    totalPedidos: out.length,
    totalGastado: Math.round(totalGastado * 100) / 100,
    pedidos: out.map(({ _ts, ...p }) => p),
  })
}
