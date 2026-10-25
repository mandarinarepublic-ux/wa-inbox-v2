// ── IR AL MENSAJE CITADO ─────────────────────────────────────────────────────
//
// "El cliente me responde a un mensaje y quiero tocar la cita para ver a qué se
// refiere." Como en WhatsApp: tocar la cita sube el hilo hasta el original.
//
// Se compara por `hashWamid`, nunca por el wamid entero: Meta envuelve el MISMO
// mensaje con wamids distintos (por número vs por user_id) y la cita trae el otro.
//
// El original puede estar en tres lugares, y cada uno pide algo distinto:
//   1. pintado en pantalla          → solo bajar hasta él
//   2. en un mes PLEGADO            → abrir ese mes primero (lib/meses-chat.js)
//   3. fuera del historial cargado  → traer páginas viejas hasta encontrarlo

import { hashWamid } from './utils.js'

/** El atributo que lleva cada burbuja en el DOM para poder encontrarla. */
export const claveSalto = (id) => hashWamid(String(id || ''))

/**
 * En qué tramo (mes) del hilo cae el mensaje citado.
 * Devuelve { clave, siempreAbierto } o null si no está en los tramos.
 */
export function tramoDelCitado(tramos, contextoId) {
  const objetivo = claveSalto(contextoId)
  if (!objetivo) return null
  for (const t of tramos || []) {
    if (t.msgs.some(m => claveSalto(m.id) === objetivo)) {
      return { clave: t.clave, siempreAbierto: !!t.siempreAbierto }
    }
  }
  return null
}

/** ¿El mensaje citado ya está entre los descargados? */
export const estaCargado = (msgs, contextoId) => {
  const objetivo = claveSalto(contextoId)
  return !!objetivo && (msgs || []).some(m => claveSalto(m.id) === objetivo)
}
