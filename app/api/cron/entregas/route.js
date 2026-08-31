import { getSupabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { enviarTelegram, telegramConfigurado } from '@/lib/telegram'
import {
  getEntregasFallidasSupabase,
  getMarcaAvisoFallidosSupabase,
  setMarcaAvisoFallidosSupabase,
} from '@/lib/inbox-supabase'
import { agruparFallos, textoAvisoFallidos } from '@/lib/entregas-fallidas'
import { CANALES } from '@/lib/canales'

// Aviso de mensajes que NO le llegaron al cliente. Lo llama Vercel Cron (vercel.json).
//
// ⚠️ POR QUÉ EXISTE, con números: en agosto murieron 14 mensajes salientes sin que
// nadie se enterara — los seis del 16-ago a un cliente que nunca había escrito a
// ese número, los tres (más uno) del 19-ago, y otros cuatro repartidos. TODOS con
// el mismo error 131047. Se encontraron por casualidad, revisando otra cosa.
//
// Lo único que lo decía era un `⚠` rojo de 11 px al lado de la hora, con el motivo
// escondido en un `title=` — invisible al tacto en un celular. Es la misma trampa
// del bug de push de julio, que estuvo 17 días roto porque el aviso solo se veía
// en la PC.
//
// Este chequeo se pidió por escrito el 29-jul y no se hizo hasta el 21-ago.
//
// Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no manda nada y no rompe nada.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE_URL = String(process.env.INBOX_URL || 'https://inbox.apps.mandarinaec.com')
  .replace(/[^\x21-\x7E]/g, '')   // por si la variable llega con BOM desde PowerShell
  .replace(/\/+$/, '')

// Cuánto mira hacia atrás la PRIMERA vez (sin marca guardada). Corto a propósito:
// al encender esto no tiene sentido avisar de todo lo que murió en agosto — eso ya
// se sabe, y llenar el primer aviso de historia vieja es la mejor forma de que se
// aprenda a ignorarlo.
const VENTANA_INICIAL_MIN = 60

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const keyQ = new URL(req.url).searchParams.get('key')
  // Mismo criterio que /api/cron/pendientes: con secreto configurado manda el
  // secreto —que Vercel manda solo en los crons de verdad—; sin secreto, la
  // cabecera `x-vercel-cron` es lo único que hay.
  if (secret) return auth === `Bearer ${secret}` || keyQ === secret
  return req.headers.get('x-vercel-cron') != null
}

/**
 * Mantiene al día `conversaciones.bsuid`: el identificador con el que Meta va a
 * reemplazar al número de teléfono cuando la gente use nombre de usuario.
 *
 * ☠️ VA ACÁ, EN UN CRON, Y NO EN EL WEBHOOK, A PROPÓSITO. La restricción es que
 * no se toca ni recibir ni enviar. El BSUID viaja dentro de `mensajes.raw`, que
 * se guarda sin límite de retención, así que rellenarlo media hora después queda
 * EXACTAMENTE igual de completo que hacerlo al vuelo — sin poner código nuevo en
 * el camino por donde entran los mensajes de los clientes.
 *
 * Nunca puede tumbar este cron: va aparte y su fallo solo se registra.
 */
async function rellenarBsuid() {
  try {
    const { data, error } = await getSupabase().rpc('rellenar_bsuid', { p_dias: 3 })
    if (error) throw error
    return { ok: true, filas: data ?? 0 }
  } catch (err) {
    console.error('[cron/entregas] rellenarBsuid:', err.message)
    return { ok: false, motivo: err.message }
  }
}

/**
 * Sostiene la invariante que hace que el CONTADOR de cada botón pueda leerse de
 * `inbox.bandeja` —14 ms en vez de 1.627— sin dejar de coincidir con la lista:
 * toda conversación con mensajes en un canal tiene su fila en `bandeja`.
 *
 * ⚠️ Si alguna faltara, la lista la mostraría PENDIENTE (por el COALESCE de
 * `lista_bandeja`) y el contador NO la contaría. Un chat sin contestar que no
 * sale en el contador es justo lo que rompe la garantía de Rodrigo: "si esa
 * bandeja está vacía, contesté a todos". Por eso se garantiza y no se confía.
 *
 * Hoy no falta ninguna: el webhook ya crea la fila de cada mensaje nuevo. Esto
 * es la red, no el mecanismo.
 */
async function completarBandeja() {
  try {
    const { data, error } = await getSupabase().rpc('completar_bandeja')
    if (error) throw error
    return { ok: true, creadas: data ?? 0 }
  } catch (err) {
    console.error('[cron/entregas] completarBandeja:', err.message)
    return { ok: false, motivo: err.message }
  }
}

export async function GET(req) {
  if (!autorizado(req)) {
    // Un cron que empieza a dar 401 en silencio es un cron muerto que parece vivo.
    console.error('[cron/entregas] 401: llamada sin autorización válida')
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  try {
    // Va PRIMERO y fuera del camino del aviso: este cron tiene dos salidas
    // (con fallidos y sin fallidos) y colgarlo de una sola lo dejaría corriendo
    // la mitad de las veces, sin que nadie lo note.
    const bsuid = await rellenarBsuid()
    const bandeja = await completarBandeja()

    const marca = await getMarcaAvisoFallidosSupabase()
    const desde = marca || new Date(Date.now() - VENTANA_INICIAL_MIN * 60000).toISOString()

    const filas = await getEntregasFallidasSupabase(desde)
    const grupos = agruparFallos(filas)
    const texto  = textoAvisoFallidos(grupos, { canales: CANALES, baseUrl: BASE_URL })

    // La marca se mueve SIEMPRE que haya filas, se haya podido avisar o no.
    //
    // Si se moviera solo tras un envío exitoso, un Telegram caído acumularía
    // fallos y al volver mandaría un aviso gigante con cosas de horas atrás. Y si
    // no se moviera nunca sin avisar, el mismo fallo se repetiría cada media hora
    // para siempre. Se mueve al fallo más reciente que se alcanzó a mirar.
    const ultima = filas.reduce((max, f) => (f.fecha > max ? f.fecha : max), desde)

    if (!texto) {
      // Nada que avisar. NO se manda un "todo bien" periódico: un aviso vacío que
      // llega cada media hora entrena a ignorarlos justo el día que trae algo.
      await setMarcaAvisoFallidosSupabase(ultima)
      return NextResponse.json({ ok: true, fallidos: 0, desde, bsuid, bandeja })
    }

    const envio = await enviarTelegram(texto)
    // ⚠️ Se mira el resultado. `fetch` no lanza con 4xx/5xx, así que un token
    // vencido se vería idéntico a un envío bueno — que es exactamente cómo este
    // aviso se moriría en silencio, igual que lo que vino a vigilar.
    if (!envio.ok) {
      console.error('[cron/entregas] NO se pudo avisar:', envio.motivo,
        `— ${filas.length} entregas fallidas sin reportar desde ${desde}`)
    }
    await setMarcaAvisoFallidosSupabase(ultima)

    return NextResponse.json({
      ok: true,
      fallidos: filas.length,
      clientes: grupos.length,
      avisado: envio.ok,
      motivo: envio.ok ? undefined : envio.motivo,
      telegram: telegramConfigurado(),
      desde,
      bsuid,
      bandeja,
    })
  } catch (err) {
    console.error('[cron/entregas]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
