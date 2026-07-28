// lib/social-agrupar.js — filas de inbox.social_mensajes → conversaciones.
// Puro a propósito: no toca Supabase ni la red, así se puede probar con objetos.
//
// La clave incluye el TIPO porque un comentario es público y un DM es privado: son
// conversaciones distintas aunque las escriba la misma persona. Si se agrupan
// juntas, el vendedor no sabe si está escribiendo a la vista de todos.

/** Clave de la conversación a la que pertenece una fila. */
export function claveConversacion(fila) {
  const tipo = String(fila.tipo || 'DM').toUpperCase() === 'COMENTARIO' ? 'COMENTARIO' : 'DM'
  return `${fila.canal || 'FB'}__${tipo}__${fila.sender_id}`
}

// Vocabulario viejo de SOCIAL (antes de unificar con WhatsApp) → el nuevo, en minúsculas.
const VOCABULARIO_VIEJO = { VENTAPROCESO: 'venta' }
const ESTADOS_VALIDOS = new Set(['pendiente', 'atendido', 'venta', 'soporte', 'archivado'])

/**
 * Unifica el vocabulario de estados con el de WhatsApp: minúsculas, y traduce lo
 * que quedó de la época en que SOCIAL tenía el suyo propio (VENTAPROCESO). Un
 * valor vacío o que no se reconoce cae a 'pendiente' —no a nada— porque un estado
 * desconocido significa "hay que atenderlo", no "se esfuma de las bandejas".
 * Tolera MAYÚSCULAS y minúsculas: así lee tanto lo que ya migró en la base como
 * cualquier fila vieja que se haya quedado sin migrar.
 */
export function normalizarEstado(estado) {
  const crudo = String(estado || '').trim().toUpperCase()
  if (!crudo) return 'pendiente'
  const traducido = VOCABULARIO_VIEJO[crudo] || crudo.toLowerCase()
  return ESTADOS_VALIDOS.has(traducido) ? traducido : 'pendiente'
}

/** Fila de la base → mensaje plano para pintar en el hilo. */
export function filaAMensaje(r) {
  return {
    id:        r.msg_id || String(r.id),
    canal:     r.canal || 'FB',
    tipo:      String(r.tipo || 'DM').toUpperCase() === 'COMENTARIO' ? 'COMENTARIO' : 'DM',
    sender_id: String(r.sender_id || ''),
    nombre:    r.nombre || '',
    direccion: r.direccion || 'ENTRANTE',
    texto:     r.texto || '',
    media_url: r.media_url || '',
    fecha:     r.fecha || '',
    estado:    normalizarEstado(r.estado),
    // Eje 2 (temperatura del lead): 100% manual, nada la cambia sola. '' = sin clasificar.
    temperatura: String(r.temperatura || '').trim().toLowerCase(),
    mandi_activo: r.mandi_activo !== false,
    ad_id:     r.ad_id || '',
    pauta:     r.pauta || '',
    ref:       r.ref || '',
  }
}

/**
 * Agrupa las filas (en orden cronológico) en conversaciones, de la más reciente a
 * la más vieja.
 */
export function agruparConversaciones(filas) {
  const map = {}
  for (const cruda of filas || []) {
    const r = filaAMensaje(cruda)
    if (!r.sender_id) continue
    const key = claveConversacion(r)
    if (!map[key]) {
      map[key] = {
        sender_id: r.sender_id,
        nombre: r.nombre || r.sender_id,
        canal: r.canal,
        tipo: r.tipo,
        status: r.estado, // ya normalizado en filaAMensaje
        temperatura: r.temperatura || '',
        mandi_active: r.mandi_activo,
        messages: [],
        last_time: r.fecha || '',
        unread: 0,
        pautaAdId: '', pautaTitle: '', pautaRef: '',
      }
    }
    const conv = map[key]
    // Primera pauta no vacía de la conversación.
    if (!conv.pautaAdId  && r.ad_id) conv.pautaAdId  = r.ad_id
    if (!conv.pautaTitle && r.pauta) conv.pautaTitle = r.pauta
    if (!conv.pautaRef   && r.ref)   conv.pautaRef   = r.ref
    // Ojo: una foto sin texto NO se descarta (si no, el mensaje desaparece).
    if (String(r.texto || '').trim() || r.media_url) {
      conv.messages.push({
        id: r.id,
        from: String(r.direccion).toUpperCase() === 'SALIENTE' ? 'mandi' : 'user',
        text: r.texto,
        image: r.media_url || '',
        tipo: r.tipo,
        time: r.fecha || '',
      })
    }
    conv.last_time = r.fecha || conv.last_time
    if (r.estado) conv.status = r.estado
    // Temperatura manual: el último valor NO VACÍO gana, igual que el estado. Si una
    // fila vieja no tiene temperatura (NULL), no debe "borrar" la que ya se marcó.
    if (r.temperatura) conv.temperatura = r.temperatura
    if (r.nombre && r.nombre.trim()) conv.nombre = r.nombre.trim()
  }
  return Object.values(map).sort((a, b) => new Date(b.last_time) - new Date(a.last_time))
}
