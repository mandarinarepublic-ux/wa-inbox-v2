import { NextResponse } from 'next/server'
import { mensajeLinkPago, validarMonto } from '@/lib/dlocal'
import { crearLink, normalizarProveedor, proveedorPorDefecto } from '@/lib/linkpago'
import { crearNota } from '@/lib/notas'
import { soloDigitos } from '@/lib/supabase'
import { usuarioDeCookie } from '@/lib/acceso'
import { secretoSesion } from '@/lib/sesion'

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
// POST { telefono, monto, proveedor? } → { ok:true, link, texto, proveedor }
// `proveedor` = 'dlocal' | 'payphone' (el selector del panel). Sin él, o con un
// valor raro, se usa el de LINKPAGO_PROVEEDOR (dLocal por defecto).
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

    const proveedor = normalizarProveedor(body?.proveedor) || proveedorPorDefecto()

    let link
    try {
      // Mismo camino que el LINKPAGO<monto> del chat (lib/linkpago.js), para
      // que los dos se vean idénticos en dLocal y en Payphone.
      // Quién lo genera, de la cookie firmada: va al reporte de pagos del CRM.
      const usuarioId = await usuarioDeCookie(req.headers.get('cookie'), secretoSesion())
      link = await crearLink(proveedor, monto, soloDigitos(telefono), { usuarioId })
    } catch (e) {
      console.error(`[/api/linkpago] ${proveedor} falló:`, e.message)
      return NextResponse.json(
        { ok: false, error: `No se pudo generar el link de pago: ${e.message}` },
        { status: 502 },
      )
    }

    const texto = mensajeLinkPago(monto, link)

    // Nota neutral con el MENSAJE COMPLETO (no un resumen): es lo que el
    // vendedor realmente pega en el chat, y así no tiene que reconstruirlo si
    // le toca generar otro link para el mismo cliente. También es el
    // diagnóstico: si nunca aparece una nota verde (pago_ok) después de esta,
    // es que dLocal no está llamando al callback. AWAITED: una escritura sin
    // esperar puede morir si la función serverless se congela justo después
    // de responder (ya pasó una vez con la factura de Dátil).
    try {
      await crearNota(telefono, texto, null)
    } catch (e) {
      // La nota es diagnóstico, no el resultado: si falla, el vendedor igual
      // tiene que poder copiar el link. Se reporta en logs, no se corta el flujo.
      console.error('[/api/linkpago] no se pudo guardar la nota del link:', e.message)
    }

    return NextResponse.json({ ok: true, link, texto, proveedor })
  } catch (err) {
    console.error('[/api/linkpago]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
