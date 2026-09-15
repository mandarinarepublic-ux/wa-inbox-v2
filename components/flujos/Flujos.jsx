'use client'
// components/flujos/Flujos.jsx — la pestaña FLUJOS: lista + lienzo + panel.
//
// Ver docs/superpowers/specs/2026-09-15-flujos-lienzo-design.md (§5).
//
// ☠️ LA FUENTE DE LA VERDAD ES EL GRAFO, NO EL LIENZO. React Flow es solo el
// dibujo: se entra con `aReactFlow(grafo)` y se sale con `deReactFlow(nodes,
// edges)` justo antes de guardar, validar o publicar. Nada del estado interno de
// la librería llega a la base (ver components/flujos/grafo-reactflow.js).
//
// ⚠️ La validación que se ve en pantalla es LA MISMA función que corre el
// endpoint al publicar (`validarFlujo` de lib/flujo.js). Si acá se escribiera una
// versión "parecida", el lienzo diría que está bien y el servidor lo rechazaría
// —o peor, al revés—.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, MiniMap, Controls,
  useNodesState, useEdgesState, addEdge, useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  getFlujos, saveFlujo, publicarFlujo, deleteFlujo, importarRecetas, getPasosFlujo,
  fetchRepliesFromSheet, getAnuncios, getAutomatizaciones,
} from '@/lib/api-client'
import { nuevoGrafo, validarFlujo, nodoDisparador, puertosDe } from '@/lib/flujo'
import { aReactFlow, deReactFlow, etiquetaEspera } from './grafo-reactflow'
import { nodeTypes, CtxLienzo, COLORES } from './nodos'
import PanelEdicion from './PanelEdicion'

const BORDE = '#1e2d3d'
const SUPERFICIE = '#0d1828'
const MORADO = '#a78bfa'
const TOPE_HISTORIAL = 50

const boton = (color, activo = true) => ({
  background: activo ? `${color}1f` : 'rgba(255,255,255,.03)',
  border: `1px solid ${activo ? `${color}55` : BORDE}`,
  color: activo ? color : '#475569',
  borderRadius: 9, padding: '6px 12px', fontSize: 11, fontWeight: 800,
  cursor: activo ? 'pointer' : 'default', fontFamily: 'Outfit,sans-serif', whiteSpace: 'nowrap',
})

/** Ids nuevos: cortos, legibles en el jsonb y sin chance de chocar con los que ya hay. */
let contadorIds = 0
const nuevoIdLocal = (pre) => `${pre}${Date.now().toString(36).slice(-5)}${(++contadorIds).toString(36)}`

const DATOS_NUEVOS = {
  mensaje: () => ({ origen: 'texto', texto: '', adjuntos: [], botones: [], esperarRespuesta: false, citarUltimaRespuesta: false, temperatura: '' }),
  condicion: () => ({ campo: 'temperatura', valor: '' }),
  fin: () => ({}),
}

/** El resumen del Disparador que se lee en la lista de la izquierda. */
function resumenDisparador(grafo) {
  const d = nodoDisparador(grafo)
  const dt = d?.datos || {}
  if (dt.tipo === 'anuncio') return `📣 ${(dt.sourceIds || []).length} anuncio(s)`
  if (dt.tipo === 'palabra') {
    const ps = (dt.palabras || []).filter((p) => String(p || '').trim())
    return `🔤 ${ps.slice(0, 3).join(', ') || 'sin palabras'}${ps.length > 3 ? '…' : ''}`
  }
  if (dt.tipo === 'organico') return '🌱 Contacto nuevo'
  return '⚠️ Sin disparador'
}

/**
 * Publicado / borrador / con cambios sin publicar. La tercera es la que importa:
 * un flujo publicado cuyo borrador ya no es igual a `grafo_vivo` está corriendo
 * OTRA cosa que la que se ve en pantalla, y eso hay que decirlo.
 */
