// lib/archivo-rechazado.js — el cliente mandó un archivo que WhatsApp no pudo entregarnos.
//
// ☠️ EL CASO (20-oct-2026): Rodrigo mandó desde su celular un PDF de 221 MB al
// número de MANDI y en el inbox NO APARECIÓ NADA. Meta no manda el mensaje: manda
// un ESTADO `failed` con el wamid del mensaje del cliente y el error 131052:
//
//   "Media file size too big 221.3007MB. Max file size we currently support: 100MB"
//
// El webhook solo miraba los estados para poner ✓✓ a lo que ENVIAMOS, así que este
// se descartaba en silencio: el cliente cree que mandó su archivo y nadie se entera.
// Pedido de Rodrigo: "si pasa algo así tienes que decirme… mandarme un mensaje ahí".
//
// Se convierte en un mensaje ENTRANTE del chat: vuelve a Pendientes y suena el push,
// porque el cliente SÍ escribió — solo que su archivo no llegó.

/** 131052 = Meta no pudo bajar el archivo que mandó el cliente. */
const CODIGOS = new Set([131052])

/** Tamaño en MB que Meta pone en el detalle ("… too big 221.3007MB …"), o null. */
export function megasDelDetalle(detalle) {
  const m = String(detalle || '').match(/too big\s*([\d.]+)\s*MB/i)
  return m ? Math.round(Number(m[1])) : null
}

/** El texto que ve el vendedor en el chat. */
export function textoArchivoRechazado(detalle) {
  const mb = megasDelDetalle(detalle)
  if (/too big/i.test(String(detalle || ''))) {
    return `⚠️ El cliente intentó enviarte un archivo${mb ? ` de ${mb} MB` : ''} que supera la capacidad de WhatsApp (máximo 100 MB) y NO llegó. `
      + 'Pídele que lo mande más liviano o por un enlace (Google Drive, WeTransfer).'
  }
  return '⚠️ El cliente intentó enviarte un archivo y WhatsApp no pudo entregarlo. '
    + 'Pídele que lo vuelva a mandar o que lo comparta por un enlace.'
    + (detalle ? ` (Meta: ${String(detalle).slice(0, 160)})` : '')
}

/**
 * Un estado del webhook → el mensaje entrante a guardar, o null si no es este caso.
 * `phoneId` es el número nuestro (value.metadata.phone_number_id).
 */
export function archivoRechazadoDeEstado(st, phoneId = '') {
  if (String(st?.status || '').toLowerCase() !== 'failed') return null
  const err = (st.errors || []).find((e) => CODIGOS.has(Number(e?.code)))
  if (!err || !st.id || !st.recipient_id) return null
  const detalle = err?.error_data?.details || err?.message || ''
  return {
    wamid: String(st.id),                 // el wamid del mensaje DEL CLIENTE: idempotente
    telefono: String(st.recipient_id),
    phoneId: String(phoneId || ''),
    contenido: textoArchivoRechazado(detalle),
    fecha: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString(),
    raw: { type: 'archivo_rechazado', status: st },   // ≠ 'text': ningún flujo lo toma por algo escrito
  }
}
