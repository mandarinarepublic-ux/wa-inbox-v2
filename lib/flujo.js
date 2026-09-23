// lib/flujo.js — FLUJOS: el grafo de nodos, su validación y su ejecución lineal.
// Módulo PURO (sin red ni base). Ver docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md.
//
// Un flujo es un grafo { nodos, lineas } con exactamente un Disparador. Fase A solo
// corre el CAMINO LINEAL (sin ramas): el motor entra por caminoLineal y sale con las
// piezas para /api/saliente. Las ramas (botones, condición, espera) quedan dibujadas
// y validadas, pero se ejecutan recién en la Fase B (estado por cliente).
import { adjuntosDeRespuesta } from './adjuntos-respuesta.js'
import { temperaturaDe } from './temperatura.js'
import { pieza, interactivo, normalizarBotones, MAX_PIEZAS, MAX_BOTONES, MAX_TITULO } from './recetas.js'

export const TIPOS_NODO = ['disparador', 'mensaje', 'condicion', 'fin']
// Meta corta la ventana de conversación a las 24h; una espera de 23h deja un margen
// de una hora para que el motor (que corre por cron/al vuelo) alcance a mandarla.
export const MAX_ESPERA_MIN = 23 * 60
// Pausa CORTA en la línea, en segundos (15-sep-2026): el motor la espera en el
// mismo envío, entre una pieza y la siguiente, sin guardar estado ni pasar por el
// cron. Dos topes: por línea, y sumando todas las de una tanda — la tanda corre
// dentro del webhook, que vive 60 s y todavía tiene que mandar las piezas.
export const MAX_ESPERA_SEG = 20
export const MAX_PAUSA_TANDA_SEG = 30

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
    // 'foto': el cliente contestó con una imagen en vez de tocar un botón. Si esa
    // salida no tiene línea, la foto sigue por 'otra' como siempre (port desde IND).
    if (botones.length) return [...botones.map((_, i) => `btn_${i + 1}`), 'foto', 'otra']
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

