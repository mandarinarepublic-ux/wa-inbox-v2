// lib/flujo.js — FLUJOS: el grafo de nodos, su validación y su ejecución lineal.
// Módulo PURO (sin red ni base). Ver docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md.
//
// Un flujo es un grafo { nodos, lineas } con exactamente un Disparador. Fase A solo
// corre el CAMINO LINEAL (sin ramas): el motor entra por caminoLineal y sale con las
// piezas para /api/saliente. Las ramas (botones, condición, espera) quedan dibujadas
// y validadas, pero se ejecutan recién en la Fase B (estado por cliente).
import { adjuntosDeRespuesta } from './adjuntos-respuesta.js'
import { pieza, interactivo, normalizarBotones, MAX_PIEZAS, MAX_BOTONES, MAX_TITULO } from './recetas.js'

export const TIPOS_NODO = ['disparador', 'mensaje', 'condicion', 'fin']
// Meta corta la ventana de conversación a las 24h; una espera de 23h deja un margen
// de una hora para que el motor (que corre por cron/al vuelo) alcance a mandarla.
export const MAX_ESPERA_MIN = 23 * 60

/** minúsculas, sin acentos, espacios simples — para comparar palabras clave y textos. */
export function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** El nodo Disparador del grafo, o null si no hay (grafo recién creado a mano, sin validar). */
export function nodoDisparador(grafo) {
  return (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean).find((n) => n.tipo === 'disparador') || null
}

/**
 * Los puertos de salida de un nodo, en el orden en que se dibujan.
 *  - disparador: una sola salida.
 *  - mensaje CON botones (≥1 tras normalizar): un puerto por botón + "otra" (el
 *    cliente escribió en vez de tocar). Los botones GANAN sobre esperarRespuesta:
 *    no tiene sentido esperar texto libre si ya se le dieron opciones para tocar.
 *  - mensaje esperando respuesta (sin botones): un solo puerto "respuesta".
 *  - mensaje simple: sigue de largo.
 *  - condición: sí/no. fin: ninguno.
 */
export function puertosDe(nodo) {
  const tipo = nodo?.tipo
  if (tipo === 'disparador') return ['siguiente']
  if (tipo === 'condicion') return ['si', 'no']
  if (tipo === 'fin') return []
  if (tipo === 'mensaje') {
    const botones = normalizarBotones(nodo?.datos?.botones)
    if (botones.length) return [...botones.map((_, i) => `btn_${i + 1}`), 'otra']
    if (nodo?.datos?.esperarRespuesta) return ['respuesta']
    return ['siguiente']
  }
  return []
}

const tituloDe = (b) => String((b && typeof b === 'object') ? b.title : b || '')

/**
 * `esperaMin` de una línea, ya interpretado: vacío/null/undefined = 0 (inmediato);
 * cualquier otra cosa se pasa por `Number()` tal cual, así que un valor no numérico
 * ("dos horas") vuelve NaN en vez de perderse silenciosamente como 0 — eso lo
 * detecta el llamador (validarFlujo lo marca error; caminoLineal se para en seco).
 */
function esperaMinDe(valor) {
  if (valor === undefined || valor === null || valor === '') return 0
  return Number(valor)
}

/**
 * Valida el grafo entero y devuelve la lista de errores ([] = válido). Un flujo con
 * errores se puede guardar como borrador pero no publicar (eso lo decide el llamador).
 *
 * `respuestas`, si se pasa, es la lista viva de respuestas rápidas: sin ella, un nodo
 * `origen=respuesta` solo se valida por tener `respuestaId`, nunca por si esa
 * respuesta sigue existiendo (para no exigirle la lista completa a quien solo quiere
 * revisar la forma del grafo).
 */
