// lib/bloqueo-cuenta.js — cuando Meta frena TODOS los envíos, se avisa AL INSTANTE.
//
// ⚠️ POR QUÉ EXISTE: el 17-oct y el 6-nov-2026 IND se quedó sin enviar por un pago
// pendiente a Meta (131042). El aviso existía, pero salía del cron de cada 30 min y
// a un chat mezclado; el panel de conexiones seguía en verde hasta su revisión de
// las 15:00, y los vendedores siguieron mandando mensajes que no llegaban a nadie.
//
// Cómo funciona:
//   - El PRIMER fallo de cuenta crea una fila en `inbox.app_config`. Esa fila es a
//     la vez el candado (un solo aviso aunque fallen 50 seguidos) y lo que prende
//     el banner rojo del inbox.
//   - El primer `sent` POSTERIOR al bloqueo la borra: ese es el único dato que
//     prueba que Meta volvió a aceptar. Un `delivered` o `read` no sirve, porque
//     pueden ser de mensajes viejos que se entregan tarde.
//
// Nada de este archivo lanza: nunca puede tumbar la recepción ni un envío.
import { getSupabase, CUENTA } from './supabase.js'
import { env } from './env.js'
import { enviarAlerta } from './telegram.js'
import { marcarConexionWhatsapp } from './eventos-sistema.js'
import { esFalloDeCuenta, motivoLegible } from './entregas-fallidas.js'

const CLAVE = `bloqueo_cuenta_${CUENTA}`

const db = {
  async leer() {
    const { data, error } = await getSupabase().from('app_config').select('valor').eq('clave', CLAVE).maybeSingle()
    if (error) throw error
    return data?.valor ?? null
  },
  // Devuelve true solo a quien la creó: así dos fallos simultáneos no avisan dos veces.
  async crearSiNoExiste(valor) {
    const { data, error } = await getSupabase().from('app_config')
      .upsert({ clave: CLAVE, valor }, { onConflict: 'clave', ignoreDuplicates: true })
      .select('clave')
    if (error) throw error
    return Boolean(data?.length)
  },
  // Igual: solo quien de verdad la borró manda el "ya volvió".
  async borrar() {
    const { data, error } = await getSupabase().from('app_config').delete().eq('clave', CLAVE).select('clave')
    if (error) throw error
    return Boolean(data?.length)
  },
}

const reales = () => ({ db, avisar: enviarAlerta, panel: marcarConexionWhatsapp, ahora: () => new Date() })

function leerValor(valor) {
  try { return valor ? JSON.parse(valor) : null } catch { return null }
}

/** El bloqueo vigente, para el banner. `null` si los envíos están normales. */
export async function bloqueoVigente(deps = reales()) {
  const b = leerValor(await deps.db.leer())
  return b ? { codigo: b.codigo, desde: b.desde, motivo: motivoLegible(b.codigo) } : null
}

/** Registra un fallo de cuenta y avisa solo si es el primero. */
export async function registrarBloqueo(codigo, deps = reales()) {
  try {
    if (!esFalloDeCuenta(codigo)) return { bloqueo: false }
    const n = Number(codigo)
    const valor = JSON.stringify({ codigo: n, desde: deps.ahora().toISOString() })
    if (!await deps.db.crearSiNoExiste(valor)) return { bloqueo: true, nuevo: false }

    const motivo = motivoLegible(n)
    await deps.panel('rojo', `🛑 NO sale ningún mensaje de ${CUENTA}: ${motivo}`)
    const envio = await deps.avisar(
      `🛑 <b>${CUENTA}: NO ESTÁ SALIENDO NINGÚN MENSAJE</b>\n${motivo}\n\n` +
      `Los mensajes que fallen NO se reenvían solos: después de arreglarlo hay que mandarlos otra vez.`
    )
    // Un aviso que no se sabe si llegó no es un aviso.
    if (!envio?.ok) console.error('[bloqueo-cuenta] NO se pudo avisar:', envio?.motivo)
    return { bloqueo: true, nuevo: true, avisado: Boolean(envio?.ok) }
  } catch (e) {
    console.error('[bloqueo-cuenta] registrar:', e.message)
    return { error: e.message }
  }
}

