import { NextResponse } from 'next/server'
import { enviarTelegram, telegramConfigurado } from '@/lib/telegram'
import {
  getPagosSinPedidoSupabase,
  getMarcaAvisoPagosSupabase,
  setMarcaAvisoPagosSupabase,
} from '@/lib/inbox-supabase'
import { textoAvisoPagos } from '@/lib/pagos-sin-pedido'

// Aviso diario de POSIBLES pagos sin pedido. Lo llama Vercel Cron (vercel.json).
//
// ⚠️ POR QUÉ EXISTE, con números (4-sep-2026): Giovelly Achilie pagó $160 y Jorge
// Díaz $40, los dos dieron sus datos, a los dos se les dijo que su pedido estaba
// en proceso, y ninguno existe en crm.pedidos. $200 cobrados sin pedido — y se
// encontraron A MANO, revisando otra cosa. Nadie los habría visto.
//
// ☠️ ES UN INDICIO. La foto que manda el cliente puede ser un comprobante… o una
// talla. Por eso el texto dice POSIBLE: un aviso que afirme de más y falle tres
// veces se apaga, y entonces no sirve para nada.
//
// Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no manda nada y no rompe nada.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE_URL = String(process.env.INBOX_URL || 'https://inbox.apps.mandarinaec.com')
  .replace(/[^\x21-\x7E]/g, '')   // por si la variable llega con BOM desde PowerShell
  .replace(/\/+$/, '')

// Cuánto mira hacia atrás la PRIMERA vez (sin marca guardada). Corto a propósito:
// al encender esto no tiene sentido avisar de todo lo del mes pasado. Llenar el
// primer aviso de historia vieja es la mejor forma de que se aprenda a ignorarlo.
const VENTANA_INICIAL_HORAS = 48

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const keyQ = new URL(req.url).searchParams.get('key')
  if (!secret) return true              // sin secreto configurado, abierto como los otros crons
  return auth === `Bearer ${secret}` || keyQ === secret
}

export async function GET(req) {
  try {
    if (!autorizado(req)) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
    }
    const marca = await getMarcaAvisoPagosSupabase()
    const desde = marca || new Date(Date.now() - VENTANA_INICIAL_HORAS * 3600e3).toISOString()

    const casos = await getPagosSinPedidoSupabase(desde)
    const texto = textoAvisoPagos(casos, { baseUrl: BASE_URL })

    // ☠️ Sin casos NO se manda nada. Un aviso diario que dice "0" entrena a
    // ignorar el canal, y el día que traiga uno de verdad ya nadie lo abre.
    let enviado = false
    if (texto && telegramConfigurado()) {
      await enviarTelegram(texto)
      enviado = true
    }
    // La marca se mueve SIEMPRE, aunque no hubiera casos: así la ventana avanza
    // y no se re-avisa lo mismo mañana.
    await setMarcaAvisoPagosSupabase(new Date().toISOString())

    return NextResponse.json({ ok: true, desde, casos: casos.length, enviado })
  } catch (err) {
    console.error('[/api/cron/pagos]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