export function validarFlujo(grafo, { respuestas = [] } = {}) {
  const errores = []
  // .filter(Boolean): un nodo o línea null (fila a medio borrar en el editor, JSON
  // guardado a mano) no debe reventar la validación, solo faltar.
  const nodos = (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean)
  const lineas = (Array.isArray(grafo?.lineas) ? grafo.lineas : []).filter(Boolean)
  const porId = new Map(nodos.map((n) => [n.id, n]))

  for (const n of nodos) {
    if (!TIPOS_NODO.includes(n.tipo)) {
      errores.push({ nodoId: n.id, texto: `tipo de nodo desconocido: "${n.tipo}"` })
    }
  }

  const disparadores = nodos.filter((n) => n.tipo === 'disparador')
  if (disparadores.length === 0) errores.push({ texto: 'Falta el nodo Disparador' })
  else if (disparadores.length > 1) errores.push({ texto: `Debe haber un solo Disparador (hay ${disparadores.length})` })

  if (disparadores.length === 1) {
    const d = disparadores[0]
    const dt = d.datos || {}
    if (dt.tipo === 'anuncio' && !(Array.isArray(dt.sourceIds) && dt.sourceIds.length)) {
      errores.push({ nodoId: d.id, texto: 'El Disparador de anuncio necesita al menos un anuncio' })
    }
    if (dt.tipo === 'palabra') {
      const palabras = Array.isArray(dt.palabras) ? dt.palabras : []
      // Una palabra vacía (o solo espacios) no es "ninguna palabra": es una que
      // `normalizarTexto(texto).includes('')` siempre cumple, así que capturaría
      // CUALQUIER mensaje que llegue. Por eso no basta con pedir longitud ≥1: cada
      // palabra tiene que sobrevivir la normalización.
      if (!palabras.some((p) => normalizarTexto(p))) {
        errores.push({ nodoId: d.id, texto: 'El Disparador de palabra necesita al menos una palabra' })
      }
      if (palabras.some((p) => !normalizarTexto(p))) {
        errores.push({ nodoId: d.id, texto: 'una palabra del Disparador no puede quedar vacía' })
      }
    }
  }

  // Líneas: nodos que existen, puerto válido para ese nodo, sin dos líneas del
  // mismo puerto (¿cuál seguiría?), espera dentro de rango.
  const vistosPuerto = new Set()
  for (const l of lineas) {
    const de = porId.get(l.de)
    const a = porId.get(l.a)
    if (!de || !a) {
      errores.push({ lineaId: l.id, texto: 'la línea conecta con un nodo que no existe' })
      continue
    }
    if (!puertosDe(de).includes(l.puerto)) {
      errores.push({ lineaId: l.id, texto: `el puerto "${l.puerto}" no existe en ese nodo` })
    }
    const clave = `${l.de}::${l.puerto}`
    if (vistosPuerto.has(clave)) {
      errores.push({ lineaId: l.id, texto: 'ese puerto ya tiene otra línea saliendo' })
    }
    vistosPuerto.add(clave)
    const espera = esperaMinDe(l.esperaMin)
    if (Number.isNaN(espera)) {
      errores.push({ lineaId: l.id, texto: 'la espera de la línea no es un número' })
    } else if (espera < 0 || espera > MAX_ESPERA_MIN) {
      errores.push({ lineaId: l.id, texto: `la espera debe ir entre 0 y ${MAX_ESPERA_MIN} minutos` })
    }
  }

  // Alcanzabilidad: todo nodo debe colgar del Disparador (si no, el editor tiene un
  // nodo suelto que nunca corre). Solo tiene sentido con un único Disparador.
  if (disparadores.length === 1) {
    const alcanzables = new Set([disparadores[0].id])
    const cola = [disparadores[0].id]
    while (cola.length) {
      const actual = cola.shift()
      for (const l of lineas) {
        if (l.de === actual && porId.has(l.a) && !alcanzables.has(l.a)) {
          alcanzables.add(l.a)
          cola.push(l.a)
        }
      }
    }
    for (const n of nodos) {
      if (!alcanzables.has(n.id)) errores.push({ nodoId: n.id, texto: 'nodo inalcanzable desde el Disparador' })
    }
  }

  // Por nodo: mensaje.
  for (const n of nodos) {
    if (n.tipo !== 'mensaje') continue
    const dt = n.datos || {}
    const botonesRaw = Array.isArray(dt.botones) ? dt.botones : []
    if (botonesRaw.length > MAX_BOTONES) {
      errores.push({ nodoId: n.id, texto: `máximo ${MAX_BOTONES} botones` })
    }
    if (botonesRaw.some((b) => tituloDe(b).length > MAX_TITULO)) {
      errores.push({ nodoId: n.id, texto: `un botón no puede pasar de ${MAX_TITULO} letras` })
    }
    // Un botón sin título no se ve como un error al guardar (normalizarBotones lo
    // descarta calladito al ejecutar), pero SÍ es uno: el editor lo dejó a medias.
    if (botonesRaw.some((b) => !tituloDe(b).trim())) {
      errores.push({ nodoId: n.id, texto: 'un botón no puede tener el título vacío' })
    }
    if (dt.origen === 'respuesta') {
      if (!dt.respuestaId) {
        errores.push({ nodoId: n.id, texto: 'falta elegir la respuesta rápida' })
      } else if (!respuestas.some((r) => String(r.id) === String(dt.respuestaId))) {
        errores.push({ nodoId: n.id, texto: 'esa respuesta rápida ya no existe' })
      }
    } else {
      const texto = String(dt.texto || '').trim()
      const adjuntos = Array.isArray(dt.adjuntos) ? dt.adjuntos : []
      if (!texto && !adjuntos.length) {
        errores.push({ nodoId: n.id, texto: 'falta el texto o algún adjunto' })
      }
    }
  }

  // Ciclos: solo cuentan las líneas SIN espera (esperaMin 0 o inválida) — un ciclo
  // con espera de verdad el motor lo corta solo porque cada vuelta consume la
  // ventana de 24h; una espera rota ya se marcó error arriba, así que acá con
  // tratarla como inmediata alcanza para no dejar pasar un ciclo real sin avisar.
  const adyacencia = new Map()
  for (const l of lineas) {
    const espera = esperaMinDe(l.esperaMin)
    if (Number.isFinite(espera) && espera > 0) continue
    if (!adyacencia.has(l.de)) adyacencia.set(l.de, [])
    adyacencia.get(l.de).push(l.a)
  }
  const color = new Map() // 0 blanco (sin visitar) · 1 gris (en curso) · 2 negro (cerrado)
  let hayCiclo = false
  const dfs = (id) => {
    if (hayCiclo) return
    color.set(id, 1)
    for (const vecino of adyacencia.get(id) || []) {
      const c = color.get(vecino) || 0
      if (c === 1) { hayCiclo = true; return }
      if (c === 0) dfs(vecino)
    }
    color.set(id, 2)
  }
  for (const n of nodos) {
    if (!hayCiclo && (color.get(n.id) || 0) === 0) dfs(n.id)
  }
  if (hayCiclo) errores.push({ texto: 'el flujo tiene un ciclo sin espera (nunca termina)' })

  return errores
}

