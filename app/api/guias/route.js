import { NextResponse } from 'next/server'
import { procesarGuias, listarGuias, buscarPedidos, asignarGuia } from '@/lib/guias-registro'
import { usuarioDeCookie } from '@/lib/acceso'
import { secretoSesion } from '@/lib/sesion'

// 🚚 Sección GUÍAS: las guías de Servientrega reenviadas al inbox y su registro
// en el CRM. Detrás del candado de sesión del middleware. Ver lib/guias-registro.js.
//
//   GET                       → la lista (REGISTRADA / PENDIENTE / NUEVA)
//   GET ?buscar=texto         → pedidos del CRM para asignar a mano
//   POST {}                   → procesar (OCR de las nuevas + reintentar pendientes)
//   POST { simular: true }    → lo mismo sin escribir
//   POST { accion:'asignar', numero, pedidoId } → asignar a mano
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const fallo = (e) => {
  console.error('[guias]', e)
  return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
}

export async function GET(req) {
  try {
    const buscar = new URL(req.url).searchParams.get('buscar')
    if (buscar != null) return NextResponse.json({ ok: true, pedidos: await buscarPedidos(buscar) })
    return NextResponse.json({ ok: true, ...(await listarGuias()) })
  } catch (e) { return fallo(e) }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.accion === 'asignar') {
      const usuario = await usuarioDeCookie(req.headers.get('cookie'), secretoSesion())
      return NextResponse.json(await asignarGuia({ numero: body.numero, pedidoId: body.pedidoId, usuario }))
    }
    return NextResponse.json({ ok: true, ...(await procesarGuias({ simular: body?.simular === true })) })
  } catch (e) { return fallo(e) }
}
