import { NextResponse } from 'next/server'
import { crearLinkPago, mensajeLinkPago, validarMonto } from '@/lib/dlocal'
import { crearNota } from '@/lib/notas'
import { soloDigitos } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── LINK PAGO desde el panel Ventas ─────────────────────────────────────────
// Antes "LINKPAGO<monto>" solo se disparaba escribiéndolo en el chat (ver
// app/api/saliente/route.js), y eso lo mandaba directo al cliente. Este botón
// es distinto a propósito: genera el link y el texto, pero NO manda nada —
// el vendedor lo copia y decide cuándo y cómo mandarlo.
//
// Esta ruta va detrás del candado del middleware a propósito (NO está en
// lib/rutas-publicas.js): solo la usa el panel logueado.
//
// POST { telefono, monto } → { ok:true, link, texto }
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const { telefono } = body || {}
    if (!telefono) {
      return NextResponse.json({ ok: false, error: 'Falta telefono' }, { status: 400 })
    }

    const monto = validarMonto(body?.monto)
    if (monto === null) {
      return NextResponse.json(
        { ok: false, error: 'El monto tiene que ser un número mayor a cero' },
        { status: 400 },
      )
    }

    // Mismo formato de order_id que usa el camino LINKPAGO<monto> del chat
    // (app/api/saliente/route.js), para que ambos se vean idénticos en dLocal.
    const orderId = `${soloDigitos(telefono)}-${Date.now()}`

    let link
    try {
      link = await crearLinkPago(monto, orderId)
    } catch (e) {
      console.error('[/api/linkpago] dLocal falló:', e.message)
      return NextResponse.json(
        { ok: false, error: `No se pudo generar el link de pago: ${e.message}` },
        { status: 502 },
      )
    }

    const texto = mensajeLinkPago(monto, link)

    // Nota neutral que deja constancia de que el link se generó. Es el
    // diagnóstico: si nunca aparece una nota verde (pago_ok) después de esta,
    // es que dLocal no está llamando al callback. AWAITED: una escritura sin
    // esperar puede morir si la función serverless se congela justo después
    // de responder (ya pasó una vez con la factura de Dátil).
    try {
      await crearNota(telefono, `Link de pago generado por $${monto}`, null)
    } catch (e) {
      // La nota es diagnóstico, no el resultado: si falla, el vendedor igual
      // tiene que poder copiar el link. Se reporta en logs, no se corta el flujo.
      console.error('[/api/linkpago] no se pudo guardar la nota del link:', e.message)
    }

    return NextResponse.json({ ok: true, link, texto })
  } catch (err) {
    console.error('[/api/linkpago]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
