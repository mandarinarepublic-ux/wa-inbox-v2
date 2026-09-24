// lib/automatizaciones.js — Config de automatizaciones del inbox (por cuenta).
// Vive en Supabase (inbox.automatizaciones, una fila por cuenta, columna config jsonb).
// SOLO server-side. Pensado para ir sumando reglas sin migraciones: todo es JSON.
import { getSupabase, CUENTA, supabaseConfigurado } from './supabase.js'

// Defaults si la fila/campo no existe todavía. Los saludos arrancan APAGADOS.
export const DEFAULTS = {
  saludo_nuevo: {
    activo: false,
    texto: '¡Hola! 🧡 Bienvenid@ a Mandarina. Cuéntame, ¿qué estás buscando? Con gusto te ayudo 😊',
  },
  saludo_reactivacion: {
    activo: false,
    horas: 12,
    texto: '¡Hola de nuevo! 🧡 Qué gusto tenerte por aquí otra vez. ¿En qué puedo ayudarte hoy?',
  },
  // Seguimiento automático por TEMPERATURA del lead (Eje 2). Lo dispara el cron
  // (/api/cron/seguimientos) según las horas de SILENCIO del cliente, SIEMPRE dentro de
  // la ventana de 24h de Meta (pasadas las 24h ya no se manda gratis → plantilla, fase 2).
  // Arranca TODO APAGADO: nada sale hasta que el humano lo prenda en la pestaña AUTOS.
  // Tope: 1 auto-envío por ventana por contacto; se cancela solo si el cliente responde.
  seguimientos: {
    activo: false,          // interruptor global
    solo_ia_apagada: true,  // solo chats con la IA apagada (para no chocar con el agente)
    // 🔥 caliente: primero te AVISA a ti (alerta) a las alerta_horas; si no actúas, a las
    // "horas" el cron manda un "sujeta-ventana" para no perder las 24h.
    caliente: { activo: false, alerta_horas: 20, horas: 23,
      texto: 'Hola 🧡 ¿Seguimos con tu pedido? Estoy aquí para ayudarte a cerrarlo cuando quieras 😊' },
    // 🌤️ tibio: un seguimiento suave a media ventana.
    tibio:    { activo: false, horas: 12,
      texto: '¡Hola! 🧡 ¿Pudiste pensarlo? Cuéntame si te ayudo con alguna talla, color o el envío 😊' },
    // ❄️ frío: último toque antes de cerrar la ventana (opcional).
    frio:     { activo: false, horas: 22,
      texto: '¡Hola! 🧡 Pasaba a saludarte por si aún te interesa. Cualquier cosa, aquí estoy 😊' },
  },
  // 🔄 REACTIVACIÓN por etapa (port desde IND, 23-sep-2026; lib/reactivacion.js):
  // le escribe solo a un cliente en 💬/💳 que se quedó callado después del mensaje
  // de una PERSONA, a las `horas` de su último mensaje (un texto por toque y por
  // etapa), nunca de 22:00 a 08:00, nunca con 📌, 🤫, pedido, contacto interno ni si
  // el agente lleva el chat. APAGADA: la prende una persona en la pestaña AUTOS.
  // Se guarda el bloque COMPLETO (merge de un nivel). Los textos de 💬 son los tres
  // de los seguimientos por temperatura que tenía Rodrigo (retirados en la etapa 2).
  reactivacion: {
    activo: false,
    horas: [3, 12, 20],   // toques, en horas desde el último mensaje del cliente
    silencio_min_h: 3,    // nunca antes de esto desde que escribió una persona
    entre_toques_h: 4,    // separación mínima entre toques
    hora_desde: 8,        // horario permitido (Ecuador); acotado a 06:00–22:00
    hora_hasta: 22,
    textos: {
      cotizando: [
        '¡Hola {nombre}! 🧡 ¿Pudiste pensarlo? Cuéntame si te ayudo con alguna talla, color o el envío 😊',
        'Hola {nombre} 🧡 ¿Seguimos con tu pedido? Estoy aquí para ayudarte a cerrarlo cuando quieras 😊',
        '¡Hola {nombre}! 🧡 Pasaba a saludarte por si aún te interesa. Cualquier cosa, aquí estoy 😊',
      ],
      esperando_pago: [
        '¡Hola {nombre}! 🧡 ¿Pudiste hacer la transferencia? Apenas me mandes el comprobante dejo listo tu pedido 😊',
        '¡Buen día {nombre}! ☀️ Tu pedido está listo para pasar a producción apenas confirmes el pago 🧡',
        'Hola {nombre} 🧡 te escribo antes de que se cierre nuestro chat. ¿Te ayudo con algo del pago?',
      ],
    },
  },
  // CORTAFUEGOS de MANDI AGENT, uno por número. Llave = id LÓGICO del canal
  // (lib/canales.js), no el phone_id: el phone_id cambia si el número se migra de
  // cuenta y el interruptor quedaría huérfano.
  //
  // Booleano plano y no {activo}: merge() es de UN nivel, así que un patch anidado
  // borraría los hermanos (la mina que ya documenta el handoff para
  // seguimientos.caliente).
  //
  // Arranca PRENDIDO a propósito: a diferencia de los saludos y seguimientos —que
  // arrancan apagados porque MANDAN mensajes nuevos— esto solo deja de bloquear.
  // Si arrancara apagado, el deploy mataría el bot en silencio.
  ia: { MANDI: true, REPUBLIC: true },
  // RECETAS DE BIENVENIDA por anuncio (14-sep-2026). Ver
  // docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md.
  //   lista:       [{ id, nombre, activa, pasos:[{tipo:'respuesta', respuestaId}], pregunta:{texto, botones:[{title}]}|null }]
  //   por_anuncio: { [source_id]: recetaId, organico: recetaId }
  // Arranca APAGADO y sin recetas: sin receta asignada NO sale nada (decisión del dueño).
  // ⚠️ merge() es de UN nivel: `lista` y `por_anuncio` se guardan COMPLETOS desde la pantalla.
  recetas: { activo: false, lista: [], por_anuncio: {} },
  // FLUJOS (15-sep-2026). Ver docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md.
  // INTERRUPTOR GENERAL de TODOS los flujos publicados: apagado acá, el webhook
  // ni siquiera lee la tabla y ningún flujo manda nada — sin tener que entrar a
  // despublicarlos de a uno (que además perdería cuál estaba publicado y cuál no).
  // Es el botón de pánico del motor nuevo y el camino de vuelta al viejo:
  // flujos.activo=false + recetas.activo=true devuelve las recetas, sin deploy.
  //
  // Arranca PRENDIDO: un flujo solo corre si alguien lo publicó a mano, así que
  // esto no enciende nada por su cuenta; si arrancara apagado, el deploy dejaría
  // mudos en silencio los flujos ya publicados.
  //
  // Un solo nivel de profundidad a propósito: merge() es de UN nivel y un bloque
  // anidado se pisaría entero al mandar un patch parcial.
  flujos: { activo: true },
}

