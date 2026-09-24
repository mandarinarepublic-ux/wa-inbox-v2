import { NextResponse } from 'next/server'
import { urlPropia } from '@/lib/url-propia'
import { getContactos, reclamarReactivacion, getEstadoBandeja, getPedidosPorTelefono } from '@/lib/contactos'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { decidirReactivacion } from '@/lib/reactivacion'
import { tail9 } from '@/lib/etiqueta-crm'
import { enviarSaliente } from '@/lib/responder-ia'
import { autorizadoCron } from '@/lib/cron-auth'

// Cron de REACTIVACIÓN por etapa (Vercel Cron cada hora, ver vercel.json).
// Port desde IND, etapa 3 (23-sep-2026). La regla entera vive en
// lib/reactivacion.js, que es pura y está probada: a quién, cuándo y qué texto.
// Arranca APAGADA (config.reactivacion.activo = false): la prende Rodrigo en AUTOS.
//
// Los seguimientos por TEMPERATURA (🔥🌤️❄️ marcada a mano) se retiraron en la
// etapa 2: la temperatura ya es automática y nadie la escribe.
//
// Lo propio de MANDI:
//  - La bandeja es POR NÚMERO. `getContactos` trae una ficha por persona con el
//    número de su ÚLTIMO mensaje (`phoneId`) y su ventana (`ultimoEntranteAt`); el
//    estado que cuenta es el de la bandeja de ESE número, que se lee aparte y se le
//    pone a la ficha antes de decidir.
//  - Si el agente lleva el chat o lo despertaría, no escribe (lo decide la regla).
//  - Cada envío sale por el número al que ese cliente escribió (`Canal: phoneId`).

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Quién puede disparar este cron: una sola regla para todos (lib/cron-auth.js).
const autorizado = (req) => autorizadoCron(req)

export async function GET(req) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const cfg = await getAutomatizaciones().catch(() => null)
  if (!cfg?.reactivacion?.activo) {
    return NextResponse.json({ ok: true, skipped: 'reactivación apagada' })
  }

  // Dominio de producción, NO req.url: la dirección del despliegue está
  // protegida por Vercel y todo envío rebota con 401 (lib/url-propia.js).
  const origin = urlPropia()
  // `null` = TODOS los números.
  const contactos = await getContactos(null).catch(() => [])
  const pedidos = await getPedidosPorTelefono().catch(() => ({}))
  const now = Date.now()
  const enviados = []
  const errores = []
  let evaluados = 0

  for (const c of contactos) {
    // Primer filtro con la ficha (barato). `estado` de la ficha = último cambio de
    // cualquiera de los dos números: si no es ATENDIDO, la reserva tampoco ganaría.
    const pedido = pedidos[tail9(c.telefono)] || null
    if (!decidirReactivacion({ config: cfg, contacto: c, pedido, ahoraMs: now })) continue

    // La bandeja del NÚMERO por el que escribió manda. Se lee recién ahora, solo
    // para los candidatos: nunca la tabla entera (ver inbox-supabase.js).
    const estadoNumero = await getEstadoBandeja(c.telefono, c.phoneId)
      .catch(e => { console.error('[cron reactivación] bandeja:', c.telefono, e.message); return null })
    const d = decidirReactivacion({
      config: cfg, contacto: { ...c, estado: String(estadoNumero || '').toLowerCase() }, pedido, ahoraMs: now,
    })
    if (!d) continue
    evaluados++

    // RESERVAR antes de enviar: si otra corrida ya lo tomó, o el cliente o una
    // persona escribieron entre medio, no se manda nada.
    const reservado = await reclamarReactivacion(c.telefono, {
      nEsperado: c.reactivacionN || 0, nNuevo: d.nNuevo,
      ultimoEntranteAt: c.ultimoEntranteAt, ultimoHumanoAt: c.ultimoHumanoAt,
    }).catch(e => { console.error('[cron reactivación] reservar:', c.telefono, e.message); return false })
    if (!reservado) continue

    const r = await enviarSaliente(origin, {
      Telefono: c.telefono, Nombre: c.alias || c.nombre || '', Mensaje: d.texto, Canal: c.phoneId,
    })
    if (r?.ok) {
      enviados.push({ telefono: c.telefono, motivo: `reactivacion_${d.toque}`, etapa: d.etapa })
    } else {
      // El código va a la respuesta Y al log: un 401 es el candado, un 4xx de Meta
      // es la ventana o el número. Callarlo es lo que tuvo esto muerto en agosto.
      errores.push({ telefono: c.telefono, motivo: `reactivacion_${d.toque}`, status: r?.status ?? 'red' })
    }
  }

  return NextResponse.json({
    ok: true,
    enviados: enviados.length,
    errores: errores.length,
    detalle: { enviados, errores, evaluados },
  })
}
