import { NextResponse } from 'next/server'
import { getContactos, marcarAvisoTelegram } from '@/lib/contactos'
import { enviarTelegram, telegramConfigurado } from '@/lib/telegram'
import { enHorarioLaboral, esHoraDeResumen, urgentesSinAvisar, textoUrgente, textoResumen } from '@/lib/pendientes'
import { autorizadoCron } from '@/lib/cron-auth'

// Resumen de chats sin contestar, por Telegram. Lo llama Vercel Cron cada
// 5 min (ver vercel.json).
//
// Por qué existe, además del push: el push avisa de un EVENTO (entró un mensaje).
// Si te lo perdiste, se perdió. Esto avisa de un ESTADO (hay gente esperando) e
// insiste cada hora hasta que la bandeja quede vacía. El 12-ago-2026 había 12
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

// Quién puede disparar este cron: una sola regla para todos (lib/cron-auth.js).
const autorizado = (req) => autorizadoCron(req)

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

  // Los contactos internos (equipo, taller, proveedores) no cuentan como clientes
  // esperando (port desde IND, diseño 2026-09-22).
  const clientes = contactos.filter(c => c.tipoContacto !== 'interno')

  if (!enHorarioLaboral(ahora)) {
    console.log('[cron/pendientes] nada que avisar (fuera-de-horario)')
    return NextResponse.json({ ok: true, avisados: 0, motivo: 'fuera-de-horario' })
  }

  // Dos clases de aviso (25-oct-2026, antes era uno por chat cada 30 min y se
  // encadenaban casi cada 5 min):
  //   · a la hora en punto, un RESUMEN con todos los pendientes por urgencia;
  //   · entre resúmenes, un aviso solo cuando alguien cruza los 30 min, una vez.
  const resumen = esHoraDeResumen(ahora)
  const urgentes = urgentesSinAvisar(clientes, ahora)
  const texto = resumen ? textoResumen(clientes, ahora, BASE_URL) : textoUrgente(urgentes, ahora, BASE_URL)
  const tipo = resumen ? 'resumen' : 'urgentes'

  if (!texto) {
    console.log(`[cron/pendientes] nada que avisar (${tipo})`)
    return NextResponse.json({ ok: true, avisados: 0, tipo, motivo: 'sin-pendientes' })
  }

  if (!telegramConfigurado()) {
    // Desplegado y mudo. Se reporta para que el silencio sea VISIBLE en los
    // registros: un cron que no manda nada tiene que poder distinguirse de un
    // cron que no corre.
    console.log(`[cron/pendientes] ${tipo} listo, Telegram sin configurar`)
    return NextResponse.json({ ok: true, avisados: 0, tipo, motivo: 'sin-config' })
  }

  const r = await enviarTelegram(texto)
  if (!r.ok) {
    // NO se estampa la marca si el envío falló: así el próximo ciclo reintenta.
    console.error('[cron/pendientes] Telegram falló:', r.motivo)
    return NextResponse.json({ ok: false, avisados: 0, tipo, motivo: r.motivo })
  }

  // Se marcan los urgentes también cuando salió el resumen: ya los nombró, así
  // que no merecen un aviso aparte a los 5 min. Con await: sin await la función
  // se congela antes del update y el aviso se repetiría en cada corrida.
  for (const c of urgentes) {
    await marcarAvisoTelegram(c.telefono).catch((e) =>
      console.error('[cron/pendientes] marcar', c.telefono, e?.message || e))
  }

  return NextResponse.json({ ok: true, tipo, urgentes: urgentes.length })
}
