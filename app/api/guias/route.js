import { NextResponse } from 'next/server'
import { procesarGuias, listarGuias, buscarPedidos, buscarGuia, asignarGuia } from '@/lib/guias-registro'
import { usuarioDeCookie } from '@/lib/acceso'
import { secretoSesion } from '@/lib/sesion'

// 🚚 Sección GUÍAS: las guías de Servientrega reenviadas al inbox y su registro
// en el CRM. Detrás del candado de sesión del middleware. Ver lib/guias-registro.js.
//
//   GET                       → la lista (REGISTRADA / PENDIENTE / NUEVA)
//   GET ?buscar=texto         → pedidos del CRM para asignar a mano
//   GET ?cel=&nombre=&dir=    → candidatos con lo leído de la guía (al abrir ✋ Asignar)
//   GET ?guia=numero          → en qué pedido está esa guía (todo el CRM, cualquier fecha)
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
    const sp = new URL(req.url).searchParams
    if (sp.get('guia') != null) return NextResponse.json({ ok: true, guias: await buscarGuia(sp.get('guia')) })
    if (['buscar', 'cel', 'nombre', 'dir'].some(k => sp.get(k) != null)) {
      return NextResponse.json({ ok: true, pedidos: await buscarPedidos({
        q: sp.get('buscar') || '', celular: sp.get('cel') || '', nombre: sp.get('nombre') || '', direccion: sp.get('dir') || '',
      }) })
    }
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
