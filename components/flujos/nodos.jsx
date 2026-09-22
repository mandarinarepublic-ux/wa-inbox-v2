'use client'
// components/flujos/nodos.jsx — las cuatro tarjetas del lienzo.
//
// Cada tipo de nodo se dibuja igual: cabecera con icono y nombre, cuerpo con un
// RESUMEN de lo que hace (para leer el flujo entero sin abrir ningún panel) y los
// puertos de salida abajo, uno por cada `puertosDe(nodo)`.
//
// ☠️ LOS PUERTOS SALEN DE `puertosDe`, NUNCA DE UNA LISTA ESCRITA ACÁ. Es la misma
// función que usa la validación y el motor: si el dibujo tuviera su propia idea de
// cuántas salidas tiene un Mensaje con botones, el vendedor conectaría una línea a
// un puerto que el motor no conoce y el flujo se cortaría en silencio.
import React, { createContext, useContext } from 'react'
import { Handle, Position } from '@xyflow/react'
import { puertosDe } from '@/lib/flujo'
import { adjuntosDeRespuesta } from '@/lib/adjuntos-respuesta'

// Lo que las tarjetas necesitan saber del mundo y no viene en `data`: los errores
// de validación (para el borde rojo), las respuestas rápidas y los anuncios (para
// el resumen). Va por contexto y NO por `data` a propósito: `data` es el `datos`
// del grafo y todo lo que se meta ahí terminaría guardado en la base.
export const CtxLienzo = createContext({ erroresPorNodo: {}, respuestas: [], anuncios: [], pasos: {} })

export const COLORES = {
  disparador: '#f59e0b',
  mensaje: '#25d366',
  condicion: '#60a5fa',
  fin: '#f87171',
}

const ICONOS = { disparador: '📣', mensaje: '💬', condicion: '🔀', fin: '🔴' }
const NOMBRES = { disparador: 'Disparador', mensaje: 'Mensaje', condicion: 'Condición', fin: 'Fin' }

export const EMOJI_TEMP = { caliente: '🔥', tibio: '🌤️', frio: '❄️' }

const CAMPOS_CONDICION = {
  temperatura: 'Temperatura',
  tiene_venta: 'Tiene venta',
  hora: 'Hora (Ecuador)',
  bandeja: 'Bandeja',
}

const recortar = (s, n = 90) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** El texto que se pinta debajo de cada puerto de salida. */
export function etiquetaDePuerto(nodo, puerto) {
  if (puerto === 'otra') return 'Otra respuesta'
  if (puerto === 'respuesta') return 'Respuesta'
  if (puerto === 'si') return 'sí'
  if (puerto === 'no') return 'no'
  if (puerto === 'siguiente') return 'siguiente'
  const m = /^btn_(\d+)$/.exec(puerto)
  if (m) {
    const b = (nodo?.datos?.botones || [])[Number(m[1]) - 1]
    const titulo = String((b && typeof b === 'object') ? b.title : b || '').trim()
    return titulo || `Botón ${m[1]}`
  }
  return puerto
}

/**
 * El armazón común. `nodo` es el nodo del grafo reconstruido ({tipo, datos}) para
 * que los puertos salgan de la misma función que valida y ejecuta.
 */
function Tarjeta({ id, nodo, selected, children, conEntrada = true }) {
  const { erroresPorNodo, pasos } = useContext(CtxLienzo)
  const pasaron = Number(pasos?.[id]) || 0
  const tipo = nodo.tipo
  const color = COLORES[tipo] || '#94a3b8'
  const errores = erroresPorNodo?.[id] || []
  const puertos = puertosDe(nodo)

  return (
    <div style={{
      position: 'relative', width: 228, borderRadius: 12, overflow: 'visible',
      background: '#0d1828',
      border: `1px solid ${errores.length ? '#f87171' : selected ? color : '#1e2d3d'}`,
      boxShadow: selected ? `0 0 0 2px ${color}55, 0 6px 20px rgba(0,0,0,.4)` : '0 4px 14px rgba(0,0,0,.3)',
      fontFamily: 'Outfit,sans-serif', color: '#e2e8f0',
    }}>
      {conEntrada && <Handle type="target" position={Position.Top} id="in" style={{ background: '#64748b', width: 9, height: 9, border: '2px solid #0d1828' }} />}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
        background: `${color}1a`, borderBottom: `1px solid ${color}33`,
        borderRadius: '11px 11px 0 0',
      }}>
        <span style={{ fontSize: 13 }}>{ICONOS[tipo]}</span>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '1.2px', color }}>{(NOMBRES[tipo] || tipo).toUpperCase()}</span>
        {pasaron > 0 && (
          <span title="clientes distintos que pasaron por acá en los últimos 30 días"
            style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: '#a78bfa' }}>👤 {pasaron}</span>
        )}
      </div>

      <div style={{ padding: '8px 10px 10px', fontSize: 11, lineHeight: 1.45, color: '#cbd5e1' }}>
        {children}
        {errores.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 9, color: '#f87171', fontWeight: 700 }}>
            {errores.map((t, i) => <div key={i}>⚠️ {t}</div>)}
          </div>
        )}
      </div>

      {puertos.map((p, i) => {
        const izquierda = `${((i + 1) * 100) / (puertos.length + 1)}%`
        return (
          <React.Fragment key={p}>
            <Handle type="source" position={Position.Bottom} id={p}
              style={{ left: izquierda, background: color, width: 9, height: 9, border: '2px solid #0d1828' }} />
            <span style={{
              position: 'absolute', top: '100%', left: izquierda, transform: 'translateX(-50%)',
              marginTop: 5, fontSize: 8, fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap',
              maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{etiquetaDePuerto(nodo, p)}</span>
          </React.Fragment>
        )
      })}
    </div>
  )
}

