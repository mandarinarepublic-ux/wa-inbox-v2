// lib/guias-servientrega.js — leer una guía de Servientrega REENVIADA al inbox y
// decidir a qué pedido del CRM pertenece. Módulo PURO (sin red ni base).
//
// ☠️ Por qué REENVIADA y no directo de Servientrega: su número (593985009414) es
// de API, igual que los nuestros, y Meta no deja que dos cuentas de API se hablen.
// Todo lo que nos manda llega como `unsupported` (131051) sin texto ni foto: 107
// mensajes vacíos entre jul y oct-2026. Por eso Servientrega le escribe a un
// celular normal (Rodri VIP) y Rodri reenvía la guía a MANDI, donde sí llega
// completa: foto + el texto de Servientrega como pie.
//
// De dónde sale cada dato:
//   · el PIE (texto) → número de guía, destino y dirección.
//   · la FOTO (OCR)  → nombre y CELULAR del destinatario, que el pie no trae.
// El celular es lo que encuentra al cliente en el CRM; el nombre es el respaldo.

/** Los números que reenvían guías al inbox. Un mensaje de otro número no se lee. */
export const REMITENTES_GUIAS = ['593987498489']   // Rodri VIP

// Números nuestros que pueden aparecer impresos en la guía (remitente) y que
// NUNCA son el destinatario.
const NUESTROS = new Set(['0987498489', '0983745757', '0999953326', '0984159804'])

const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const limpiarLinea = (s) => String(s || '').replace(/[*_~]/g, '').trim()

/** ¿Este texto es el aviso de guía de Servientrega? */
export function esTextoDeGuia(texto) {
  const t = sinAcentos(texto).toLowerCase()
  return /guia\W*\d{8,}/.test(t) && (t.includes('servientrega') || t.includes('envio ha sido generado') || t.includes('destino'))
}

/** Del pie de Servientrega: { numero, destino, direccion }. numero '' si no hay. */
export function extraerDelTexto(texto) {
  const t = String(texto || '')
  const plano = sinAcentos(t)
  const numero = (plano.match(/gu[i]a\W*(\d{8,})/i) || [])[1] || ''
  const linea = (re) => {
    const m = plano.match(re)
    if (!m) return ''
    // La misma línea, pero del texto ORIGINAL (con tildes) para mostrarla.
    const ini = m.index + m[0].length
    const fin = t.indexOf('\n', ini)
    return limpiarLinea(t.slice(ini, fin < 0 ? undefined : fin)).replace(/^[:\s]+/, '')
  }
  return {
    numero,
    destino: linea(/destino\W*?:\**/i),
    direccion: linea(/direccion de entrega\W*?:\**/i),
  }
}

/** Celular ecuatoriano en forma 09XXXXXXXX, o '' si no lo es. */
export function celularEc(s) {
  let d = String(s || '').replace(/\D/g, '')
  if (d.startsWith('593')) d = '0' + d.slice(3)
  else if (d.length === 9 && d.startsWith('9')) d = '0' + d
  return /^09\d{8}$/.test(d) ? d : ''
}

/**
 * Del texto que el OCR saca de la foto: { celulares, nombre }.
 * `celulares` sin los nuestros y sin repetidos, en el orden en que aparecen (el
 * del destinatario es el primero que no es nuestro). `nombre` es la línea justo
 * encima del primer celular, que en la guía es el nombre del destinatario.
 */
export function extraerDeOcr(textoOcr) {
  const lineas = String(textoOcr || '').split(/\r?\n/)
  const celulares = []
  let nombre = ''
  for (let i = 0; i < lineas.length; i++) {
    const encontrados = lineas[i].match(/(?:\+?593[\s-]?|0)9(?:[\s-]?\d){8}/g) || []
    for (const crudo of encontrados) {
      const c = celularEc(crudo)
      if (!c || NUESTROS.has(c) || celulares.includes(c)) continue
      if (!celulares.length) nombre = nombreDeLinea(lineas[i - 1])
      celulares.push(c)
    }
  }
  return { celulares, nombre }
}

// El OCR deja basura de 1-2 letras al borde (el rótulo "Destinatario" girado):
// "E DANNY FABIAN RODRIGUEZ RIVERA" → "DANNY FABIAN RODRIGUEZ RIVERA".
function nombreDeLinea(linea) {
  const palabras = sinAcentos(linea).toUpperCase().replace(/[^A-ZÑ\s]/g, ' ').split(/\s+/).filter(Boolean)
  while (palabras.length && palabras[0].length <= 2) palabras.shift()
  while (palabras.length && palabras[palabras.length - 1].length <= 1) palabras.pop()
  return palabras.length >= 2 ? palabras.join(' ') : ''
}

/** ¿El nombre del CRM es el mismo que el de la guía? Todas sus palabras (≥2) tienen que estar. */
export function mismoNombre(nombreCrm, nombreGuia) {
  const norm = (s) => sinAcentos(s).toUpperCase().replace(/[^A-ZÑ\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
  const a = norm(nombreCrm), b = new Set(norm(nombreGuia))
  return a.length >= 2 && a.every(w => b.has(w))
}

// Estados en los que un pedido todavía espera su guía, en orden de preferencia.
export const ESTADOS_ABIERTOS = ['DESPACHO', 'EN_FABRICA']

/**
 * El pedido al que va la guía: el MÁS RECIENTE de los abiertos (DESPACHO o
 * EN_FABRICA) que todavía no tiene guía. Devuelve { pedido, motivo }: si no hay
 * pedido, `motivo` dice por qué, para mostrárselo a quien apretó el botón.
 *
 * @param pedidos  [{ pedido_id, estado_pedido, fecha_pedido }] del cliente
 * @param conGuia  Set de pedido_id que ya tienen una guía registrada
 */
export function elegirPedido(pedidos, conGuia = new Set()) {
  const lista = Array.isArray(pedidos) ? pedidos : []
  if (!lista.length) return { pedido: null, motivo: 'el cliente no tiene pedidos en el CRM' }
  const abiertos = lista
    .filter(p => ESTADOS_ABIERTOS.includes(String(p.estado_pedido || '').toUpperCase()))
    .filter(p => !conGuia.has(p.pedido_id))
    .sort((a, b) => String(b.fecha_pedido || '').localeCompare(String(a.fecha_pedido || '')))
  if (!abiertos.length) {
    const yaConGuia = lista.some(p => conGuia.has(p.pedido_id))
    return { pedido: null, motivo: yaConGuia ? 'su pedido abierto ya tiene guía' : 'no tiene ningún pedido EN_FABRICA ni en DESPACHO' }
  }
  return { pedido: abiertos[0], motivo: abiertos.length > 1 ? `tenía ${abiertos.length} pedidos abiertos: se usó el más reciente` : '' }
}
