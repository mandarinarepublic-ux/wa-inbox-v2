import { NextResponse } from 'next/server'
import { getContactos, marcarAvisoTelegram } from '@/lib/contactos'
import { enviarTelegram, telegramConfigurado } from '@/lib/telegram'
import { chatsQueAvisar, textoAviso, enHorarioLaboral } from '@/lib/pendientes'

// Recordatorio de chats sin contestar, por Telegram. Lo llama Vercel Cron cada
// 5 min (ver vercel.json).
//
// Por qué existe, además del push: el push avisa de un EVENTO (entró un mensaje).
// Si te lo perdiste, se perdió. Esto avisa de un ESTADO (hay gente esperando) e
// insiste cada 30 min hasta que la bandeja quede vacía. El 12-ago-2026 había 12
// chats pendientes en MANDI y el más viejo llevaba 31 horas: todos habían
// disparado su push, y todos se habían apagado.
//
// Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no manda nada y no rompe nada.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// El link tiene que apuntar SIEMPRE al dominio real. `req.url` en una invocacion de
// cron trae la URL del despliegue (wa-inbox-v2-xxxx.vercel.app), donde NO existe la
// cookie de sesion: tocar ese link desde el celular te deja fuera del inbox. Medido
// en produccion el 13-ago-2026, con los avisos ya andando.
// Se puede sobreescribir con INBOX_URL sin tocar codigo.
const BASE_URL = String(process.env.INBOX_URL || 'https://inbox.apps.mandarinaec.com')
  .replace(/[^\x21-\x7E]/g, '')   // por si la variable llega con BOM desde PowerShell
  .replace(/\/+$/, '')            // sin barra final: el link ya la pone

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const keyQ = new URL(req.url).searchParams.get('key')
  // ⚠️ La cabecera `x-vercel-cron` NO alcanza por sí sola cuando hay secreto: no
  // está documentada como imposible de falsificar, y aceptarla primero dejaba la
  // ruta abierta a cualquiera que supiera el path. Con secreto configurado manda
  // el secreto —que Vercel manda solo en los crons de verdad—; sin secreto, la
  // cabecera es lo único que hay y ahí sí vale.
  if (secret) return auth === `Bearer ${secret}` || keyQ === secret
  return req.headers.get('x-vercel-cron') != null
}

export async function GET(req) {
  if (!autorizado(req)) {
    // Si algún día Vercel deja de mandar el Authorization esperado, esto tiene
    // que quedar en los registros: un cron que empieza a dar 401 en silencio es
    // la misma clase de falla que este cron entero vino a matar. Nunca el valor
    // del secreto, solo si estaba configurado.
    const traeCabeceraCron = req.headers.get('x-vercel-cron') != null
    const haySecreto = Boolean(process.env.CRON_SECRET)
    console.error(`[cron/pendientes] no autorizado — x-vercel-cron: ${traeCabeceraCron}, CRON_SECRET configurado: ${haySecreto}`)
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const ahora = Date.now()

  // ⚠️ `getContactos(null)` con el null EXPLÍCITO, nunca `getContactos()`.
  // La firma es `getContactosSupabase(canal = canalPorDefecto())`: sin argumento
  // filtra por el phone_id de MANDI y las conversaciones de REPUBLIC quedarían
  // INVISIBLES para el recordatorio — pendientes reales que nadie ve, que es
  // justo el bug que este cron viene a matar. `null` apaga el filtro
  // (`lib/inbox-supabase.js:68`) y trae los dos números de la cuenta.
  const contactos = await getContactos(null).catch((e) => {
    console.error('[cron/pendientes] no se pudo leer contactos:', e?.message || e)
    return null
  })
  if (!contactos) {
    return NextResponse.json({ ok: false, error: 'sin contactos' }, { status: 500 })
  }

  const aAvisar = chatsQueAvisar(contactos, ahora)
  if (!aAvisar.length) {
    // `sin-pendientes` cubre bandeja vacía de verdad Y todo lo que está dentro del
    // enfriamiento de 30 min — ambos son "no toca avisar todavía". `fuera-de-horario`
    // es la otra causa posible (fuera de 08:00-21:00 Ecuador). Sin distinguirlas,
    // Rodrigo llama la ruta de noche, ve ceros, y no sabe si está sana o rota.
    const motivo = enHorarioLaboral(ahora) ? 'sin-pendientes' : 'fuera-de-horario'
    console.log(`[cron/pendientes] nada que avisar (${motivo})`)
    return NextResponse.json({ ok: true, avisados: 0, pendientes: 0, motivo })
  }

  if (!telegramConfigurado()) {
    // Desplegado y mudo. Se reporta para que el silencio sea VISIBLE en los
    // registros: un cron que no manda nada tiene que poder distinguirse de un
    // cron que no corre.
    console.log(`[cron/pendientes] ${aAvisar.length} pendientes, Telegram sin configurar`)
    return NextResponse.json({ ok: true, avisados: 0, pendientes: aAvisar.length, motivo: 'sin-config' })
  }

  const r = await enviarTelegram(textoAviso(aAvisar, ahora, BASE_URL))
  if (!r.ok) {
    // NO se estampa la marca si el envío falló: así el próximo ciclo reintenta.
    console.error('[cron/pendientes] Telegram falló:', r.motivo)
    return NextResponse.json({ ok: false, avisados: 0, pendientes: aAvisar.length, motivo: r.motivo })
  }

  // Recién ahora se marca, y con await: sin await la función serverless devuelve
  // la respuesta y se congela antes del update, y el aviso se repetiría cada 5
  // minutos para siempre.
  for (const c of aAvisar) {
    await marcarAvisoTelegram(c.telefono).catch((e) =>
      console.error('[cron/pendientes] marcar', c.telefono, e?.message || e))
  }

  return NextResponse.json({ ok: true, avisados: aAvisar.length, pendientes: aAvisar.length })
}