/** ¿Los dos Disparadores chocan? organico vs organico, mismo sourceId, o misma palabra. */
function motivoDeChoque(propio, otro) {
  if (propio?.tipo === 'organico' && otro?.tipo === 'organico') return 'los dos son el orgánico'
  if (propio?.tipo === 'anuncio' && otro?.tipo === 'anuncio') {
    const propios = new Set((propio.sourceIds || []).map(String))
    if ((otro.sourceIds || []).some((id) => propios.has(String(id)))) return 'mismo anuncio'
  }
  if (propio?.tipo === 'palabra' && otro?.tipo === 'palabra') {
    // Las palabras vacías no cuentan para el choque: si contaran, dos Disparadores
    // de palabra con una fila vacía (un error de validación aparte) chocarían entre
    // sí por nada en común.
    const propias = new Set((propio.palabras || []).map(normalizarTexto).filter(Boolean))
    if ((otro.palabras || []).some((p) => { const np = normalizarTexto(p); return np && propias.has(np) })) return 'misma palabra'
  }
  return null
}

/**
 * Con qué OTROS flujos publicados choca el Disparador de este grafo (mismo
 * anuncio, misma palabra, o el orgánico repetido). `otrosPublicados` es la lista
 * de flujos de la cuenta ({ flujo_id, nombre, publicado, grafo_vivo }); se ignoran
 * los que no están publicados o no tienen grafo_vivo.
 */
export function choquesDeDisparador(grafo, otrosPublicados) {
  const propio = nodoDisparador(grafo)
  if (!propio) return []
  const choques = []
  for (const otro of Array.isArray(otrosPublicados) ? otrosPublicados : []) {
    if (!otro?.publicado || !otro?.grafo_vivo) continue
    const suyo = nodoDisparador(otro.grafo_vivo)
    if (!suyo) continue
    const motivo = motivoDeChoque(propio.datos, suyo.datos)
    if (motivo) choques.push({ flujoId: otro.flujo_id, nombre: otro.nombre, motivo })
  }
  return choques
}

