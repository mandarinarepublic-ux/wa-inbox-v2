import { NextResponse } from 'next/server'
import { getContactos, updateTemperatura } from '@/lib/contactos'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { getRespuestas } from '@/lib/respuestas'
import { getFlujosPublicadosSupabase } from '@/lib/inbox-supabase'
import { getEstadosVencidos, borrarEstadosCaducados, borrarEstadoFlujo, guardarEstadoFlujo, registrarPasos } from '@/lib/flujos'
import { decidirVencido } from '@/lib/flujo'
import { correrTanda } from '@/lib/flujo-motor'
import { enviarSaliente } from '@/lib/responder-ia'
import { enviarTelegram } from '@/lib/telegram'
import { CUENTA } from '@/lib/supabase'

// Cron de FLUJOS (Fase B): sigue las esperas en las líneas que ya se cumplieron
// y limpia los estados que caducaron sin respuesta. Cada 5 min (vercel.json).
//
// ⚠️ Está en los TRES lugares (vercel.json, lib/rutas-publicas.js y el matcher de
// middleware.js): un cron detrás del candado da 401 igual que uno vivo y no corre
// nunca. tests/rutas-publicas.test.js lo exige.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const tail9 = (s) => String(s || '').replace(/\D/g, '').replace(/^593/, '').replace(/^0+/, '').slice(-9)

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
  if (!autorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })

  const cfg = await getAutomatizaciones().catch(() => null)
  if (!cfg?.flujos?.activo) return NextResponse.json({ ok: true, skipped: 'flujos apagados (interruptor general)' })

  const origin = new URL(req.url).origin
  const ahora = new Date()
  const caducados = await borrarEstadosCaducados(ahora.toISOString())
    .catch(e => { console.error('[/api/cron/flujos] caducados:', e.message); return { borrados: -1 } })
  const vencidos = await getEstadosVencidos(ahora.toISOString())
    .catch(e => { console.error('[/api/cron/flujos] vencidos:', e.message); return [] })
  if (!vencidos.length) return NextResponse.json({ ok: true, vencidos: 0, caducados: caducados.borrados })

  // `null` = contactos de TODOS los números: cada envío sale por el canal de ese cliente.
  const [flujos, contactos, respuestas] = await Promise.all([
    getFlujosPublicadosSupabase().catch(() => []),
    getContactos(null).catch(() => []),
    getRespuestas().catch(() => []),
  ])
  const deps = {
    enviar: (p) => enviarSaliente(origin, p),
    guardarEstado: guardarEstadoFlujo,
    borrarEstado: borrarEstadoFlujo,
    registrarPasos,
    setTemperatura: updateTemperatura,
    avisar: (texto) => enviarTelegram(texto),
    ahora: () => new Date(),
    cuenta: CUENTA,
    log: console.log,
  }

  const seguidos = []
  const borrados = []
  for (const estado of vencidos) {
    const flujo = flujos.find(f => String(f.flujo_id) === String(estado.flujo_id)) || null
    const c = contactos.find(x => tail9(x.telefono) === tail9(estado.telefono)) || null
    const d = decidirVencido({ estado, flujo, contacto: c, ahora })
    if (d.accion === 'borrar') {
      await borrarEstadoFlujo(estado.telefono).catch(() => {})
      borrados.push({ telefono: estado.telefono, motivo: d.motivo })
      continue
    }
    try {
      const r = await correrTanda(deps, {
        flujo, desde: d.desde, esDisparo: false,
        contacto: {
          telefono: c.telefono, nombre: c.nombre, alias: c.alias || '', phoneId: c.phoneId,
          temperatura: c.temperatura, tieneVenta: Boolean(c.idVenta), estado: c.estado,
          ultimoEntranteAt: c.ultimoEntranteAt,
        },
        wamidEntrante: '', ultimoWamid: estado.ultimo_wamid || '', respuestas,
      })
      seguidos.push({ telefono: estado.telefono, piezas: `${r.salieron}/${r.piezas.length}`, motivo: r.camino.motivo })
    } catch (e) {
      console.error('[/api/cron/flujos]', estado.telefono, e.message)
      await borrarEstadoFlujo(estado.telefono).catch(() => {})
      borrados.push({ telefono: estado.telefono, motivo: 'error: ' + e.message })
    }
  }
  console.log('[/api/cron/flujos]', `vencidos ${vencidos.length} · seguidos ${seguidos.length} · borrados ${borrados.length} · caducados ${caducados.borrados}`)
  return NextResponse.json({ ok: true, vencidos: vencidos.length, seguidos, borrados, caducados: caducados.borrados })
}
