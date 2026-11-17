// lib/responder-ia.js — Llamar al agente y mandar su respuesta al cliente.
//
// Vive acá y no dentro del webhook porque hay DOS orígenes: un mensaje entrante
// (source 'webhook') y el cron de seguimientos despertando al bot en un chat
// callado (source 'seguimiento'). El agente distingue por ese campo.
//
// Copiar este código en vez de compartirlo es lo que produjo el bug de las fotos
// saliendo por el número equivocado — y acá el trozo duplicado decidiría QUÉ se le
// manda a un cliente.

// ── Agente IA (mandi-agent) — reemplaza el módulo HTTP que llamaba Make ────────
// El agente NO envía el WhatsApp: DEVUELVE el texto. Nosotros lo enviamos por
// /api/saliente (que además lo registra en MENSAJES). Solo si el contacto tiene ModoIA="IA".
import { getRespuestas } from './respuestas.js'
import { updateDeuda } from './contactos.js'
import { piezasDeRespuestaRapida } from './pieza-respuesta.js'

const AGENT_URL = process.env.MANDI_AGENT_URL || 'https://mandi-agent.vercel.app/api/agent'

// ⚠️ SIN respaldo quemado, a propósito. Acá vivía `|| 'mandi_republic_2024'`, y
// como este repo es PÚBLICO esa era la clave de producción del agente publicada
// en GitHub: cualquiera podía llamar a la IA y quemar créditos de Anthropic.
// Rotada el 8-ago-2026.
//
// Si la variable falta, el valor queda vacío y el agente responde 401: se deja de
// contestar, pero NO se abre la puerta. Es la falla correcta de las dos posibles.
const AGENT_KEY = String(process.env.MANDI_AGENT_KEY || '').replace(/[^\x21-\x7E]/g, '')

// Regex de URLs de imagen (mismas extensiones que extrae el agente).
const RE_IMG = /https?:\/\/[^\s)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/gi

// Envía un mensaje (texto o imagen) por /api/saliente, que lo manda a Meta y lo
// registra en MENSAJES.
// `auto: true` marca que el envío NO lo hizo un humano (IA, saludo automático,
// LINKPAGO). /api/saliente lo usa para no reiniciar el enfriamiento del aviso push:
// si la IA está llevando el chat, no hay que empezar a interrumpir al humano.
//
// `Canal` es OBLIGATORIO: el número por el que responder es aquel al que el
// cliente escribió. Sin él, /api/saliente cae al número principal y el cliente
// que escribió a REPUBLIC recibe la respuesta desde MANDI (otro número).
// ☠️ El 7-ago-2026 se encendió el candado (`AUTH_MODO=bloquear`) y esta llamada
// quedó SIN credencial: `/api/saliente` no es ruta pública, así que empezó a
// devolver 401 y se murieron EN SILENCIO todos los envíos automáticos —
// LINKPAGO, los saludos y el mensaje de espera. Nadie se enteró en 7 días porque
// el `.catch` de abajo solo miraba errores de RED, y un 401 no es un error de red:
// `fetch` lo devuelve como una respuesta normal con `ok:false`.
// Medido el 14-ago: 4 LINKPAGO el 7-ago, CERO del 8 en adelante.
//
// El middleware ya tenía la puerta para máquinas; lo que faltaba era la llave.
// Se limpia igual que del otro lado: el middleware compara largos primero, así
// que un BOM invisible haría fallar la comparación sin decir por qué.
const TOKEN_MAQUINA = String(process.env.INBOX_API_TOKEN || '').replace(/[^\x21-\x7E]/g, '')

export async function enviarSaliente(origin, body) {
  try {
    const res = await fetch(`${origin}/api/saliente`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN_MAQUINA ? { Authorization: `Bearer ${TOKEN_MAQUINA}` } : {}),
      },
      body: JSON.stringify({ ...body, auto: true }),
    })
    // Mirar `res.ok` es el punto de todo esto: sin esta línea, el próximo 401
    // vuelve a morirse callado y volvemos a tardar una semana en verlo.
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.error(
        `[webhook] /api/saliente rechazó el envío automático: ${res.status}`,
        res.status === 401 ? '— falta o no coincide INBOX_API_TOKEN' : detalle.slice(0, 200),
      )
    }
    return res
  } catch (e) {
    console.error('[webhook] envío automático falló por red:', e?.message || e)
  }
}