/** Con un `sent` posterior al bloqueo, lo da por terminado. `segundos` = timestamp de Meta. */
export async function liberarBloqueo(segundos, deps = reales()) {
  try {
    const b = leerValor(await deps.db.leer())
    if (!b) return { liberado: false }
    if (!(Number(segundos) * 1000 > Date.parse(b.desde))) return { liberado: false }
    if (!await deps.db.borrar()) return { liberado: false }

    await deps.panel('verde', `Los envíos de ${CUENTA} volvieron a salir.`)
    const envio = await deps.avisar(
      `✅ <b>${CUENTA}: los mensajes volvieron a salir</b>\n` +
      `Meta aceptó un envío de nuevo. Los que fallaron durante el bloqueo siguen sin llegar: hay que mandarlos otra vez.`
    )
    if (!envio?.ok) console.error('[bloqueo-cuenta] NO se pudo avisar la vuelta:', envio?.motivo)
    return { liberado: true }
  } catch (e) {
    console.error('[bloqueo-cuenta] liberar:', e.message)
    return { error: e.message }
  }
}

/**
 * Recibe los `value.statuses[]` crudos del webhook.
 * ⚠️ Solo toca la base si hay un `failed` de cuenta o un `sent`: `delivered` y `read`
 * son la mayoría de los acuses y esta es la ruta con más tráfico del inbox.
 */
export async function procesarEstadosCuenta(statuses, deps = reales()) {
  for (const s of statuses || []) {
    const codigo = s?.errors?.[0]?.code
    if (s?.status === 'failed' && esFalloDeCuenta(codigo)) await registrarBloqueo(codigo, deps)
  }
  const sent = (statuses || []).filter(s => s?.status === 'sent').map(s => Number(s.timestamp)).filter(Boolean)
  if (sent.length) await liberarBloqueo(Math.max(...sent), deps)
}

/** Días que le quedan al token según Meta. `null` si no caduca nunca. */
export function diasParaVencer(expiraSegundos, ahoraMs = Date.now()) {
  const e = Number(expiraSegundos)
  return e > 0 ? Math.floor((e * 1000 - ahoraMs) / 86_400_000) : null
}

const DIAS_DE_AVISO = 10

/**
 * Lo corre el cron diario. ☠️ El META_TOKEN de IND ya se cayó en silencio el 10-sep
 * por ser de 60 días, y Meta no avisa antes. Avisa cada día desde 10 días antes.
 */
export async function revisarVencimientoToken({ fetcher = fetch, avisar = enviarAlerta } = {}) {
  try {
    const token = env('META_TOKEN')
    if (!token) return { omitido: 'sin-token' }
    const res = await fetcher(`https://graph.facebook.com/v19.0/debug_token?input_token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const cuerpo = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Un error de red o de Meta aquí NO significa token vencido: solo se registra.
      console.error('[token] Meta no respondió:', res.status, cuerpo?.error?.code)
      return { ok: false, status: res.status, codigo: cuerpo?.error?.code }
    }
    const dias = diasParaVencer(cuerpo?.data?.expires_at)
    console.log('[token]', CUENTA, dias === null ? 'no caduca' : `vence en ${dias} días`)
    if (dias !== null && dias <= DIAS_DE_AVISO) {
      const envio = await avisar(
        `⏰ <b>${CUENTA}: el token de WhatsApp vence en ${Math.max(dias, 0)} días</b>\n` +
        `Cuando venza no saldrá ningún mensaje. Genera uno con caducidad "Nunca" en ` +
        `Business Settings → Usuarios del sistema y cárgalo en Vercel.`
      )
      if (!envio?.ok) console.error('[token] NO se pudo avisar:', envio?.motivo)
    }
    return { ok: true, dias }
  } catch (e) {
    console.error('[token]', e.message)
    return { ok: false, motivo: e.message }
  }
}