function NodoDisparador({ id, data, selected }) {
  const { anuncios } = useContext(CtxLienzo)
  const nodo = { tipo: 'disparador', datos: data }
  const tipo = data?.tipo || 'organico'

  let cuerpo
  if (tipo === 'anuncio') {
    const ids = Array.isArray(data?.sourceIds) ? data.sourceIds : []
    const nombres = ids.map((sid) => {
      const a = (anuncios || []).find((x) => String(x.source_id) === String(sid))
      return a?.etiqueta || a?.titular || sid
    })
    cuerpo = (
      <>
        <div style={{ fontWeight: 800, color: '#e2e8f0' }}>Llega desde un anuncio</div>
        <div style={{ color: nombres.length ? '#94a3b8' : '#f87171', marginTop: 2 }}>
          {nombres.length ? recortar(nombres.join(' · '), 70) : 'sin anuncios elegidos'}
        </div>
      </>
    )
  } else if (tipo === 'palabra') {
    const palabras = (Array.isArray(data?.palabras) ? data.palabras : []).filter((p) => String(p || '').trim())
    cuerpo = (
      <>
        <div style={{ fontWeight: 800, color: '#e2e8f0' }}>Escribe una palabra</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
          {palabras.length
            ? palabras.map((p, i) => (
              <span key={`${p}-${i}`} style={{ background: '#111c2a', border: '1px solid #1e2d3d', borderRadius: 999, padding: '1px 7px', fontSize: 9 }}>{p}</span>
            ))
            : <span style={{ color: '#f87171' }}>sin palabras</span>}
        </div>
      </>
    )
  } else if (tipo === 'boton') {
    const boton = String(data?.boton || '').trim()
    cuerpo = (
      <>
        <div style={{ fontWeight: 800, color: '#e2e8f0' }}>Toca un botón</div>
        <div style={{ color: boton ? '#94a3b8' : '#f87171', marginTop: 2 }}>
          {boton ? `🔘 ${boton}` : 'sin título de botón'}
        </div>
      </>
    )
  } else {
    cuerpo = (
      <>
        <div style={{ fontWeight: 800, color: '#e2e8f0' }}>Contacto nuevo</div>
        <div style={{ color: '#94a3b8', marginTop: 2 }}>escribe por su cuenta, sin anuncio</div>
      </>
    )
  }

  return <Tarjeta id={id} nodo={nodo} selected={selected} conEntrada={false}>{cuerpo}</Tarjeta>
}

function NodoMensaje({ id, data, selected }) {
  const { respuestas } = useContext(CtxLienzo)
  const nodo = { tipo: 'mensaje', datos: data }

  let texto = ''
  let nAdjuntos = 0
  let perdida = false
  if (data?.origen === 'respuesta') {
    const r = (respuestas || []).find((x) => String(x.id) === String(data?.respuestaId))
    if (r) {
      texto = r.text || ''
      nAdjuntos = adjuntosDeRespuesta(r).length
    } else {
      perdida = true
    }
  } else {
    texto = data?.texto || ''
    nAdjuntos = (Array.isArray(data?.adjuntos) ? data.adjuntos : []).length
  }

  const marcas = []
  if (nAdjuntos) marcas.push(`📎 ${nAdjuntos}`)
  if (data?.temperatura && EMOJI_TEMP[data.temperatura]) marcas.push(EMOJI_TEMP[data.temperatura])
  if (data?.esperarRespuesta) marcas.push('✋ espera respuesta')
  if (data?.citarUltimaRespuesta) marcas.push('↩ cita')

  return (
    <Tarjeta id={id} nodo={nodo} selected={selected}>
      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.8px', color: '#475569', marginBottom: 2 }}>
        {data?.origen === 'respuesta' ? 'RESPUESTA RÁPIDA' : 'TEXTO PROPIO'}
      </div>
      {perdida
        ? <div style={{ color: '#f87171', fontWeight: 700 }}>esa respuesta rápida ya no existe</div>
        : <div style={{ color: texto ? '#cbd5e1' : '#64748b' }}>{texto ? recortar(texto) : '(sin texto)'}</div>}
      {marcas.length > 0 && (
        <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 5, fontSize: 9, color: '#94a3b8' }}>
          {marcas.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}
    </Tarjeta>
  )
}

function NodoCondicion({ id, data, selected }) {
  const nodo = { tipo: 'condicion', datos: data }
  const campo = CAMPOS_CONDICION[data?.campo] || data?.campo || '(sin campo)'
  return (
    <Tarjeta id={id} nodo={nodo} selected={selected}>
      <div style={{ fontWeight: 800, color: '#e2e8f0' }}>{campo}</div>
      <div style={{ color: data?.valor ? '#94a3b8' : '#64748b', marginTop: 2 }}>
        {data?.valor ? `= ${recortar(data.valor, 40)}` : '(sin valor)'}
      </div>
    </Tarjeta>
  )
}

function NodoFin({ id, data, selected }) {
  const nodo = { tipo: 'fin', datos: data }
  return (
    <Tarjeta id={id} nodo={nodo} selected={selected}>
      <div style={{ color: '#94a3b8' }}>Acá termina. El chat queda en PENDIENTES.</div>
    </Tarjeta>
  )
}

// El mapa que recibe `<ReactFlow nodeTypes>`. Se define UNA vez a nivel de módulo:
// si se armara dentro del componente, React Flow vería un objeto nuevo en cada
// render y volvería a montar todas las tarjetas (avisa por consola y se nota en
// un lienzo grande).
export const nodeTypes = {
  disparador: NodoDisparador,
  mensaje: NodoMensaje,
  condicion: NodoCondicion,
  fin: NodoFin,
}
