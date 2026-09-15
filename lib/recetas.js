// lib/recetas.js — Recetas de bienvenida por anuncio. Módulo PURO (sin red ni base).
//
// Una receta es la lista ordenada de respuestas rápidas que Rodrigo manda a mano
// cuando alguien llega de un anuncio (medido: saludo → pitch → fotos, con 74 min
// de retraso). Acá se decide A QUIÉN le toca y QUÉ piezas salen; el webhook solo
// llama y envía. Ver docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md.
import { adjuntosDeRespuesta } from './adjuntos-respuesta.js'

export const VENTANA_RECETA_MS = 24 * 3600 * 1000
export const MAX_BOTONES = 3
export const MAX_TITULO = 20

/** [{title}] o ['título'] → [{ id, title }]: sin vacíos, 20 letras, máx 3 (límites de WhatsApp). */
export function normalizarBotones(lista) {
  const out = []
  for (const b of Array.isArray(lista) ? lista : []) {
    const title = String((b && typeof b === 'object') ? b.title : b || '').trim().slice(0, MAX_TITULO)
    if (!title) continue
    out.push({ id: `rc_${out.length + 1}`, title })
    if (out.length >= MAX_BOTONES) break
  }
  return out
}

/**
 * ¿A este entrante le toca una receta? Devuelve la receta o null.
 *  - Global apagado, anuncio sin receta, receta inactiva → null (sin receta NO sale nada).
 *  - Orgánico (sin sourceId) solo para contactos NUEVOS.
 *  - Si el bot va a contestar ese chat, se lo deja en paz.
 *  - Una receta por cliente por ventana de 24 h (contacto.ultimaRecetaAt).
 */
export function decidirReceta({ config, sourceId, esNuevo, contacto, botActivo, ahoraMs = Date.now() }) {
  const rc = config?.recetas
  if (!rc?.activo) return null
  if (botActivo) return null
  const sid = String(sourceId || '').trim()
  const recetaId = sid ? rc.por_anuncio?.[sid] : (esNuevo ? rc.por_anuncio?.organico : null)
  if (!recetaId) return null
  const receta = (Array.isArray(rc.lista) ? rc.lista : []).find(r => r?.id === recetaId)
  if (!receta || receta.activa === false) return null
  const ult = contacto?.ultimaRecetaAt ? new Date(contacto.ultimaRecetaAt).getTime() : 0
  if (ult && ahoraMs - ult < VENTANA_RECETA_MS) return null
  return receta
}

const pieza = (contacto, extra) => ({
  Telefono: contacto.telefono,
  Nombre: contacto.alias || contacto.nombre || '',
  Canal: contacto.phoneId,
  ...extra,
})

const interactivo = (texto, botones) => ({
  TipoMensaje: 'interactive_buttons',
  Cuerpo: texto,
  Botones: JSON.stringify(botones.map(({ id, title }) => ({ type: 'reply', reply: { id, title } }))),
})

/**
 * Las piezas a mandar por /api/saliente, EN ORDEN: por cada paso, su texto (o
 * texto+botones si la respuesta rápida los tiene) y luego sus adjuntos como los
 * cargó el vendedor; al final la pregunta con botones. Un paso cuya respuesta ya
 * no existe se salta con log: mejor un paquete incompleto que uno mudo.
 */
export function piezasDeReceta({ receta, respuestas, contacto }) {
  const out = []
  const porId = new Map((respuestas || []).map(r => [String(r.id), r]))
  for (const paso of Array.isArray(receta?.pasos) ? receta.pasos : []) {
    if (paso?.tipo !== 'respuesta') continue
    const r = porId.get(String(paso.respuestaId))
    if (!r) { console.warn('[recetas] paso huérfano, respuesta rápida no existe:', paso.respuestaId); continue }
    const texto = String(r.text || '').trim()
    const botones = normalizarBotones(r.botones)
    if (texto && botones.length) out.push(pieza(contacto, interactivo(texto, botones)))
    else if (texto) out.push(pieza(contacto, { Mensaje: texto }))
    for (const a of adjuntosDeRespuesta(r)) {
      if (a.tipo === 'audio') out.push(pieza(contacto, { AudioURL: a.url }))
      else if (a.tipo === 'documento') out.push(pieza(contacto, { DocURL: a.url, DocNombre: a.nombre || 'documento' }))
      else out.push(pieza(contacto, { ImagenURL: a.url }))
    }
  }
  const q = receta?.pregunta
  const qTexto = String(q?.texto || '').trim()
  if (qTexto) {
    const botones = normalizarBotones(q.botones)
    out.push(pieza(contacto, botones.length ? interactivo(qTexto, botones) : { Mensaje: qTexto }))
  }
  return out
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Texto (HTML de Telegram) del aviso de anuncio nuevo sin receta. */
export function textoAvisoAnuncioNuevo({ cuenta, titular, sourceId, url }) {
  return [
    `📣 <b>Anuncio NUEVO en ${esc(cuenta)}</b>`,
    `«${esc(titular || '(sin titular)')}»`,
    `id <code>${esc(sourceId)}</code>`,
    'Sin receta: nadie le contesta solo. Configúralo en AUTOS → Bienvenida por anuncio',
    esc(url),
  ].join('\n')
}