/**
 * A qué flujo publicado le toca este entrante.
 *
 * Con `sourceId` (vino de un anuncio): SOLO se mira el Disparador de anuncio que
 * lo tenga — o `null` si ninguno lo tiene. Un anuncio sin flujo asignado no debe
 * "caer" a una palabra ni al orgánico: el orgánico es, por definición (spec §2),
 * el contacto SIN anuncio, y una palabra que matchee de pura casualidad el texto
 * de alguien que vino de pauta pagada sería un flujo equivocado disparándose por
 * un anuncio ajeno.
 *
 * Sin `sourceId`: palabra (contenida en el texto, normalizada) y si no, orgánico
 * (solo si es contacto nuevo). Solo mira flujos `publicado && grafo_vivo`: un
 * borrador nunca corre.
 */
export function elegirFlujo({ flujos, sourceId, esNuevo, texto }) {
  const candidatos = (Array.isArray(flujos) ? flujos : []).filter((f) => f?.publicado && f?.grafo_vivo)
  const sid = String(sourceId || '').trim()

  if (sid) {
    const porAnuncio = candidatos.find((f) => {
      const d = nodoDisparador(f.grafo_vivo)
      return d?.datos?.tipo === 'anuncio' && (d.datos.sourceIds || []).map(String).includes(sid)
    })
    return porAnuncio || null
  }

  const norm = normalizarTexto(texto)
  if (norm) {
    const porPalabra = candidatos.find((f) => {
      const d = nodoDisparador(f.grafo_vivo)
      if (d?.datos?.tipo !== 'palabra') return false
      return (d.datos.palabras || []).some((p) => {
        const np = normalizarTexto(p)
        return np && norm.includes(np)
      })
    })
    if (porPalabra) return porPalabra
  }

  if (esNuevo) {
    const porOrganico = candidatos.find((f) => nodoDisparador(f.grafo_vivo)?.datos?.tipo === 'organico')
    if (porOrganico) return porOrganico
  }

  return null
}

// Tope de pasos al recorrer el camino: contra un grafo con ciclo que la validación
// no haya cazado (o uno guardado como borrador roto), esto evita un bucle infinito.
const TOPE_PASOS_CAMINO = 50

/**
 * Recorre el grafo desde el Disparador siguiendo la línea única del puerto
 * "siguiente" — NUNCA ninguna otra (btn_*, "otra", "respuesta", "si"/"no"): esas
 * son justamente los puntos donde Fase A se detiene a esperar a la Fase B.
 * Acumula los nodos Mensaje de paso. Se detiene, en este orden:
 *  1. la línea que toca seguir tiene una espera que no es un número (grafo
 *     corrupto: uno publicado nunca debería llegar así) → 'huerfano'.
 *  2. la línea que toca seguir tiene espera (`esperaMin>0`) → 'espera' (el nodo
 *     destino NO se agrega: todavía no llegó).
 *  3. el nodo destino es Condición → 'condicion' (Fase B decide el sí/no).
 *  4. el nodo destino es Mensaje → SIEMPRE se agrega; si tiene botones → 'botones'
 *     (Fase B espera el toque); si no y `esperarRespuesta` → 'esperar_respuesta'.
 *  5. el nodo destino es Fin, o el puerto no tiene línea → 'fin'.
 *  6. el nodo destino no existe (línea rota) → 'huerfano'.
 *
 * `detenidoEn` es SIEMPRE el nodo donde queda "parado" el cliente (lo que Fase B
 * grabaría en `flujo_estado.nodo_id`):
 *  - 'botones' / 'esperar_respuesta' → el Mensaje que se está esperando.
 *  - 'condicion' → el nodo Condición.
 *  - 'fin' → el Fin si se llegó a uno de verdad; si el puerto simplemente no
 *    tenía línea, el último nodo ejecutado (no hubo Fin que tocar).
 *  - 'espera' → el nodo de ORIGEN de la línea que espera (ahí es donde el
 *    cliente sigue parado mientras corre el reloj); `lineaEspera` trae el id de
 *    esa línea, para saber por dónde seguir cuando se cumpla.
 *  - 'huerfano' → el último nodo válido antes de la rotura.
 */
