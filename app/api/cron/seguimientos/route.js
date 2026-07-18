import { NextResponse } from 'next/server'
import { getContactos, marcarSeguimiento } from '@/lib/contactos'
import { getAutomatizaciones } from '@/lib/automatizaciones'

// Cron de SEGUIMIENTOS automáticos por temperatura del lead (Eje 2).
// Lo llama Vercel Cron (ver vercel.json). Dispara según las horas de SILENCIO del cliente
// (desde ultimo_entrante_at), SIEMPRE dentro de la ventana de 24h de Meta. Reglas y textos
// viven en inbox.automatizaciones.config.seguimientos. Arranca TODO APAGADO.
//
// Rieles de seguridad:
//  - Interruptor global (seguimientos.activo) + por temperatura (regla.activo).
//  - Tope 1 auto-envío por ventana por contacto (ultimo_seguimiento_at > ultimo_entrante_at).
//  - Se cancela solo si el cliente responde (su nuevo mensaje reinicia la ventana).
//  - Nunca fuera de las 24h (ahí se necesita plantilla → fase 2).
//  - Opcional: solo chats con la IA apagada, para no chocar con el agente.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const H = 3600 * 1000
const TEMPS = ['caliente', 'tibio', 'frio']

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.get('x-vercel-cron') != null // Vercel lo pone solo en crons reales
  const keyQ = new URL(req.url).searchParams.get('key')
  if (isVercelCron) return true
  if (secret && (auth === `Bearer ${secret}` || keyQ === secret)) return true
  return false
}

export async function GET(req) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const cfg = await getAutomatizaciones().catch(() => null)
  const seg = cfg?.seguimientos
  if (!seg?.activo) {
    return NextResponse.json({ ok: true, skipped: 'seguimientos apagado (global)' })
  }

  const origin = new URL(req.url).origin
  const contactos = await getContactos().catch(() => [])
  const now = Date.now()
  const enviados = []
  const errores = []
  let evaluados = 0

  for (const c of contactos) {
    const temp = String(c.temperatura || '').toLowerCase()
    if (!TEMPS.includes(temp)) continue

    const estado = String(c.estado || '').toLowerCase()
    if (estado === 'archivado') continue
    if (String(c.idVenta || '').trim()) continue          // ya es venta → sin seguimiento comercial
    if (seg.solo_ia_apagada && c.modoIA === true) continue // IA prendida → la maneja el agente

    const entMs = c.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
    if (!entMs) continue
    const silencioH = (now - entMs) / H
    if (silencioH >= 24) continue                          // ventana de 24h cerrada

    const regla = seg[temp]
    if (!regla?.activo || !String(regla.texto || '').trim()) continue
    if (silencioH < (Number(regla.horas) || 24)) continue  // aún no toca

    // ¿Ya seguimos en ESTA ventana? (el último seguimiento es posterior al último entrante)
    const segMs = c.ultimoSeguimientoAt ? new Date(c.ultimoSeguimientoAt).getTime() : 0
    if (segMs > entMs) continue

    evaluados++
    try {
      const r = await fetch(`${origin}/api/saliente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Telefono: c.telefono,
          Nombre: c.alias || c.nombre || '',
          Mensaje: regla.texto.trim(),
        }),
      })
      if (r.ok) {
        await marcarSeguimiento(c.telefono).catch(() => {})
        enviados.push({ telefono: c.telefono, temp })
      } else {
        errores.push({ telefono: c.telefono, status: r.status })
      }
    } catch (e) {
      errores.push({ telefono: c.telefono, error: e.message })
    }
  }

  return NextResponse.json({
    ok: true,
    enviados: enviados.length,
    errores: errores.length,
    detalle: { enviados, errores, evaluados },
  })
}