function estadoDe(f) {
  if (!f?.publicado) return { txt: 'Borrador', color: '#64748b' }
  if (JSON.stringify(f.grafo || null) !== JSON.stringify(f.grafo_vivo || null)) {
    return { txt: 'Cambios sin publicar', color: '#f59e0b' }
  }
  return { txt: 'Publicado', color: '#25d366' }
}

const fecha = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

// Los botones y el crédito de React Flow vienen con el tema claro de la librería.
const CSS_LIENZO = `
.flujos-lienzo .react-flow__controls-button{background:#0d1828;border-bottom:1px solid #1e2d3d;fill:#94a3b8}
.flujos-lienzo .react-flow__controls-button:hover{background:#16233a}
.flujos-lienzo .react-flow__attribution{background:transparent;color:#334155;font-size:9px}
.flujos-lienzo .react-flow__handle{cursor:crosshair}
`

function Lienzo({ active }) {
  const [flujos, setFlujos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [actual, setActual] = useState(null)        // { flujo_id|null, publicado }
  const [nombre, setNombre] = useState('')
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [seleccion, setSeleccion] = useState(null)  // { tipo:'nodo'|'linea', id }
  const [respuestas, setRespuestas] = useState([])
  const [anuncios, setAnuncios] = useState([])
  const [hayRecetas, setHayRecetas] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [toast, setToast] = useState(null)
  const [erroresPublicar, setErroresPublicar] = useState([])
  const [avisoImportar, setAvisoImportar] = useState(null)
  const [porBorrar, setPorBorrar] = useState('')
  const [puedeDeshacer, setPuedeDeshacer] = useState(false)
  const [puedeRehacer, setPuedeRehacer] = useState(false)

  const { screenToFlowPosition, getNodes, getEdges, fitView } = useReactFlow()
  const cajaRef = useRef(null)
  const firmaRef = useRef('')                       // nombre+grafo tal como se guardó
  const histRef = useRef({ pila: [], i: -1 })
  const saltandoRef = useRef(false)                 // true mientras se aplica deshacer/rehacer
  const relojToast = useRef(null)

  const avisar = useCallback((m) => {
    setToast(m)
    clearTimeout(relojToast.current)
    relojToast.current = setTimeout(() => setToast(null), 3000)
  }, [])
  useEffect(() => () => clearTimeout(relojToast.current), [])

  // Contadores por nodo (clientes distintos en 30 días) del flujo abierto. Se
  // piden al abrir otro flujo; `vivo` evita pintar los de uno que ya se cerró.
  const [pasos, setPasos] = useState({})
  useEffect(() => {
    let vivo = true
    setPasos({})
    if (actual?.flujo_id) {
      getPasosFlujo(actual.flujo_id).then((r) => { if (vivo) setPasos(r?.porNodo || {}) })
    }
    return () => { vivo = false }
  }, [actual?.flujo_id])

  // ── Carga ──────────────────────────────────────────────────────────────────
  const recargarLista = useCallback(async () => {
    const f = await getFlujos()
    const lista = Array.isArray(f?.flujos) ? f.flujos : []
    setFlujos(lista)
    return lista
  }, [])

  const cargarTodo = useCallback(async () => {
    setCargando(true)
    const [f, r, a, c] = await Promise.all([
      getFlujos(),
      fetchRepliesFromSheet().catch(() => []),
      getAnuncios().catch(() => null),
      getAutomatizaciones().catch(() => null),
    ])
    setFlujos(Array.isArray(f?.flujos) ? f.flujos : [])
    setRespuestas(Array.isArray(r) ? r : [])
    setAnuncios(a?.anuncios || [])
    setHayRecetas(((c?.config?.recetas?.lista) || []).length > 0)
    setCargando(false)
  }, [])

  // ⚠️ Se carga UNA sola vez, no cada vez que se entra a la pestaña (al revés que
  // AUTOMATIZACIONES): acá el lienzo puede tener un flujo a medio dibujar y sin
  // guardar, y recargar lo tiraría a la basura por el solo hecho de haber ido a
  // mirar un chat. Para traer cambios de otra pantalla está "↻".
  const yaCargue = useRef(false)
  useEffect(() => {
    if (!active || yaCargue.current) return
    yaCargue.current = true
    cargarTodo()
  }, [active, cargarTodo])

  // ── Abrir un flujo en el lienzo ────────────────────────────────────────────
  const abrir = useCallback((f, { guardado = true } = {}) => {
    const g = (f?.grafo && Array.isArray(f.grafo.nodos) && f.grafo.nodos.length) ? f.grafo : nuevoGrafo()
    const { nodes: ns, edges: es } = aReactFlow(g)
    const nom = f?.nombre || 'Flujo nuevo'
    saltandoRef.current = true
    setNodes(ns); setEdges(es)
    setActual({ flujo_id: f?.flujo_id || null, publicado: !!f?.publicado })
    setNombre(nom)
    setSeleccion(null)
    setErroresPublicar([])
    setAvisoImportar(null)
    firmaRef.current = guardado ? JSON.stringify({ nombre: nom, grafo: g }) : ''
    histRef.current = { pila: [g], i: 0 }
    setPuedeDeshacer(false); setPuedeRehacer(false)
    // Encuadrar después de que React Flow haya medido las tarjetas nuevas.
    setTimeout(() => { try { fitView({ padding: 0.25, duration: 300 }) } catch { /* lienzo desmontado */ } }, 60)
  }, [setNodes, setEdges, fitView])

  // ── Historial (deshacer / rehacer) ─────────────────────────────────────────
  // Se anota con retraso a propósito: arrastrar una tarjeta dispara decenas de
  // cambios y sin esto un solo "deshacer" movería la tarjeta un píxel.
  useEffect(() => {
    if (saltandoRef.current) { saltandoRef.current = false; return }
    const t = setTimeout(() => {
      const g = deReactFlow(nodes, edges)
      const h = histRef.current
      const txt = JSON.stringify(g)
      // Seleccionar una tarjeta también cambia `nodes`, pero no cambia el GRAFO:
      // sin esta comparación, cada clic gastaría un paso del historial.
      if (h.i >= 0 && JSON.stringify(h.pila[h.i]) === txt) return
      h.pila = [...h.pila.slice(0, h.i + 1), g]
      if (h.pila.length > TOPE_HISTORIAL) h.pila.shift()
      h.i = h.pila.length - 1
      setPuedeDeshacer(h.i > 0)
      setPuedeRehacer(false)
    }, 350)
    return () => clearTimeout(t)
  }, [nodes, edges])

  const aplicarGrafo = useCallback((g) => {
    const { nodes: ns, edges: es } = aReactFlow(g)
    saltandoRef.current = true
    setNodes(ns); setEdges(es)
  }, [setNodes, setEdges])

  const deshacer = useCallback(() => {
    const h = histRef.current
    if (h.i <= 0) return
    h.i -= 1
    aplicarGrafo(h.pila[h.i])
    setPuedeDeshacer(h.i > 0); setPuedeRehacer(true)
  }, [aplicarGrafo])

  const rehacer = useCallback(() => {
    const h = histRef.current
    if (h.i >= h.pila.length - 1) return
    h.i += 1
    aplicarGrafo(h.pila[h.i])
    setPuedeDeshacer(true); setPuedeRehacer(h.i < h.pila.length - 1)
  }, [aplicarGrafo])

  const alTeclado = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'z') return
    e.preventDefault()
    if (e.shiftKey) rehacer(); else deshacer()
  }, [deshacer, rehacer])

  // ── Grafo, validación ──────────────────────────────────────────────────────
  const grafo = useMemo(() => deReactFlow(nodes, edges), [nodes, edges])
  const errores = useMemo(() => validarFlujo(grafo, { respuestas }), [grafo, respuestas])

  const erroresPorNodo = useMemo(() => {
    const m = {}
    for (const e of [...errores, ...erroresPublicar]) {
      if (e?.nodoId) (m[e.nodoId] = m[e.nodoId] || []).push(e.texto)
    }
    return m
  }, [errores, erroresPublicar])

  const erroresPorLinea = useMemo(() => {
    const m = {}
    for (const e of [...errores, ...erroresPublicar]) {
      if (e?.lineaId) (m[e.lineaId] = m[e.lineaId] || []).push(e.texto)
    }
    return m
  }, [errores, erroresPublicar])

  const erroresSueltos = useMemo(
    () => [...errores, ...erroresPublicar].filter((e) => !e?.nodoId && !e?.lineaId).map((e) => e.texto),
    [errores, erroresPublicar],
  )

  const firma = useMemo(() => JSON.stringify({ nombre, grafo }), [nombre, grafo])
  const sinGuardar = !!actual && (!actual.flujo_id || firma !== firmaRef.current)

  // ── Edición del lienzo ─────────────────────────────────────────────────────
  const onConnect = useCallback((c) => {
    if (!c.source || !c.target) return
    if (c.source === c.target) { avisar('⚠️ Una tarjeta no se conecta consigo misma'); return }
    // UN PUERTO, UNA LÍNEA: con dos, el motor no sabría cuál seguir (y
    // `validarFlujo` lo rechaza). Mejor no dejar dibujarlo que dejarlo y
    // explicarlo después.
    if (getEdges().some((e) => e.source === c.source && e.sourceHandle === c.sourceHandle)) {
      avisar('⚠️ Esa salida ya tiene una línea: quítala primero')
      return
    }
    setEdges((eds) => addEdge({
      ...c, id: nuevoIdLocal('l'), targetHandle: 'in', label: '', data: { esperaMin: 0, esperaSeg: 0 },
    }, eds))
  }, [avisar, getEdges, setEdges])

  const alCambiarSeleccion = useCallback(({ nodes: ns, edges: es }) => {
    if (ns.length === 1 && es.length === 0) setSeleccion({ tipo: 'nodo', id: ns[0].id })
    else if (es.length === 1 && ns.length === 0) setSeleccion({ tipo: 'linea', id: es[0].id })
    else setSeleccion(null)
  }, [])

  const agregarNodo = useCallback((tipo) => {
    const caja = cajaRef.current?.getBoundingClientRect()
    const centro = caja
      ? screenToFlowPosition({ x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 })
      : { x: 0, y: 0 }
    const id = nuevoIdLocal('n')
    setNodes((ns) => [
      ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
      { id, type: tipo, position: { x: Math.round(centro.x - 114), y: Math.round(centro.y - 40) }, data: DATOS_NUEVOS[tipo](), deletable: true, selected: true },
    ])
    setSeleccion({ tipo: 'nodo', id })
  }, [screenToFlowPosition, setNodes])

  const borrarSeleccion = useCallback(() => {
    if (!seleccion) return
    if (seleccion.tipo === 'nodo') {
      const n = getNodes().find((x) => x.id === seleccion.id)
      if (n?.type === 'disparador') { avisar('⚠️ El Disparador no se puede borrar'); return }
      setNodes((ns) => ns.filter((x) => x.id !== seleccion.id))
      setEdges((es) => es.filter((e) => e.source !== seleccion.id && e.target !== seleccion.id))
    } else {
      setEdges((es) => es.filter((e) => e.id !== seleccion.id))
    }
    setSeleccion(null)
  }, [seleccion, getNodes, setNodes, setEdges, avisar])

  const cambiarNodo = useCallback((parcial) => {
    if (seleccion?.tipo !== 'nodo') return
    const id = seleccion.id
    const previo = getNodes().find((n) => n.id === id)
    if (!previo) return
    const data = { ...previo.data, ...parcial }
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)))
    // Quitar un botón borra su puerto: la línea que colgaba de ahí quedaría
    // apuntando a una salida que ya no existe (error de validación y, si
    // alguien lo publicara igual, una rama muerta). Se poda en el momento.
    const puertos = puertosDe({ tipo: previo.type, datos: data })
    setEdges((es) => es.filter((e) => e.source !== id || puertos.includes(e.sourceHandle)))
  }, [seleccion, getNodes, setNodes, setEdges])

  // Recibe las DOS esperas juntas: el editor de la línea limpia la que no se usa
  // (segundos = pausa de corrido · minutos/horas = el flujo se detiene).
  const cambiarEspera = useCallback(({ esperaMin = 0, esperaSeg = 0 } = {}) => {
    if (seleccion?.tipo !== 'linea') return
    const id = seleccion.id
    setEdges((es) => es.map((e) => (e.id === id
      ? { ...e, data: { ...(e.data || {}), esperaMin, esperaSeg }, label: etiquetaEspera(esperaMin, esperaSeg) }
      : e)))
  }, [seleccion, setEdges])

  // ── Guardar / publicar / borrar ────────────────────────────────────────────
  const guardar = useCallback(async () => {
    if (!actual) return
    const nom = nombre.trim() || 'Flujo sin nombre'
    const g = deReactFlow(getNodes(), getEdges())
    setTrabajando(true)
    const r = await saveFlujo({ flujo_id: actual.flujo_id || undefined, nombre: nom, grafo: g })
    setTrabajando(false)
    if (!r?.ok) { avisar('❌ No se pudo guardar: ' + (r?.error || 'reintenta')); return }
    const f = r.flujo || {}
    setActual({ flujo_id: f.flujo_id || actual.flujo_id, publicado: !!f.publicado })
    setNombre(nom)
    firmaRef.current = JSON.stringify({ nombre: nom, grafo: g })
    await recargarLista()
    avisar('✅ Borrador guardado')
  }, [actual, nombre, getNodes, getEdges, recargarLista, avisar])

  const publicar = useCallback(async (quiero) => {
    if (!actual?.flujo_id) { avisar('⚠️ Guarda el borrador antes de publicar'); return }
    // ☠️ Publicar copia `grafo` (lo GUARDADO) a `grafo_vivo`. Con cambios sin
    // guardar, el servidor publicaría una versión anterior a la que se está
    // viendo — y nadie lo notaría hasta que un cliente reciba lo que no es.
    if (quiero && sinGuardar) { avisar('⚠️ Guarda el borrador antes de publicar'); return }
    setTrabajando(true)
    const r = await publicarFlujo(actual.flujo_id, quiero)
    setTrabajando(false)
    if (!r?.ok) {
      setErroresPublicar(Array.isArray(r?.errores) ? r.errores : [{ texto: r?.error || 'No se pudo publicar' }])
      avisar('❌ No se pudo publicar: mira los errores en rojo')
      return
    }
    setErroresPublicar([])
    setActual((a) => ({ ...a, publicado: quiero }))
    await recargarLista()
    avisar(quiero ? '🚀 Publicado' : '⏸ Despublicado')
  }, [actual, sinGuardar, recargarLista, avisar])

  // Eliminar en DOS clics, sin `confirm()`: el diálogo del navegador bloquea la
  // pestaña entera y acá al lado hay un inbox en vivo.
  const eliminar = useCallback(async (f) => {
    if (porBorrar !== f.flujo_id) {
      setPorBorrar(f.flujo_id)
      setTimeout(() => setPorBorrar((p) => (p === f.flujo_id ? '' : p)), 4000)
      return
    }
    setPorBorrar('')
    setTrabajando(true)
    const r = await deleteFlujo(f.flujo_id)
    setTrabajando(false)
    if (!r?.ok) { avisar('❌ No se pudo eliminar'); return }
    await recargarLista()
    if (actual?.flujo_id === f.flujo_id) {
      setActual(null); setNombre(''); setSeleccion(null)
      saltandoRef.current = true
      setNodes([]); setEdges([])
    }
    avisar('🗑 Flujo eliminado')
  }, [porBorrar, actual, recargarLista, setNodes, setEdges, avisar])

  const importar = useCallback(async () => {
    setTrabajando(true)
    const r = await importarRecetas()
    setTrabajando(false)
    if (!r?.ok) { avisar('❌ No se pudieron importar: ' + (r?.error || 'reintenta')); return }
    await cargarTodo()
    setAvisoImportar({ creados: r.creados || 0, saltados: r.saltados || 0, sinPublicar: Array.isArray(r.sinPublicar) ? r.sinPublicar : [] })
    avisar(`✅ ${r.creados || 0} flujo(s) creado(s)`)
  }, [cargarTodo, avisar])

  // ── Pintado ────────────────────────────────────────────────────────────────
  const edgesPintados = useMemo(() => edges.map((e) => {
    const espera = Number(e.data?.esperaMin) || 0
    const pausa = Number(e.data?.esperaSeg) || 0
    const roto = !!erroresPorLinea[e.id]
    return {
      ...e,
      // Punteada = espera en minutos u horas (el flujo se detiene y lo retoma el
      // cron). Continua y morada = pausa en segundos (sigue de corrido).
      style: {
        stroke: roto ? '#f87171' : espera ? '#94a3b8' : pausa ? '#a78bfa' : '#334155',
        strokeWidth: e.selected ? 2.4 : 1.6,
        strokeDasharray: espera ? '6 4' : undefined,
      },
      labelStyle: { fill: '#cbd5e1', fontSize: 10, fontFamily: 'Outfit,sans-serif', fontWeight: 700 },
      labelBgStyle: { fill: SUPERFICIE, stroke: BORDE },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 6,
    }
  }), [edges, erroresPorLinea])

  const ctx = useMemo(() => ({ erroresPorNodo, respuestas, anuncios, pasos }), [erroresPorNodo, respuestas, anuncios, pasos])

  const nodoSel = seleccion?.tipo === 'nodo' ? nodes.find((n) => n.id === seleccion.id) : null
  const lineaSel = seleccion?.tipo === 'linea' ? edges.find((e) => e.id === seleccion.id) : null
  const erroresSel = seleccion
    ? (seleccion.tipo === 'nodo' ? (erroresPorNodo[seleccion.id] || []) : (erroresPorLinea[seleccion.id] || []))
    : []

  const totalErrores = errores.length + erroresPublicar.length

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', height: '100%', overflow: 'hidden', background: '#070d15', fontFamily: 'Outfit,sans-serif' }}>
      <style>{CSS_LIENZO}</style>

      {/* ══════ COLUMNA IZQUIERDA — los flujos ══════ */}
      <div style={{ width: 236, flexShrink: 0, borderRight: `1px solid ${BORDE}`, display: 'flex', flexDirection: 'column', background: '#080f1a' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, fontSize: 11, fontWeight: 900, letterSpacing: '1.4px', color: MORADO }}>🧭 FLUJOS</div>
          <button onClick={cargarTodo} title="Volver a leer los flujos" style={boton('#64748b')}>↻</button>
        </div>

        <div style={{ padding: 10, borderBottom: `1px solid ${BORDE}` }}>
          <button onClick={() => abrir({ nombre: 'Flujo nuevo', grafo: nuevoGrafo() }, { guardado: false })}
            style={{ ...boton(MORADO), width: '100%' }}>+ Nuevo flujo</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {cargando && <div style={{ fontSize: 11, color: '#64748b', padding: 8 }}>Cargando…</div>}
          {!cargando && flujos.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
              Todavía no hay ningún flujo.
              {hayRecetas && (
                <button onClick={importar} disabled={trabajando}
                  style={{ ...boton('#f59e0b'), width: '100%', marginTop: 10, padding: '8px 10px' }}>
                  ⬇️ Importar las recetas de AUTOS
                </button>
              )}
            </div>
          )}

          {flujos.map((f) => {
            const est = estadoDe(f)
            const abierto = actual?.flujo_id === f.flujo_id
            return (
              <div key={f.flujo_id} onClick={() => !abierto && abrir(f)} style={{
                padding: '8px 9px', borderRadius: 10, marginBottom: 6, cursor: abierto ? 'default' : 'pointer',
                border: `1px solid ${abierto ? `${MORADO}66` : BORDE}`,
                background: abierto ? `${MORADO}0f` : SUPERFICIE,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.nombre || '(sin nombre)'}
                </div>
                <div style={{ fontSize: 9, fontWeight: 800, color: est.color, marginTop: 2 }}>● {est.txt}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{resumenDisparador(f.grafo)}</div>
                <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{fecha(f.actualizado_at)}</div>
                <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                  <button onClick={(e) => { e.stopPropagation(); abrir({ nombre: `${f.nombre} (copia)`, grafo: f.grafo }, { guardado: false }) }}
                    title="Duplicar" style={{ ...boton('#64748b'), padding: '3px 8px', fontSize: 10 }}>⧉</button>
                  <button onClick={(e) => { e.stopPropagation(); eliminar(f) }}
                    title={porBorrar === f.flujo_id ? 'Toca otra vez para eliminar' : 'Eliminar'}
                    style={{ ...boton('#f87171'), padding: '3px 8px', fontSize: 10 }}>
                    {porBorrar === f.flujo_id ? '¿Seguro?' : '🗑'}
                  </button>
                </div>
              </div>
            )
          })}

          {avisoImportar && (
            <div style={{ marginTop: 8, padding: 9, borderRadius: 9, border: `1px solid ${BORDE}`, background: SUPERFICIE, fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
              <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Importación</div>
              <div>{avisoImportar.creados} creados · {avisoImportar.saltados} ya estaban</div>
              {avisoImportar.sinPublicar.map((s, i) => (
                <div key={i} style={{ color: '#f59e0b', marginTop: 3 }}>
                  «{s.nombre}» quedó en borrador: {(s.errores || []).map((e) => e.texto).join(' · ')}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══════ CENTRO — cabecera + lienzo ══════ */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!actual ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13, textAlign: 'center', padding: 24 }}>
            <div>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🧭</div>
              Elige un flujo de la izquierda o crea uno nuevo.
              <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>
                Cada flujo arranca con un Disparador y termina en Fin.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Cabecera */}
            <div style={{ padding: '9px 12px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#080f1a' }}>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Nombre del flujo"
                style={{ width: 210, padding: '6px 9px', background: '#080d14', border: `1px solid ${BORDE}`, borderRadius: 8, color: '#e2e8f0', fontSize: 12, fontWeight: 700, outline: 'none', fontFamily: 'Outfit,sans-serif' }} />

              <button onClick={guardar} disabled={trabajando} style={boton(MORADO, !trabajando)}>💾 Guardar borrador</button>
              <button onClick={() => publicar(!actual.publicado)} disabled={trabajando} style={boton(actual.publicado ? '#f59e0b' : '#25d366', !trabajando)}>
                {actual.publicado ? '⏸ Despublicar' : '🚀 Publicar'}
              </button>

              <span style={{ fontSize: 10, fontWeight: 800, color: sinGuardar ? '#f59e0b' : actual.publicado ? '#25d366' : '#64748b' }}>
                {sinGuardar ? '● Cambios sin guardar' : actual.publicado ? '● Publicado' : '● Borrador guardado'}
              </span>
              {totalErrores > 0 && (
                <span style={{ fontSize: 10, fontWeight: 800, color: '#f87171' }}>⚠️ {totalErrores} error(es)</span>
              )}

              <div style={{ flex: 1 }} />

              <button onClick={deshacer} disabled={!puedeDeshacer} title="Deshacer (Ctrl+Z)" style={boton('#64748b', puedeDeshacer)}>↶</button>
              <button onClick={rehacer} disabled={!puedeRehacer} title="Rehacer (Ctrl+Shift+Z)" style={boton('#64748b', puedeRehacer)}>↷</button>
            </div>

            {/* Paleta */}
            <div style={{ padding: '7px 12px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '1.2px', color: '#475569' }}>AGREGAR</span>
              <button onClick={() => agregarNodo('mensaje')} style={boton(COLORES.mensaje)}>+ Mensaje</button>
              <button onClick={() => agregarNodo('condicion')} style={boton(COLORES.condicion)}>+ Condición</button>
              <button onClick={() => agregarNodo('fin')} style={boton(COLORES.fin)}>+ Fin</button>
              <button onClick={borrarSeleccion} disabled={!seleccion} style={boton('#f87171', !!seleccion)}>🗑 Borrar lo elegido</button>
              {erroresSueltos.length > 0 && (
                <span style={{ fontSize: 10, color: '#f87171', fontWeight: 700 }}>{erroresSueltos.join(' · ')}</span>
              )}
            </div>

            {/* Lienzo */}
            <div ref={cajaRef} className="flujos-lienzo" onKeyDown={alTeclado} tabIndex={0}
              style={{ flex: 1, minHeight: 0, position: 'relative', outline: 'none' }}>
              <CtxLienzo.Provider value={ctx}>
                <ReactFlow
                  nodes={nodes}
                  edges={edgesPintados}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={alCambiarSeleccion}
                  deleteKeyCode="Delete"
                  fitView
                  minZoom={0.2}
                  maxZoom={1.75}
                  proOptions={{ hideAttribution: false }}
                  style={{ background: '#070d15' }}
                >
                  <Background color="#1b2942" gap={18} size={1} />
                  <MiniMap pannable zoomable maskColor="rgba(7,13,21,.75)"
                    style={{ background: SUPERFICIE, border: `1px solid ${BORDE}`, borderRadius: 8 }}
                    nodeColor={(n) => COLORES[n.type] || '#94a3b8'} nodeStrokeWidth={2} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </CtxLienzo.Provider>
            </div>
          </>
        )}
      </div>

      {/* ══════ PANEL DERECHO ══════ */}
      {actual && (
        <div style={{ width: 306, flexShrink: 0, borderLeft: `1px solid ${BORDE}`, background: '#080f1a', overflow: 'hidden' }}>
          <PanelEdicion
            key={seleccion ? `${seleccion.tipo}:${seleccion.id}` : 'nada'}
            nodo={nodoSel}
            linea={lineaSel}
            anuncios={anuncios}
            respuestas={respuestas}
            errores={erroresSel}
            onCambiarNodo={cambiarNodo}
            onCambiarLinea={cambiarEspera}
          />
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
          background: SUPERFICIE, border: `1px solid ${BORDE}`, borderRadius: 10, padding: '9px 16px',
          color: '#e2e8f0', fontSize: 12, fontWeight: 700, boxShadow: '0 8px 28px rgba(0,0,0,.5)',
        }}>{toast}</div>
      )}
    </div>
  )
}

// `useReactFlow` (centro de la pantalla para el nodo nuevo, `fitView`, leer las
// líneas de verdad en `onConnect`) solo funciona DENTRO del proveedor, y el
// lienzo no es el componente de más afuera: la lista y el panel viven al lado.
export default function Flujos({ active }) {
  return (
    <ReactFlowProvider>
      <Lienzo active={active} />
    </ReactFlowProvider>
  )
}