export function caminoLineal(grafo) {
  const nodos = (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean)
  const lineas = (Array.isArray(grafo?.lineas) ? grafo.lineas : []).filter(Boolean)
  const porId = new Map(nodos.map((n) => [n.id, n]))
  const lineaDe = (id, puerto) => lineas.find((l) => l.de === id && l.puerto === puerto)

  const disparador = nodoDisparador({ nodos })
  if (!disparador) return { mensajes: [], detenidoEn: null, motivo: 'huerfano' }

  const mensajes = []
  let actualId = disparador.id
  let puerto = 'siguiente'

  for (let paso = 0; paso < TOPE_PASOS_CAMINO; paso++) {
    const linea = lineaDe(actualId, puerto)
    if (!linea) return { mensajes, detenidoEn: actualId, motivo: 'fin' }

    const espera = esperaMinDe(linea.esperaMin)
    if (Number.isNaN(espera)) return { mensajes, detenidoEn: actualId, motivo: 'huerfano' }
    if (espera > 0) return { mensajes, detenidoEn: actualId, lineaEspera: linea.id, motivo: 'espera' }

    const destino = porId.get(linea.a)
    if (!destino) return { mensajes, detenidoEn: actualId, motivo: 'huerfano' }

    if (destino.tipo === 'condicion') return { mensajes, detenidoEn: destino.id, motivo: 'condicion' }
    if (destino.tipo === 'fin') return { mensajes, detenidoEn: destino.id, motivo: 'fin' }

    if (destino.tipo === 'mensaje') {
      mensajes.push(destino)
      const puertos = puertosDe(destino)
      if (puertos.some((p) => p.startsWith('btn_'))) return { mensajes, detenidoEn: destino.id, motivo: 'botones' }
      if (puertos.includes('respuesta')) return { mensajes, detenidoEn: destino.id, motivo: 'esperar_respuesta' }
      actualId = destino.id
      puerto = 'siguiente'
      continue
    }

    // Disparador u otro tipo inesperado como destino: no debería pasar en un
    // grafo válido, pero mejor pararse acá que seguir de largo.
    return { mensajes, detenidoEn: actualId, motivo: 'huerfano' }
  }
  return { mensajes, detenidoEn: actualId, motivo: 'huerfano' }
}

/**
 * Las piezas para /api/saliente de una tanda de nodos Mensaje, EN ORDEN: la misma
 * receta que ya arma lib/recetas.js (piezasDeReceta), generalizada a nodos. Un
 * nodo `origen=respuesta` cuya respuesta ya no existe se salta con log — mejor un
 * paquete incompleto que uno mudo. `citaId`: wamid del entrante; solo la PRIMERA
 * pieza sale citándolo (ver lib/recetas.js para el porqué).
 */
export function piezasDeNodos({ nodos, respuestas, contacto, citaId = '' }) {
  const out = []
  const porId = new Map((Array.isArray(respuestas) ? respuestas : []).map((r) => [String(r.id), r]))

  for (const nodo of (Array.isArray(nodos) ? nodos : []).filter(Boolean)) {
    const dt = nodo.datos || {}
    let texto
    let botones
    let adjuntos

    if (dt.origen === 'respuesta') {
      const r = porId.get(String(dt.respuestaId))
      if (!r) { console.warn('[flujo] nodo huérfano, respuesta rápida no existe:', dt.respuestaId); continue }
      texto = String(r.text || '').trim()
      botones = normalizarBotones(Array.isArray(dt.botones) && dt.botones.length ? dt.botones : r.botones)
      adjuntos = adjuntosDeRespuesta(r)
    } else {
      texto = String(dt.texto || '').trim()
      botones = normalizarBotones(dt.botones)
      // Mismo saneo que una respuesta rápida (tipo válido, url no vacía, tope):
      // los adjuntos de un nodo Mensaje los carga el mismo editor y pueden traer
      // una fila a medio llenar (url vacía) o, desde el borrador de un grafo
      // guardado a mano, hasta un `null` suelto.
      adjuntos = adjuntosDeRespuesta({ adjuntos: dt.adjuntos })
    }

    if (texto && botones.length) out.push(pieza(contacto, interactivo(texto, botones)))
    else if (texto) out.push(pieza(contacto, { Mensaje: texto }))

    for (const a of adjuntos) {
      if (a.tipo === 'audio') out.push(pieza(contacto, { AudioURL: a.url }))
      else if (a.tipo === 'documento') out.push(pieza(contacto, { DocURL: a.url, DocNombre: a.nombre || 'documento' }))
      else out.push(pieza(contacto, { ImagenURL: a.url }))
    }
  }

  if (out.length > MAX_PIEZAS) {
    console.warn('[flujo] camino con', out.length, 'piezas, se recorta a', MAX_PIEZAS)
  }
  const piezas = out.slice(0, MAX_PIEZAS)
  const cita = String(citaId || '').trim()
  if (cita && piezas.length) piezas[0] = { ...piezas[0], ContextoId: cita }
  return piezas
}