/** `esperaSeg` de una línea: misma lectura que `esperaMinDe` (vacío = 0, basura = NaN). */
const segundosDe = (valor) => esperaMinDe(valor)

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
    if (dt.tipo === 'boton') {
      if (!normalizarTexto(dt.boton)) {
        errores.push({ nodoId: d.id, texto: 'El Disparador de botón necesita el título del botón' })
      } else if (String(dt.boton).trim().length > MAX_TITULO) {
        // WhatsApp no deja un botón de más de 20 letras: este flujo nunca correría.
        errores.push({ nodoId: d.id, texto: `el título del botón no puede pasar de ${MAX_TITULO} letras` })
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
    const seg = segundosDe(l.esperaSeg)
    if (Number.isNaN(seg)) {
      errores.push({ lineaId: l.id, texto: 'la pausa en segundos no es un número' })
    } else if (seg < 0 || seg > MAX_ESPERA_SEG) {
      errores.push({ lineaId: l.id, texto: `la pausa debe ir entre 0 y ${MAX_ESPERA_SEG} segundos` })
    } else if (seg > 0 && Number.isFinite(espera) && espera > 0) {
      errores.push({ lineaId: l.id, texto: 'la línea tiene segundos y minutos a la vez: elige uno' })
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

  // Ciclos: solo cuentan las líneas SIN espera (esperaMin 0 o inválida). Una pausa
  // en SEGUNDOS no cuenta como espera: corre de corrido, así que un ciclo hecho solo
  // de pausas en segundos nunca termina y sigue siendo un error — un ciclo
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
  if (propio?.tipo === 'boton' && otro?.tipo === 'boton') {
    const t = normalizarTexto(propio.boton)
    if (t && t === normalizarTexto(otro.boton)) return 'mismo botón'
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

/**
 * El título del botón que el cliente TOCÓ, leído del crudo de Meta; '' si no tocó
 * ninguno. Un botón llega al inbox como `tipo:'texto'` con el título en el
 * contenido (lib/wa-mensaje.js), así que el contenido no sirve para distinguir un
 * toque de alguien que ESCRIBIÓ lo mismo: por eso se mira `raw.type`.
 *  - `interactive.button_reply`: botón de una respuesta rápida o de un flujo.
 *  - `button`: botón de respuesta rápida de una PLANTILLA.
 */
export function tituloBotonTocado(raw) {
  if (raw?.type === 'interactive' && raw.interactive?.type === 'button_reply') {
    return String(raw.interactive.button_reply?.title || '')
  }
  if (raw?.type === 'button') return String(raw.button?.text || '')
  return ''
}

/**
 * El flujo publicado cuyo Disparador "Botón tocado" tiene ESTE título, o null.
 *
 * Título EXACTO (normalizado), nunca "contiene": no es una palabra clave. El que
 * toca "Banco Pichincha" eligió esa opción; una coincidencia parcial dispararía el
 * flujo de otro botón. Vive aparte de elegirFlujo a propósito: ese corre con
 * guardas (ignora toques y se calla con una persona atendiendo) que acá serían
 * justo lo contrario de lo que se quiere, porque el botón lo mandó el vendedor.
 */
export function elegirFlujoPorBoton({ flujos, titulo }) {
  const t = normalizarTexto(titulo)
  if (!t) return null
  const candidatos = (Array.isArray(flujos) ? flujos : []).filter((f) => f?.publicado && f?.grafo_vivo)
  return candidatos.find((f) => {
    const d = nodoDisparador(f.grafo_vivo)
    return d?.datos?.tipo === 'boton' && normalizarTexto(d.datos.boton) === t
  }) || null
}

// Tope de pasos al recorrer el camino: contra un grafo con ciclo que la validación
// no haya cazado (o uno guardado como borrador roto), esto evita un bucle infinito.
const TOPE_PASOS_CAMINO = 50

/**
 * Camina el grafo desde (nodoId, puerto) siguiendo líneas hasta el primer punto
 * que necesita algo que este módulo puro no tiene: la respuesta del cliente
 * (botones / esperar), el reloj (espera en la línea) o —si no se pasa `evaluar`—
 * una Condición. Devuelve los Mensajes a mandar EN ORDEN y por qué se detuvo.
 *
 *  - `saltarEsperaInicial`: la PRIMERA línea se sigue aunque tenga espera. Así
 *    reanuda el cron: el cliente estaba parado en el origen de esa línea y la
 *    espera ya se cumplió.
 *  - `evaluar(nodoCondicion) → true|false`: si se pasa, la Condición se resuelve
 *    en el momento y se sigue por `si`/`no`; si no, se detiene ahí.
 *  - `pausasSeg`: segundos a esperar ANTES de cada mensaje (alineado con
 *    `mensajes`). Una pausa en segundos NO detiene el camino.
 *  - `visitados`: TODOS los nodos por los que pasó (mensajes, condiciones, fin),
 *    para la bitácora de pasos (contadores por nodo). No incluye el de arranque.
 *
 * Se detiene, en este orden:
 *  1. la línea que toca seguir tiene una espera que no es un número → 'huerfano'.
 *  2. la línea tiene espera (`esperaMin>0`) y no es la inicial saltada → 'espera'
 *     (trae `lineaEspera`, `puertoEspera`, `esperaMin`; el destino NO se agrega).
 *  3. destino Condición sin `evaluar` → 'condicion'.
 *  4. destino Mensaje → SIEMPRE se agrega; con botones → 'botones'; si no y
 *     `esperarRespuesta` → 'esperar_respuesta'.
 *  5. destino Fin, o el puerto no tiene línea → 'fin'.
 *  6. el nodo de arranque o el destino no existen → 'huerfano'.
 *
 * `detenidoEn` es el nodo donde queda "parado" el cliente (lo que se graba en
 * `flujo_estado.nodo_id`): el Mensaje esperado · la Condición · el Fin (o el
 * último nodo si el puerto no tenía línea) · el ORIGEN de la línea que espera ·
 * el último nodo válido antes de una rotura.
 */
export function avanzarDesde(grafo, { nodoId, puerto, saltarEsperaInicial = false, evaluar = null } = {}) {
  const nodos = (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean)
  const lineas = (Array.isArray(grafo?.lineas) ? grafo.lineas : []).filter(Boolean)
  const porId = new Map(nodos.map((n) => [n.id, n]))
  const lineaDe = (id, p) => lineas.find((l) => l.de === id && l.puerto === p)

  const mensajes = []
  const visitados = []
  // Segundos de pausa ANTES de cada mensaje, alineado con `mensajes`. Una pausa que
  // cae antes de una Condición se suma a la del siguiente mensaje que sí sale.
  const pausasSeg = []
  let pendienteSeg = 0
  const salir = (resto) => ({ mensajes, visitados, pausasSeg, ...resto })

  if (!porId.has(nodoId)) return salir({ detenidoEn: null, motivo: 'huerfano' })
  let actualId = nodoId
  let puertoActual = puerto

  for (let paso = 0; paso < TOPE_PASOS_CAMINO; paso++) {
    const linea = lineaDe(actualId, puertoActual)
    if (!linea) return salir({ detenidoEn: actualId, motivo: 'fin' })

    const espera = esperaMinDe(linea.esperaMin)
    const seg = segundosDe(linea.esperaSeg)
    if (Number.isNaN(espera) || Number.isNaN(seg)) return salir({ detenidoEn: actualId, motivo: 'huerfano' })
    if (espera > 0 && !(saltarEsperaInicial && paso === 0)) {
      return salir({ detenidoEn: actualId, lineaEspera: linea.id, puertoEspera: puertoActual, esperaMin: espera, motivo: 'espera' })
    }
    // Una pausa en SEGUNDOS no detiene nada: se anota y el camino sigue de corrido.
    if (seg > 0) pendienteSeg += seg

    const destino = porId.get(linea.a)
    if (!destino) return salir({ detenidoEn: actualId, motivo: 'huerfano' })

    if (destino.tipo === 'fin') {
      visitados.push(destino.id)
      return salir({ detenidoEn: destino.id, motivo: 'fin' })
    }
    if (destino.tipo === 'condicion') {
      if (typeof evaluar !== 'function') return salir({ detenidoEn: destino.id, motivo: 'condicion' })
      visitados.push(destino.id)
      actualId = destino.id
      puertoActual = evaluar(destino) ? 'si' : 'no'
      continue
    }
    if (destino.tipo === 'mensaje') {
      mensajes.push(destino)
      pausasSeg.push(pendienteSeg)
      pendienteSeg = 0
      visitados.push(destino.id)
      const puertos = puertosDe(destino)
      if (puertos.some((p) => p.startsWith('btn_'))) return salir({ detenidoEn: destino.id, motivo: 'botones' })
      if (puertos.includes('respuesta')) return salir({ detenidoEn: destino.id, motivo: 'esperar_respuesta' })
      actualId = destino.id
      puertoActual = 'siguiente'
      continue
    }
    // Disparador u otro tipo como destino: en un grafo válido no pasa; mejor parar.
    return salir({ detenidoEn: actualId, motivo: 'huerfano' })
  }
  return salir({ detenidoEn: actualId, motivo: 'huerfano' })
}

/**
 * El camino desde el Disparador SIN resolver condiciones (contrato de la Fase A:
 * lo usa el webhook como guardia de forma antes de marcar al cliente).
 */
export function caminoLineal(grafo) {
  const disparador = nodoDisparador(grafo)
  if (!disparador) return { mensajes: [], visitados: [], pausasSeg: [], detenidoEn: null, motivo: 'huerfano' }
  return avanzarDesde(grafo, { nodoId: disparador.id, puerto: 'siguiente' })
}

/**
 * Las piezas para /api/saliente de una tanda de nodos Mensaje, EN ORDEN: la misma
 * receta que ya arma lib/recetas.js (piezasDeReceta), generalizada a nodos. Un
 * nodo `origen=respuesta` cuya respuesta ya no existe se salta con log — mejor un
 * paquete incompleto que uno mudo. `citaId`: wamid del entrante; solo la PRIMERA
 * pieza sale citándolo (ver lib/recetas.js para el porqué).
 *
 * `pausasSeg` (alineado con `nodos`, sale de avanzarDesde): la pausa de cada nodo
 * viaja en `_esperaSeg` de la PRIMERA pieza de ese nodo. Es un campo INTERNO:
 * correrTanda lo espera y lo saca antes de llamar a /api/saliente. Un nodo que no
 * da piezas pasa su pausa al siguiente, y el total se recorta a MAX_PAUSA_TANDA_SEG.
 */
export function piezasDeNodos({ nodos, respuestas, contacto, citaId = '', pausasSeg = [] }) {
  const out = []
  let pendienteSeg = 0
  const porId = new Map((Array.isArray(respuestas) ? respuestas : []).map((r) => [String(r.id), r]))

  const lista = Array.isArray(nodos) ? nodos : []
  for (let i = 0; i < lista.length; i++) {
    const nodo = lista[i]
    if (!nodo) continue
    pendienteSeg += Math.max(0, Number(pausasSeg?.[i]) || 0)
    const antes = out.length
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

    if (pendienteSeg > 0 && out.length > antes) {
      out[antes] = { ...out[antes], _esperaSeg: pendienteSeg }
      pendienteSeg = 0
    }
  }

  if (out.length > MAX_PIEZAS) {
    console.warn('[flujo] camino con', out.length, 'piezas, se recorta a', MAX_PIEZAS)
  }
  const piezas = out.slice(0, MAX_PIEZAS)
  // Tope de pausas por tanda: el envío entero corre dentro del webhook (60 s).
  let restante = MAX_PAUSA_TANDA_SEG
  let recortada = false
  for (let i = 0; i < piezas.length; i++) {
    const s = piezas[i]._esperaSeg
    if (!s) continue
    const usar = Math.min(s, restante)
    if (usar < s) recortada = true
    restante -= usar
    const copia = { ...piezas[i] }
    if (usar > 0) copia._esperaSeg = usar
    else delete copia._esperaSeg
    piezas[i] = copia
  }
  if (recortada) console.warn('[flujo] las pausas de la tanda pasan de', MAX_PAUSA_TANDA_SEG, 's: se recortan')
  const cita = String(citaId || '').trim()
  if (cita && piezas.length) piezas[0] = { ...piezas[0], ContextoId: cita }
  return piezas
}

/**
 * La última ETAPA válida entre los nodos recorridos ("si llegas hasta acá estás
 * 💬 Cotizando"), o '' si ninguno la fija. Solo 💬 y 💳. Reemplaza a la
 * temperatura de los nodos (port desde IND, diseño 2026-09-22).
 */
export const ETAPAS_DE_FLUJO = ['cotizando', 'esperando_pago']
export function etapaAlPasar(nodos) {
  let ultima = ''
  for (const n of (Array.isArray(nodos) ? nodos : []).filter(Boolean)) {
    const e = n?.datos?.etapa
    if (ETAPAS_DE_FLUJO.includes(e)) ultima = e
  }
  return ultima
}

/** 📌 "Le debemos al llegar acá": la última nota no vacía entre los nodos recorridos. */
export function deudaAlPasar(nodos) {
  let ultima = ''
  for (const n of (Array.isArray(nodos) ? nodos : []).filter(Boolean)) {
    const d = String(n?.datos?.deuda || '').trim()
    if (d) ultima = d
  }
  return ultima
}

// ── Fase B: estado por cliente (puro) ────────────────────────────────────────
// La ventana de conversación de Meta: 24 h desde el último mensaje del CLIENTE.
export const VENTANA_MS = 24 * 3600 * 1000

/** 'HH:MM' en hora de Ecuador (America/Guayaquil). */
export function horaEcuador(fecha) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha)
  const h = partes.find((p) => p.type === 'hour')?.value || '00'
  const m = partes.find((p) => p.type === 'minute')?.value || '00'
  // Algunos motores dan "24" a medianoche con hour12:false.
  return `${h === '24' ? '00' : h}:${m}`
}

/**
 * Evalúa una Condición contra el contacto en ese momento. Cualquier cosa rara
 * (campo desconocido, rango de horas mal escrito, valor vacío) da FALSE: la rama
 * "no" es la segura, porque es la que el dueño dibujó para "no se cumplió".
 *  - temperatura: igual, sin mayúsculas ni acentos
 *  - tiene_venta: 'si'/'no' contra ctx.tieneVenta
 *  - bandeja: igual al estado de la conversación (pendiente/atendido/soporte/descartado)
 *  - hora: 'HH:MM-HH:MM' en hora de Ecuador; si el fin es menor que el inicio,
 *    el rango cruza la medianoche (22:00-06:00)
 */
export function evaluarCondicion(nodo, ctx) {
  const campo = String(nodo?.datos?.campo || '')
  const valor = normalizarTexto(nodo?.datos?.valor)
  if (!valor) return false
  if (campo === 'temperatura') {
    const ms = (ctx?.ahora instanceof Date ? ctx.ahora : new Date()).getTime()
    return temperaturaDe(ctx?.ultimoEntranteAt, ms) === valor
  }
  if (campo === 'etapa') return normalizarTexto(ctx?.etapa).replace(/ /g, '_') === valor.replace(/ /g, '_')
  if (campo === 'tiene_venta') {
    if (valor === 'si') return !!ctx?.tieneVenta
    if (valor === 'no') return !ctx?.tieneVenta
    return false
  }
  if (campo === 'bandeja') return normalizarTexto(ctx?.estado) === valor
  if (campo === 'hora') {
    const m = /^(\d{1,2}):(\d{2}) ?- ?(\d{1,2}):(\d{2})$/.exec(valor)
    if (!m) return false
    const ini = Number(m[1]) * 60 + Number(m[2])
    const fin = Number(m[3]) * 60 + Number(m[4])
    const [hh, mm] = horaEcuador(ctx?.ahora instanceof Date ? ctx.ahora : new Date()).split(':').map(Number)
    const ahora = hh * 60 + mm
    return ini <= fin ? (ahora >= ini && ahora < fin) : (ahora >= ini || ahora < fin)
  }
  return false
}

/**
 * Por qué puerto sigue el cliente según lo que mandó, parado en `nodo`:
 *  - con botones: el id `rc_N` del botón tocado → `btn_N` (mismo índice: los ids
 *    salen de normalizarBotones); si ESCRIBIÓ el título de un botón ("sí") también
 *    cuenta; cualquier otra cosa → 'otra'.
 *  - esperando respuesta (sin botones): lo que sea → 'respuesta'.
 *  - nodo que no espera nada: null.
 */
export function puertoDeEntrante(nodo, { botonId = '', texto = '', esFoto = false, conFoto = false } = {}) {
  const puertos = puertosDe(nodo)
  const botones = puertos.filter((p) => p.startsWith('btn_'))
  if (botones.length) {
    const m = /^rc_(\d+)$/.exec(String(botonId || '').trim())
    if (m && botones.includes(`btn_${m[1]}`)) return `btn_${m[1]}`
    const t = normalizarTexto(texto)
    const idx = normalizarBotones(nodo?.datos?.botones).findIndex((b) => normalizarTexto(b.title) === t)
    if (t && idx >= 0) return `btn_${idx + 1}`
    // Mandó una FOTO en vez de tocar un botón: solo si la salida 📸 tiene línea.
    if (esFoto && conFoto) return 'foto'
    return 'otra'
  }
  if (puertos.includes('respuesta')) return 'respuesta'
  return null
}

/**
 * Qué estado guardar cuando el camino se detuvo, o null si terminó y no hay nada
 * que esperar. Botones y respuesta esperan hasta el fin de la ventana de 24 h
 * (sin fecha de último entrante se cuenta desde ahora); una espera en la línea,
 * exactamente `esperaMin` (la ventana se comprueba al vencer, en el cron).
 */
export function paradaDeCamino(camino, { ahora, ultimoEntranteAt }) {
  const t0 = ultimoEntranteAt ? Date.parse(ultimoEntranteAt) : NaN
  const finVentana = new Date((Number.isFinite(t0) ? t0 : ahora.getTime()) + VENTANA_MS).toISOString()
  if (camino?.motivo === 'botones') return { esperando: 'boton', nodoId: camino.detenidoEn, puertoTiempo: null, venceAt: finVentana }
  if (camino?.motivo === 'esperar_respuesta') return { esperando: 'respuesta', nodoId: camino.detenidoEn, puertoTiempo: null, venceAt: finVentana }
  if (camino?.motivo === 'espera') {
    return {
      esperando: 'tiempo', nodoId: camino.detenidoEn, puertoTiempo: camino.puertoEspera,
      venceAt: new Date(ahora.getTime() + camino.esperaMin * 60 * 1000).toISOString(),
    }
  }
  return null
}

/**
 * El wamid que cita la PRIMERA pieza de una tanda. Al disparar se cita el mensaje
 * del cliente (spec §1: que no se sienta automático); después, solo si el primer
 * nodo de la tanda pide "citar la última respuesta".
 */
export function citaDeTanda({ nodos, esDisparo, wamidEntrante = '', ultimoWamid = '' }) {
  const primero = (Array.isArray(nodos) ? nodos : []).filter(Boolean)[0]
  if (!primero) return ''
  if (esDisparo) return String(wamidEntrante || '')
  return primero?.datos?.citarUltimaRespuesta ? String(ultimoWamid || '') : ''
}

/** ¿Sigue abierta la ventana de 24 h, con margen para que el envío alcance? Sin fecha → cerrada. */
export function ventanaAbierta(ultimoEntranteAt, ahora, margenMin = 5) {
  const t0 = ultimoEntranteAt ? Date.parse(ultimoEntranteAt) : NaN
  if (!Number.isFinite(t0)) return false
  return t0 + VENTANA_MS - margenMin * 60 * 1000 > ahora.getTime()
}

/**
 * Qué hacer con un entrante de un cliente que YA está dentro de un flujo.
 *  - 'seguir' + desde: avanzar desde el nodo donde está parado por el puerto que
 *    le toca a lo que mandó.
 *  - 'ignorar': está en una espera de reloj (la sigue el cron); su mensaje va a
 *    PENDIENTES como cualquier otro y una persona decide.
 *  - 'borrar': el estado ya no sirve (venció, el flujo se despublicó, el nodo ya
 *    no existe o no espera nada).
 */
export function decidirEntranteEnFlujo({ estado, flujo, entrante, ahora }) {
  if (!estado) return { accion: 'ignorar', motivo: 'sin estado' }
  const vence = Date.parse(estado.vence_at)
  if (!Number.isFinite(vence) || vence <= ahora.getTime()) return { accion: 'borrar', motivo: 'vencido' }
  if (!flujo?.publicado || !flujo?.grafo_vivo) return { accion: 'borrar', motivo: 'flujo no publicado' }
  if (estado.esperando === 'tiempo') return { accion: 'ignorar', motivo: 'esperando tiempo' }
  const nodo = (Array.isArray(flujo.grafo_vivo.nodos) ? flujo.grafo_vivo.nodos : []).filter(Boolean).find((n) => n.id === estado.nodo_id)
  if (!nodo) return { accion: 'borrar', motivo: 'nodo ya no existe' }
  const lineas = (Array.isArray(flujo.grafo_vivo.lineas) ? flujo.grafo_vivo.lineas : []).filter(Boolean)
  // 📸 la foto solo va por 'foto' si esa salida tiene línea (port desde IND).
  const conFoto = lineas.some((l) => l.de === nodo.id && l.puerto === 'foto')
  const puerto = puertoDeEntrante(nodo, { ...(entrante || {}), conFoto })
  if (!puerto) return { accion: 'borrar', motivo: 'el nodo no espera nada' }
  // Un puerto sin línea equivale a Fin, pero NO puede tragarse el mensaje: si se
  // "siguiera" hasta un Fin que no manda nada, el webhook daría el entrante por
  // atendido y ya no correría el flujo de ese botón. Caso real: un flujo que
  // termina en "¿Cómo prefieres pagar?" [Deuna] [Transferencia] [Tarjeta] — el
  // toque de Deuna tiene que caer en el flujo "Botón tocado: Deuna".
  if (!lineas.some((l) => l.de === nodo.id && l.puerto === puerto)) {
    return { accion: 'borrar', motivo: `el puerto "${puerto}" no sigue a ningún lado` }
  }
  return { accion: 'seguir', desde: { nodoId: estado.nodo_id, puerto } }
}

/** Una espera de reloj que ya se cumplió: ¿se sigue o se borra? Nunca fuera de la ventana de 24 h. */
export function decidirVencido({ estado, flujo, contacto, ahora }) {
  if (!ventanaAbierta(contacto?.ultimoEntranteAt || null, ahora)) return { accion: 'borrar', motivo: 'ventana cerrada' }
  if (!flujo?.publicado || !flujo?.grafo_vivo) return { accion: 'borrar', motivo: 'flujo no publicado' }
  const nodo = (Array.isArray(flujo.grafo_vivo.nodos) ? flujo.grafo_vivo.nodos : []).filter(Boolean).find((n) => n.id === estado?.nodo_id)
  if (!nodo || !estado?.puerto_tiempo) return { accion: 'borrar', motivo: 'nodo o puerto perdido' }
  return { accion: 'seguir', desde: { nodoId: estado.nodo_id, puerto: estado.puerto_tiempo, saltarEsperaInicial: true } }
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
      datos: { origen: 'respuesta', respuestaId: paso.respuestaId, texto: '', adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, etapa: '' },
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
      datos: { origen: 'texto', texto: textoPregunta, adjuntos: [], botones, esperarRespuesta: false, citarUltimaRespuesta: false, etapa: '' },
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