// Lo mismo que enviarSaliente, pero para Instagram/Facebook (/api/social/saliente).
// `auto: true` hace que el saliente NO marque la conversación como atendida:
// ningún automatismo saca un chat de Pendientes.
export async function enviarSocialAuto(origin, body) {
  try {
    const res = await fetch(`${origin}/api/social/saliente`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN_MAQUINA ? { Authorization: `Bearer ${TOKEN_MAQUINA}` } : {}),
      },
      body: JSON.stringify({ ...body, auto: true }),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.error(`[social auto] /api/social/saliente rechazó: ${res.status}`,
        res.status === 401 ? '— falta o no coincide INBOX_API_TOKEN' : detalle.slice(0, 300))
    }
    return res
  } catch (e) {
    console.error('[social auto] envío falló por red:', e?.message || e)
  }
}

/**
 * Le pregunta al agente qué responder. NO envía nada: devuelve lo que el agente
 * decidió, o null si falló. Separado del envío porque hay dos usos:
 *   · responderConIA → lo envía al cliente
 *   · modo SOMBRA (webhook) → lo guarda en inbox.ia_sombra para revisarlo, sin enviar
 */
export async function consultarAgente(phone, name, message, source = 'webhook') {
  const t0 = Date.now()
  try {
    const r = await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mandi-key': AGENT_KEY },
      body: JSON.stringify({ phone, name: name || '', message, source }),
      signal: AbortSignal.timeout(25000),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('[webhook IA] agente', r.status, data?.error || '')
      return { ok: false, error: `HTTP ${r.status} ${data?.error || ''}`.trim(), ms: Date.now() - t0 }
    }
    const reply = String(data?.reply_clean || data?.reply || '').trim()
    // Fotos que el agente incluyó en su respuesta (URLs en el texto).
    let imagenes = Array.isArray(data?.imagenes) ? data.imagenes.filter(Boolean) : []
    if (!imagenes.length) imagenes = reply.match(RE_IMG) || []
    imagenes = [...new Set(imagenes)]
    // Se quitan del texto para NO mandar links crudos: cada una sale como foto real.
    let texto = reply
    for (const u of imagenes) texto = texto.split(u).join('')
    texto = texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return {
      ok: true, texto, imagenes,
      // Ids de respuestas rápidas que el agente eligió mandar (v5, 17-nov-2026).
      respuestasRapidas: (Array.isArray(data?.respuestas_rapidas) ? data.respuestas_rapidas : []).map(String).filter(Boolean),
      derivar: String(data?.derivar || '').trim(),
      // Etapa de la venta que detectó el agente (interes, modelo, talla, datos, pago…).
      etapa: String(data?.etapa || '').trim(),
      tools: String(data?.tool_used || ''), modelo: String(data?.modelo || ''),
      tokensIn: Number(data?.tokens?.input) || 0, tokensOut: Number(data?.tokens?.output) || 0,
      ms: Date.now() - t0,
    }
  } catch (e) {
    console.error('[webhook IA] agente falló:', e.message)
    return { ok: false, error: e.message, ms: Date.now() - t0 }
  }
}

// Devuelve true cuando de verdad se INTENTO mandar algo al cliente (una respuesta
// rápida, texto y/o foto llegaron a enviarSaliente), false en cualquier otro caso.
// Ojo: "true" es "se intento el envio", NO "WhatsApp lo entrego".
// El webhook no mira este valor; el cron de seguimientos sí, para no marcar un
// seguimiento como hecho cuando no se le mandó nada al cliente.
//
// Orden de envío: 1) respuestas rápidas que eligió el agente, completas (texto,
// botones, carrusel, formulario, fotos); 2) su texto propio; 3) fotos de producto.
export async function responderConIA(origin, phone, name, message, canal, source = 'webhook', citaId = '') {
  const d = await consultarAgente(phone, name, message, source)
  if (!d?.ok) return false
  let intentado = false
  const contacto = { telefono: phone, nombre: name || '', alias: '', phoneId: canal }

  if (d.respuestasRapidas.length) {
    const todas = await getRespuestas().catch(() => [])
    for (const id of d.respuestasRapidas) {
      const r = todas.find(x => String(x.id) === id)
      if (!r) { console.warn('[webhook IA] el agente eligió una respuesta rápida que no existe:', id); continue }
      for (const p of piezasDeRespuestaRapida(r, contacto, intentado ? '' : citaId)) {
        await enviarSaliente(origin, p)
        intentado = true
      }
    }
  }
  if (d.texto) { await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', Mensaje: d.texto, Canal: canal }); intentado = true }
  for (const url of d.imagenes) { await enviarSaliente(origin, { Telefono: phone, Nombre: name || '', ImagenURL: url, Canal: canal }); intentado = true }

  // El agente pidió una persona: queda el 📌 para que alguien cumpla. No pisa el
  // del vendedor y NO saca el chat de Pendientes.
  if (d.derivar) {
    await updateDeuda(phone, `IA: ${d.derivar}`, 'ia', { noPisar: true })
      .catch(e => console.error('[webhook IA] 📌 derivación:', e.message))
  }
  return intentado
}
