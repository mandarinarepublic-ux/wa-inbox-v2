// lib/optimista.js — la burbuja que se pinta al enviar, antes de que la base la confirme.
//
// ☠️ Va por (teléfono, NÚMERO), no solo por teléfono. En GENERAL la misma persona
// tiene una fila por número; con la clave vieja, contestarle por REPUBLIC pintaba
// el mensaje también en su fila de MANDI y ahí se quedaba 90 s, porque la
// confirmación nunca llega a esa fila (auditoría 25-sep: 47 personas en los dos).

export const claveOptimista = (telefono, canal = '') => `${telefono}|${canal || ''}`

export function partirClave(clave) {
  const i = String(clave).lastIndexOf('|')
  return i < 0 ? { telefono: String(clave), canal: '' } : { telefono: clave.slice(0, i), canal: clave.slice(i + 1) }
}

/** ¿Esta fila es la conversación de ese teléfono en ese número? Sin canal (fila o envío) = compatible. */
export const esFilaDe = (c, telefono, canal = '') =>
  c.telefono === telefono && (!canal || !c.phoneId || c.phoneId === canal)

/** Pinta la burbuja solo en la fila de ese número. */
export function agregarOptimista(convs, telefono, canal, tmpMsg) {
  return convs.map((c) => (esFilaDe(c, telefono, canal) ? { ...c, msgs: [...c.msgs, tmpMsg], last: tmpMsg } : c))
}

/**
 * Cuelga de la lista recién traída las burbujas que la base todavía no confirmó.
 * Muta `pend` (borra lo confirmado o vencido) y `convsData`, igual que hacía load().
 * Se descarta cuando aparece un SALIENTE con el mismo texto en ESA fila, o a los 90 s.
 */
export function reconciliarPendientes(convsData, pend, ahora = Date.now()) {
  for (const clave of Object.keys(pend)) {
    const { telefono, canal } = partirClave(clave)
    const conv = convsData.find((c) => esFilaDe(c, telefono, canal))
    const enHoja = (p) => (conv?.msgs || []).some(
      (m) => m.direccion === 'SALIENTE' && String(m.mensaje).trim() === String(p.mensaje).trim()
    )
    pend[clave] = pend[clave].filter((p) => {
      const ts = Number(String(p.id).replace('tmp_', '')) || 0
      return !enHoja(p) && (ahora - ts < 90000)
    })
    if (!pend[clave].length) { delete pend[clave]; continue }
    const ultimo = pend[clave][pend[clave].length - 1]
    if (conv) {
      conv.msgs = [...conv.msgs, ...pend[clave]]
      conv.last = ultimo
    } else {
      convsData.unshift({ telefono, nombre: pend[clave][0].nombre, phoneId: canal || undefined, msgs: [...pend[clave]], last: ultimo, unread: 0 })
    }
  }
  return convsData
}
