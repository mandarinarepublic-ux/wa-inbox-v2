import { NextResponse } from 'next/server'
import { urlPropia } from '@/lib/url-propia'
import { getContactos, marcarSeguimiento } from '@/lib/contactos'
import { getAutomatizaciones } from '@/lib/automatizaciones'
import { caminoDeSeguimiento } from '@/lib/camino-seguimiento'
import { responderConIA, enviarSaliente } from '@/lib/responder-ia'

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

  // Dominio de producción, NO req.url: la dirección del despliegue está
  // protegida por Vercel y todo envío rebota con 401 (lib/url-propia.js).
  const origin = urlPropia()
  // `null` = TODOS los canales. Con el default (solo el número principal) los
  // contactos de la otra bandeja nunca recibían seguimiento. Cada envío sale por
  // el número al que ese cliente escribió (`Canal: c.phoneId`).
  const contactos = await getContactos(null).catch(() => [])
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
    // Tres caminos posibles; ver lib/camino-seguimiento.js.
    const camino = caminoDeSeguimiento({ config: cfg, contacto: c })
    if (camino === 'saltar') continue

    const entMs = c.ultimoEntranteAt ? new Date(c.ultimoEntranteAt).getTime() : 0
    if (!entMs) continue
    const silencioH = (now - entMs) / H
    if (silencioH >= 24) continue                          // ventana de 24h cerrada

    const regla = seg[temp]
    if (!regla?.activo) continue
    // El texto de la regla solo hace falta en el camino 'texto': 'despertar' no
    // lo usa (lo escribe el agente). Exigirlo para los dos saltaba en silencio
    // los chats con IA activa que no tenian texto cargado.
    if (camino === 'texto' && !String(regla.texto || '').trim()) continue
    if (silencioH < (Number(regla.horas) || 24)) continue  // aún no toca

    // ¿Ya seguimos en ESTA ventana? (el último seguimiento es posterior al último entrante)
    const segMs = c.ultimoSeguimientoAt ? new Date(c.ultimoSeguimientoAt).getTime() : 0
    if (segMs > entMs) continue

    evaluados++
    try {
      let ok = false
      let status = null
      if (camino === 'despertar') {
        // El bot está activo: que retome él la conversación. `responderConIA` ya
        // manda lo que el agente devuelva (texto y fotos) por el canal correcto,
        // y devuelve si de verdad se intento el envio (agente caido o respuesta
        // vacia cuentan como false, para no marcar el seguimiento en falso).
        ok = await responderConIA(origin, c.telefono, c.alias || c.nombre || '', '', c.phoneId, 'seguimiento')
      } else {
        // ☠️ Hasta el 13-sep-2026 esto era un `fetch` pelado, SIN la credencial de
        // máquina. `/api/saliente` no es ruta pública, así que desde que se
        // prendió el candado (7-ago) devolvía 401 y el cron respondía 200 igual:
        // "seguimientos" llevaba prendido desde agosto y NUNCA mandó uno
        // (`ultimo_seguimiento_at` vacío en las 2.210 conversaciones). Misma
        // familia que LINKPAGO. `enviarSaliente` lleva el token, marca `auto` y
        // mira `res.ok`, que es justo lo que faltaba.
        const r = await enviarSaliente(origin, {
          Telefono: c.telefono,
          Nombre: c.alias || c.nombre || '',
          Mensaje: regla.texto.trim(),
          Canal: c.phoneId,
        })
        ok = Boolean(r?.ok)
        if (!ok) status = r?.status ?? 'red'
      }
      if (ok) {
        await marcarSeguimiento(c.telefono).catch(() => {})
        enviados.push({ telefono: c.telefono, temp, camino })
      } else {
        // El código va a la respuesta Y al log: un 401 es el candado, un 4xx de
        // Meta es la ventana o el número. Callarlo es lo que tuvo esto muerto.
        errores.push({ telefono: c.telefono, camino, status })
        console.error('[cron seguimientos] no salió', c.telefono, camino, status)
      }
    } catch (e) {
      errores.push({ telefono: c.telefono, camino, error: e.message })
    }
  }

  return NextResponse.json({
    ok: true,
    enviados: enviados.length,
    errores: errores.length,
    detalle: { enviados, errores, evaluados },
  })
}