// Merge superficial por bloque (no pisa un bloque entero si el patch trae solo un campo).
export function merge(base, patch) {
  const out = { ...base }
  for (const k of Object.keys(patch || {})) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
      out[k] = { ...(base?.[k] || {}), ...patch[k] }
    } else {
      out[k] = patch[k]
    }
  }
  return out
}

/** Lee la config de la cuenta, ya fusionada con los defaults. Nunca lanza. */
export async function getAutomatizaciones() {
  if (!supabaseConfigurado()) return { ...DEFAULTS }
  try {
    const sb = getSupabase()
    const { data, error } = await sb.from('automatizaciones').select('config').eq('cuenta', CUENTA).maybeSingle()
    // Supabase no lanza: devuelve {data, error}. Si se ignora el error, un bache
    // de Supabase se disfraza de "fila vacía" y esta función responde con los
    // DEFAULTS (ia:{MANDI:true,REPUBLIC:true} → bot PRENDIDO) sin dejar rastro:
    // el dueño ve DETENIDO en pantalla mientras el bot vuelve a contestar solo.
    if (error) {
      console.error('[automatizaciones] consulta con error, usando DEFAULTS (IA PRENDIDA):', error.message)
    }
    return merge(DEFAULTS, data?.config || {})
  } catch (e) {
    console.error('[automatizaciones] lectura falló:', e.message)
    return { ...DEFAULTS }
  }
}

/** Guarda un patch (merge sobre lo existente). Devuelve la config resultante. */
export async function setAutomatizaciones(patch) {
  const sb = getSupabase()
  const actual = await getAutomatizaciones()
  const nueva = merge(actual, patch || {})
  const { error } = await sb
    .from('automatizaciones')
    .upsert({ cuenta: CUENTA, config: nueva, updated_at: new Date().toISOString() }, { onConflict: 'cuenta' })
  if (error) throw error
  return nueva
}
