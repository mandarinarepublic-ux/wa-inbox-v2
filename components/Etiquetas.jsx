'use client'
// 🔖 Etiquetas de chats (diseño 13-oct-2026). Ver lib/etiquetas.js.
//
// Dos ventanas:
//   · MenuEtiquetas  → poner/quitar etiquetas del chat abierto
//   · AdminEtiquetas → crear, renombrar, cambiar color, desactivar
//
// Van en ventana FIJA y no en un desplegable: la tira de botones de la cabecera
// scrollea en horizontal y recorta cualquier cosa que cuelgue de ella.
import React, { useState } from 'react'

const P = { bg: '#0d1520', borde: '#1e2d3d', texto: '#e2e8f0', tenue: '#94a3b8', muy: '#475569', verde: '#25d366' }
export const COLORES_ETIQUETA = ['#25d366', '#1877f2', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6', '#94a3b8']

function Ventana({ titulo, onCerrar, children }) {
  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 360, maxHeight: '80vh', overflowY: 'auto', background: P.bg, border: `1px solid ${P.borde}`, borderRadius: 14, padding: 16, fontFamily: 'Outfit,sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, color: P.texto, fontSize: 14 }}>{titulo}</div>
          <button onClick={onCerrar} style={{ background: 'transparent', border: 'none', color: P.tenue, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ChipEtiqueta({ e, chico = false }) {
  return (
    <span title={e.nombre} style={{
      fontSize: chico ? 9.5 : 11, fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap',
      color: e.color, background: `${e.color}1a`, border: `1px solid ${e.color}55`,
      borderRadius: 6, padding: chico ? '1px 6px' : '3px 8px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
    }}>{e.nombre}</span>
  )
}

/** Poner/quitar etiquetas del chat. `puestas` = ids que tiene ahora. */
export function MenuEtiquetas({ etiquetas, puestas, onAlternar, onAdministrar, onCerrar, ocupado }) {
  const activas = etiquetas.filter(e => e.activa)
  return (
    <Ventana titulo="🔖 Etiquetas del chat" onCerrar={onCerrar}>
      {activas.length === 0 && <div style={{ color: P.tenue, fontSize: 12, marginBottom: 10 }}>Todavía no hay etiquetas.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {activas.map(e => {
          const on = puestas.includes(e.id)
          return (
            <button key={e.id} disabled={ocupado === e.id} onClick={() => onAlternar(e, !on)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
              background: on ? `${e.color}18` : 'transparent', border: `1px solid ${on ? e.color + '77' : P.borde}`,
              color: P.texto, fontFamily: 'inherit', fontSize: 13, textAlign: 'left', opacity: ocupado === e.id ? .5 : 1,
            }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${e.color}`, background: on ? e.color : 'transparent', color: '#0d1520', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on ? '✓' : ''}</span>
              <span style={{ flex: 1 }}>{e.nombre}</span>
              {e.clave && <span title="La pone sola una regla automática" style={{ fontSize: 10, color: P.muy }}>auto</span>}
            </button>
          )
        })}
      </div>
      <button onClick={onAdministrar} style={{ marginTop: 12, width: '100%', padding: '7px', borderRadius: 8, background: 'transparent', border: `1px dashed ${P.borde}`, color: P.tenue, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        ⚙️ Crear o editar etiquetas
      </button>
    </Ventana>
  )
}

function SelectorColor({ valor, onCambiar }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {COLORES_ETIQUETA.map(c => (
        <button key={c} onClick={() => onCambiar(c)} title={c} style={{ width: 20, height: 20, borderRadius: 10, background: c, cursor: 'pointer', border: valor === c ? '2px solid #fff' : '2px solid transparent' }} />
      ))}
    </div>
  )
}

/** Crear, renombrar, cambiar color, desactivar/activar. No se borran: desactivar las esconde. */
export function AdminEtiquetas({ etiquetas, onCrear, onEditar, onCerrar }) {
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState(COLORES_ETIQUETA[0])
  const [editando, setEditando] = useState(null)   // { id, nombre, color }
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const correr = async (fn) => {
    setOcupado(true); setError('')
    try { await fn() } catch (e) { setError(e.message || 'No se pudo guardar') } finally { setOcupado(false) }
  }
  const input = { flex: 1, minWidth: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${P.borde}`, background: '#080d14', color: P.texto, fontFamily: 'inherit', fontSize: 13 }
  const btn = (fondo) => ({ padding: '7px 10px', borderRadius: 8, border: 'none', background: fondo, color: '#0d1520', fontWeight: 800, fontSize: 12, cursor: ocupado ? 'default' : 'pointer', opacity: ocupado ? .6 : 1, fontFamily: 'inherit' })

  return (
    <Ventana titulo="⚙️ Etiquetas" onCerrar={onCerrar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12, borderBottom: `1px solid ${P.borde}` }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nueva etiqueta" maxLength={30} style={input} />
          <button disabled={ocupado || !nombre.trim()} style={btn(P.verde)}
            onClick={() => correr(async () => { await onCrear({ nombre, color }); setNombre('') })}>Crear</button>
        </div>
        <SelectorColor valor={color} onCambiar={setColor} />
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {etiquetas.map(e => editando?.id === e.id ? (
          <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, border: `1px solid ${P.borde}`, borderRadius: 9 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={editando.nombre} onChange={ev => setEditando({ ...editando, nombre: ev.target.value })} maxLength={30} style={input} />
              <button disabled={ocupado} style={btn(P.verde)}
                onClick={() => correr(async () => { await onEditar(e.id, { nombre: editando.nombre, color: editando.color }); setEditando(null) })}>OK</button>
            </div>
            <SelectorColor valor={editando.color} onCambiar={c => setEditando({ ...editando, color: c })} />
          </div>
        ) : (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: e.activa ? 1 : .45 }}>
            <ChipEtiqueta e={e} />
            {e.clave && <span style={{ fontSize: 10, color: P.muy }}>auto</span>}
            <span style={{ flex: 1 }} />
            <button onClick={() => setEditando({ id: e.id, nombre: e.nombre, color: e.color })} title="Editar" style={{ background: 'transparent', border: 'none', color: P.tenue, cursor: 'pointer', fontSize: 13 }}>✏️</button>
            <button disabled={ocupado} onClick={() => correr(() => onEditar(e.id, { activa: !e.activa }))}
              title={e.activa ? 'Desactivar: se esconde de todos los chats (no se borra)' : 'Volver a activar'}
              style={{ background: 'transparent', border: `1px solid ${P.borde}`, borderRadius: 6, color: P.tenue, cursor: 'pointer', fontSize: 10, padding: '2px 6px', fontFamily: 'inherit' }}>
              {e.activa ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        ))}
      </div>
    </Ventana>
  )
}