/** La última temperatura no vacía entre los nodos recorridos, o '' si ninguno la fija. */
export function temperaturaAlPasar(nodos) {
  let ultima = ''
  for (const n of (Array.isArray(nodos) ? nodos : []).filter(Boolean)) {
    const t = n?.datos?.temperatura
    if (t) ultima = t
  }
  return ultima
}

/**
 * Convierte una receta de bienvenida (formato viejo) en un flujo lineal: Disparador
 * con los anuncios (o el orgánico) → un Mensaje `origen=respuesta` por paso → si hay
 * pregunta, un Mensaje `origen=texto` con sus botones → Fin.
 *
 * Si la pregunta trae botones, ese Mensaje NO se conecta a Fin: sus puertos
 * (btn_1…, "otra") quedan sin línea, que por regla del modelo ya equivale a Fin. Un
 * Fin colgado ahí, sin línea posible que llegue a tocarlo, solo generaría un nodo
 * inalcanzable — así que en ese caso el Fin ni se agrega.
 */
export function recetaAFlujo(receta, { sourceIds = [], organico = false, publicado = false } = {}) {
  let contador = 0
  const nuevoId = () => `n${++contador}`
  const nodos = []
  const lineas = []
  let y = 0

  const disparadorId = 'disparador'
  nodos.push({
    id: disparadorId,
    tipo: 'disparador',
    pos: { x: 0, y },
    datos: { tipo: organico ? 'organico' : 'anuncio', sourceIds: organico ? [] : sourceIds, palabras: [] },
  })
  y += 140

  let anteriorId = disparadorId
  for (const paso of Array.isArray(receta?.pasos) ? receta.pasos : []) {
    if (paso?.tipo !== 'respuesta') continue
    const id = nuevoId()
    nodos.push({
      id,
      tipo: 'mensaje',
      pos: { x: 0, y },
      datos: { origen: 'respuesta', respuestaId: paso.respuestaId, texto: '', adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '' },
    })
    lineas.push({ id: `${anteriorId}-siguiente-${id}`, de: anteriorId, puerto: 'siguiente', a: id, esperaMin: 0 })
    anteriorId = id
    y += 140
  }

  const textoPregunta = String(receta?.pregunta?.texto || '').trim()
  let terminaEnBotones = false
  if (textoPregunta) {
    const id = nuevoId()
    const botones = Array.isArray(receta.pregunta.botones) ? receta.pregunta.botones : []
    nodos.push({
      id,
      tipo: 'mensaje',
      pos: { x: 0, y },
      datos: { origen: 'texto', texto: textoPregunta, adjuntos: [], botones, esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '' },
    })
    lineas.push({ id: `${anteriorId}-siguiente-${id}`, de: anteriorId, puerto: 'siguiente', a: id, esperaMin: 0 })
    anteriorId = id
    y += 140
    terminaEnBotones = normalizarBotones(botones).length > 0
  }

  if (!terminaEnBotones) {
    const finId = nuevoId()
    nodos.push({ id: finId, tipo: 'fin', pos: { x: 0, y }, datos: {} })
    lineas.push({ id: `${anteriorId}-siguiente-${finId}`, de: anteriorId, puerto: 'siguiente', a: finId, esperaMin: 0 })
  }

  return { nombre: receta?.nombre || '', publicado, grafo: { nodos, lineas } }
}

/** Un flujo recién creado: Disparador orgánico y Fin, ya conectados y válidos. */
export function nuevoGrafo() {
  return {
    nodos: [
      { id: 'disparador', tipo: 'disparador', pos: { x: 0, y: 0 }, datos: { tipo: 'organico', sourceIds: [], palabras: [] } },
      { id: 'fin', tipo: 'fin', pos: { x: 0, y: 300 }, datos: {} },
    ],
    lineas: [{ id: 'disparador-siguiente-fin', de: 'disparador', puerto: 'siguiente', a: 'fin', esperaMin: 0 }],
  }
}
