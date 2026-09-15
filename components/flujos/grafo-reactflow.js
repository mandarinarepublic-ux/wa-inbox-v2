// components/flujos/grafo-reactflow.js — el puente entre el GRAFO y el LIENZO.
//
// La fuente de la verdad es siempre el grafo de `lib/flujo.js`
// (`{ nodos:[{id,tipo,pos,datos}], lineas:[{id,de,puerto,a,esperaMin,esperaSeg?}] }`): es lo
// que se guarda, lo que se valida y lo que ejecuta el motor. React Flow tiene su
// propio vocabulario (`nodes`/`edges`, `type`, `position`, `data`, `sourceHandle`)
// y lo llena de cosas suyas al vuelo — `selected`, `dragging`, `measured`,
// `width`, `height`, posiciones absolutas—.
//
// ☠️ POR QUÉ LA CONVERSIÓN VIVE EN UN MÓDULO APARTE Y PURO. Si el lienzo guardara
// directamente sus `nodes`/`edges`, en la base terminaría el estado interno de una
// librería: basura hoy, y mañana un cambio de versión de React Flow moviendo lo
// que corre en producción. Acá se traduce en los dos bordes (al cargar y al
// guardar) y se tira todo lo que no sea del grafo. Por eso `deReactFlow` copia
// campo por campo en vez de esparcir el objeto entero.
//
// Sin JSX ni React a propósito: así `node --test` lo puede importar tal cual.

/** '⏱ 3 s' · '⏱ 1 h 30 min' · '⏱ 45 min' · '⏱ 2 h'. Vacío si no hay espera. */
export function etiquetaEspera(min, seg = 0) {
  const s = Math.round(Number(seg) || 0)
  if (s > 0 && !(Number(min) > 0)) return `⏱ ${s} s`
  const m = Math.round(Number(min) || 0)
  if (!m || m < 0) return ''
  const horas = Math.floor(m / 60)
  const minutos = m % 60
  if (horas && minutos) return `⏱ ${horas} h ${minutos} min`
  if (horas) return `⏱ ${horas} h`
  return `⏱ ${minutos} min`
}

/** Grafo → lo que dibuja React Flow. */
export function aReactFlow(grafo) {
  const nodos = (Array.isArray(grafo?.nodos) ? grafo.nodos : []).filter(Boolean)
  const lineas = (Array.isArray(grafo?.lineas) ? grafo.lineas : []).filter(Boolean)

  const nodes = nodos.map((n) => ({
    id: n.id,
    type: n.tipo,
    position: { x: Number(n.pos?.x) || 0, y: Number(n.pos?.y) || 0 },
    // Copia: si se pasara `n.datos` tal cual, el panel de edición estaría
    // escribiendo dentro del grafo cargado y "Deshacer" no tendría a qué volver.
    data: { ...(n.datos || {}) },
    // El Disparador no se borra NUNCA: es el único nodo obligatorio del flujo
    // (`validarFlujo` exige exactamente uno) y un lienzo sin él no se puede
    // publicar. React Flow respeta esta bandera tanto con la tecla Supr como al
    // borrar por código, así que la regla vive en un solo lado.
    deletable: n.tipo !== 'disparador',
  }))

  const edges = lineas.map((l) => {
    const espera = Number(l.esperaMin) || 0
    const seg = Number(l.esperaSeg) || 0
    return {
      id: l.id,
      source: l.de,
      sourceHandle: l.puerto,
      target: l.a,
      targetHandle: 'in',
      label: etiquetaEspera(espera, seg),
      data: { esperaMin: espera, esperaSeg: seg },
    }
  })

  return { nodes, edges }
}

/** Lo que dibuja React Flow → grafo, listo para guardar o validar. */
export function deReactFlow(nodes, edges) {
  const nodos = (Array.isArray(nodes) ? nodes : []).filter(Boolean).map((n) => ({
    id: n.id,
    tipo: n.type,
    // Enteros: arrastrar deja decimales de píxel que solo ensucian el jsonb y
    // marcarían el flujo como "con cambios sin guardar" por haberlo rozado.
    pos: { x: Math.round(Number(n.position?.x) || 0), y: Math.round(Number(n.position?.y) || 0) },
    datos: { ...(n.data || {}) },
  }))

  const lineas = (Array.isArray(edges) ? edges : []).filter(Boolean).map((e) => {
    const linea = {
      id: e.id,
      de: e.source,
      puerto: e.sourceHandle,
      a: e.target,
      esperaMin: Number(e.data?.esperaMin) || 0,
    }
    // `esperaSeg` solo si hay pausa: así un flujo guardado antes de que existieran
    // los segundos no aparece "con cambios sin guardar" por el solo hecho de abrirlo.
    const seg = Number(e.data?.esperaSeg) || 0
    if (seg > 0) linea.esperaSeg = seg
    return linea
  })

  return { nodos, lineas }
}
