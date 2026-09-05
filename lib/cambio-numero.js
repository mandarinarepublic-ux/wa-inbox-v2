// lib/cambio-numero.js — cuando un cliente se muda de teléfono.
//
// ☠️ EL PROBLEMA. Meta avisa por un mensaje `system` que alguien cambió de
// número, y ahí el historial de esa persona QUEDA PARTIDO: lo viejo bajo el
// teléfono anterior, lo nuevo bajo el otro, y nadie los conecta. Quien atiende
// abre el chat nuevo y lo ve en blanco, sin saber que es un cliente de siempre.
//
// Medido el 4-sep-2026: 38 cambios, 31 en el último mes (35 en IND). De esos, 5
// ya escribieron desde el número nuevo y 2 traían historial de verdad.
//
// El chat VIEJO ya dice a dónde se fue la persona (ver `case 'system'` en
// wa-mensaje.js). Esto es la otra mitad: que el chat NUEVO diga de dónde viene.

/**
 * { viejo, nuevo } si el mensaje es un cambio de número utilizable; null si no.
 *
 * ⚠️ `nuevo` sale de `wa_id`, que es EL CAMPO. `viejo` se saca del `body`, que es
 * texto libre de Meta ("User A changed from X to Y") y puede cambiar de formato
 * sin aviso — por eso `viejo` puede venir vacío y eso NO invalida el cambio.
 *
 * ☠️ Sin `wa_id` se devuelve null: no hay a dónde apuntar, y mandar a quien
 * atiende a un chat equivocado es peor que no decir nada.
 */
export function cambioDeNumero(raw) {
  const sys = raw?.system
  if (!sys || sys.type !== 'user_changed_number') return null
  const nuevo = String(sys.wa_id || '').replace(/\D/g, '')
  if (!nuevo) return null
  const viejo = (String(sys.body || '').match(/from\s+(\d+)/) || [])[1] || ''
  return { viejo, nuevo }
}

/**
 * El mensaje que se le deja al número NUEVO: "esta persona venía del viejo".
 * null si el aviso no sirve para eso.
 *
 * ⚠️ Va como ENTRANTE A PROPÓSITO. Eso hace que el chat caiga en PENDIENTES, y
 * esa es justamente la gracia: es la alerta de que un cliente cambió de número.
 * Decisión de Rodrigo, contra la duda de ensuciar la bandeja — para él una fila
 * de más en Pendientes vale más que enterarse tarde.
 *
 * ☠️ El id sale del wamid del aviso, así que es ESTABLE: Meta reentrega el mismo
 * evento (ver lib/reentrega.js) y no puede crear dos notas.
 *
 * ☠️ Y el `raw` de la nota lleva un tipo DISTINTO (`numero_anterior`) a propósito:
 * si fuera `user_changed_number`, guardar la nota dispararía otra nota, y esa
 * otra, y así. Hay una prueba que lo fija.
 */
export function notaParaNumeroNuevo(msg) {
  const c = cambioDeNumero(msg?.raw)
  if (!c) return null
  const viejo = String(msg.telefono || c.viejo || '').replace(/\D/g, '')
  if (!viejo || viejo === c.nuevo) return null
  return {
    id: `sys_cambio_${msg.id || c.nuevo}`,
    telefono: c.nuevo,
    nombre: msg.nombre || '',
    tipo: 'system',
    mensaje: `🔄 Este cliente cambió de número. Antes escribía desde ${viejo}`,
    direccion: 'ENTRANTE',
    timestamp: msg.timestamp || '',
    // Por NUESTRO mismo número: la conversación nueva pertenece al canal por el
    // que llegó el aviso, no al que estuviera armado en la pantalla.
    phoneId: msg.phoneId || '',
    mediaId: '', mediaUrl: '', contextoId: '', referral: null,
    raw: { type: 'system', system: { type: 'numero_anterior', numero_anterior: viejo } },
  }
}
