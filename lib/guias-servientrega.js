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
 * del destinatario es el primero que no es nuestro).
 *
 * `nombre` es el del destinatario: en la guía va justo ENCIMA de su celular. Si
 * el celular salió ilegible (va en letra chica: "0988817811" se leyó
 * "osese17en"), se busca encima de la DIRECCIÓN, que viene en el pie y es fácil
 * de ubicar. El OCR mete líneas vacías o de basura en medio: se mira hasta 3
 * líneas para arriba.
 *
 * @param direccion  la "Dirección de entrega" del pie (extraerDelTexto), opcional
 */
export function extraerDeOcr(textoOcr, direccion = '') {
  const lineas = String(textoOcr || '').split(/\r?\n/)
  const celulares = []
  let nombre = ''
  for (let i = 0; i < lineas.length; i++) {
    const encontrados = lineas[i].match(/(?:\+?593[\s-]?|0)9(?:[\s-]?\d){8}/g) || []
    for (const crudo of encontrados) {
      const c = celularEc(crudo)
      if (!c || NUESTROS.has(c) || celulares.includes(c)) continue
      if (!celulares.length) nombre = nombreEncima(lineas, i)
      celulares.push(c)
    }
  }
  if (!nombre && direccion) {
    const i = lineaDeDireccion(lineas, direccion)
    if (i >= 0) nombre = nombreEncima(lineas, i)
  }
  return { celulares, nombre }
}

function nombreEncima(lineas, i) {
  for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
    const n = nombreDeLinea(lineas[k])
    if (n) return n
  }
  return ''
}

// La línea del OCR donde empieza la dirección: la que comparte más palabras
// (de 4+ letras) con el comienzo de la dirección del pie. Mínimo 2 en común.
function lineaDeDireccion(lineas, direccion) {
  const pal = (s) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9Ñ\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
  const meta = new Set(pal(direccion).slice(0, 6))
  let mejor = -1, puntos = 1
  lineas.forEach((l, i) => {
    const p = pal(l).filter(w => meta.has(w)).length
    if (p > puntos) { puntos = p; mejor = i }
  })
  return mejor
}

// El OCR deja basura de 1-2 letras al borde (el rótulo "Destinatario" girado):
// "E DANNY FABIAN RODRIGUEZ RIVERA" → "DANNY FABIAN RODRIGUEZ RIVERA". Una línea
// con muchos dígitos o con palabras sueltas no es un nombre.
function nombreDeLinea(linea) {
  const s = String(linea || '')
  const letras = (s.match(/\p{L}/gu) || []).length
  if (letras < 6 || (s.match(/\d/g) || []).length > 2) return ''
  const palabras = sinAcentos(s).toUpperCase().replace(/[^A-ZÑ\s]/g, ' ').split(/\s+/).filter(Boolean)
  while (palabras.length && palabras[0].length <= 2) palabras.shift()
  while (palabras.length && palabras[palabras.length - 1].length <= 1) palabras.pop()
  if (palabras.length < 2 || palabras.some(w => w.length < 2)) return ''
  return palabras.join(' ')
}

// Distancia de edición (Levenshtein) acotada: alcanza con saber si es 0, 1 o más.
function casiIgual(a, b) {
  if (a === b) return true
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length] <= 1
}

const palabrasNombre = (s) => sinAcentos(s).toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)

/**
 * ¿El nombre del CRM y el de la guía son la misma persona? Se aceptan diferencias
 * de UNA letra por palabra ("Nahin"/"NAHIM", "Ordeñana"/"ORDENANA") y que a uno
 * de los dos le falte un nombre o apellido ("Marilyn Alexandra Valencia Delgado"
 * vs "MARILYN VALENCIA DELGADO"). Hacen falta 3 palabras en común, o TODAS si el
 * más corto tiene solo 2.
 */
export function mismoNombre(nombreCrm, nombreGuia) {
  const a = palabrasNombre(nombreCrm), b = palabrasNombre(nombreGuia)
  if (a.length < 2 || b.length < 2) return false
  const usadas = new Set()
  let comunes = 0
  for (const w of a) {
    const j = b.findIndex((x, k) => !usadas.has(k) && casiIgual(w, x))
    if (j >= 0) { usadas.add(j); comunes++ }
  }
  const corto = Math.min(a.length, b.length)
  return corto === 2 ? comunes === 2 : comunes >= 3
}

/** Las palabras del nombre de la guía que sirven para buscar en el CRM (las de 4+ letras). */
export const palabrasParaBuscar = (nombre) => palabrasNombre(nombre).filter(w => w.length >= 4)

// Estados en los que un pedido puede recibir su guía. COMPLETADO entra porque
// en la práctica las guías llegan también a pedidos ya marcados así (prueba del
// 9-oct: 2 de 5), pero solo si es RECIENTE: uno viejo ya se entregó.
export const ESTADOS_ABIERTOS = ['DESPACHO', 'EN_FABRICA', 'COMPLETADO']
export const DIAS_COMPLETADO = 45

/**
 * El pedido al que va la guía: el MÁS RECIENTE de los que pueden recibirla
 * (DESPACHO, EN_FABRICA o COMPLETADO de los últimos 45 días) y todavía no tienen
 * guía. Devuelve { pedido, motivo }: si no hay pedido, `motivo` dice por qué.
 *
 * @param pedidos  [{ pedido_id, estado_pedido, fecha_pedido }] del cliente
 * @param conGuia  Set de pedido_id que ya tienen una guía registrada
 */
export function elegirPedido(pedidos, conGuia = new Set(), ahoraMs = Date.now()) {
  const lista = Array.isArray(pedidos) ? pedidos : []
  if (!lista.length) return { pedido: null, motivo: 'el cliente no tiene pedidos en el CRM' }
  const limite = ahoraMs - DIAS_COMPLETADO * 864e5
  const abiertos = lista
    .filter(p => {
      const e = String(p.estado_pedido || '').toUpperCase()
      if (!ESTADOS_ABIERTOS.includes(e)) return false
      return e !== 'COMPLETADO' || Date.parse(p.fecha_pedido) >= limite
    })
    .filter(p => !conGuia.has(p.pedido_id))
    .sort((a, b) => String(b.fecha_pedido || '').localeCompare(String(a.fecha_pedido || '')))
  if (!abiertos.length) {
    const yaConGuia = lista.some(p => conGuia.has(p.pedido_id))
    return { pedido: null, motivo: yaConGuia ? 'su pedido ya tiene guía' : `no tiene pedidos EN_FABRICA, DESPACHO ni COMPLETADO de los últimos ${DIAS_COMPLETADO} días` }
  }
  return { pedido: abiertos[0], motivo: abiertos.length > 1 ? `tenía ${abiertos.length} pedidos posibles: se usó el más reciente` : '' }
}
