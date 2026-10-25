'use client'
// Filtros combinables de la lista de chats (diseño 2026-09-22 §4).
// Cinco filas: bandeja · temperatura (automática) · etapa · especiales (📌 🎧 ⏰ 🏷️) · 🔖 etiquetas.
// Cada número respeta las OTRAS dimensiones activas (lib/filtro-chats.js `conteos`).
import React from 'react'
import { ETAPAS } from '@/lib/gestion'
import { TEMPERATURAS } from '@/lib/temperatura'

const P = { border: '#1a2d40', border2: '#1a2d40', cream: '#e2e8f0', creamDim: '#94a3b8', creamFaint: '#475569', bg: '#080d14' }

function Chip({ activo, color, onClick, title, children, n }) {
  return (
    <button onClick={onClick} title={title} style={{
      flex: 1, minWidth: 0, padding: '5px 2px', fontSize: 9, fontWeight: 700,
      background: activo ? `${color}18` : 'transparent',
      border: `1px solid ${activo ? color + '55' : P.border}`,
      color: activo ? color : P.creamFaint,
      borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
      {n > 0 && <span style={{ marginLeft: 3, background: activo ? color : P.border2, color: activo ? P.bg : P.creamDim, borderRadius: 10, padding: '0 4px', fontSize: 8, fontWeight: 800 }}>{n}</span>}
    </button>
  )
}

const Fila = ({ children }) => <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>{children}</div>

const TONO_TEMP = { caliente: '#fb923c', tibio: '#fbbf24', frio: '#38bdf8', dormido: '#A09A90' }

export default function FiltrosLista({ filtro, conteos, onCambiar, etiquetas = [], onAdministrarEtiquetas }) {
  const n = conteos || { bandeja: {}, temp: {}, etapa: {} }
  // 📱 En el celular las filas de abajo ocupaban media pantalla antes del primer
  // chat. Ahí quedan plegadas detrás de "Más filtros" (el CSS vive en App.jsx);
  // en la compu se ven siempre y el botón no existe.
  const [abiertos, setAbiertos] = React.useState(false)
  const activos = [filtro.temp, filtro.etapa, filtro.deuda, filtro.ia, filtro.alerta, filtro.interno, filtro.etiqueta].filter(Boolean).length
  return (
    <div>
      <Fila>
        <Chip activo={filtro.bandeja === 'pendiente'} color="#f87171" n={n.bandeja.pendiente} onClick={() => onCambiar('bandeja', 'pendiente')} title="El cliente escribió y le toca responder a alguien">🔴 Pendientes</Chip>
        <Chip activo={filtro.bandeja === 'atendido'} color="#4ade80" n={n.bandeja.atendido} onClick={() => onCambiar('bandeja', 'atendido')} title="Ya contestamos">🟢 Atendidos</Chip>
        <Chip activo={filtro.bandeja === 'archivado'} color={P.creamDim} n={n.bandeja.archivado} onClick={() => onCambiar('bandeja', 'archivado')} title="Archivados">⚫ Archivo</Chip>
      </Fila>
      <button className="filtros-toggle" onClick={() => setAbiertos(v => !v)} style={{
        width: '100%', marginTop: 6, padding: '8px', fontSize: 11, fontWeight: 700,
        background: activos ? 'rgba(251,191,36,.1)' : 'transparent',
        border: `1px solid ${activos ? 'rgba(251,191,36,.45)' : P.border}`,
        color: activos ? '#fbbf24' : P.creamDim, borderRadius: 7, cursor: 'pointer',
        fontFamily: 'inherit', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {abiertos ? '▴ Menos filtros' : '▾ Más filtros'}{activos > 0 ? ` · ${activos} activo${activos === 1 ? '' : 's'}` : ''}
      </button>
      <div className={`filtros-extra${abiertos ? ' abiertos' : ''}`}>
      <Fila>
        {Object.entries(TEMPERATURAS).map(([k, t]) => (
          <Chip key={k} activo={filtro.temp === k} color={TONO_TEMP[k]} n={n.temp[k]} onClick={() => onCambiar('temp', k)}
            title={{ caliente: 'Escribió hace menos de 1 h', tibio: 'Hace 1 a 6 h', frio: 'Hace 6 a 24 h', dormido: 'Más de 24 h: solo plantilla' }[k]}>
            {t.icon} {t.label}
          </Chip>
        ))}
      </Fila>
      <Fila>
        {Object.entries(ETAPAS).map(([k, e]) => (
          <Chip key={k} activo={filtro.etapa === k} color={e.color} n={n.etapa[k]} onClick={() => onCambiar('etapa', k)} title={e.label}>
            {e.icon} {e.label}
          </Chip>
        ))}
      </Fila>
      <Fila>
        <Chip activo={filtro.deuda} color="#fbbf24" n={n.deuda} onClick={() => onCambiar('deuda')} title="Le prometimos algo y no se ha cumplido">📌 Le debemos</Chip>
        <Chip activo={filtro.ia} color="#fbbf24" n={n.ia} onClick={() => onCambiar('ia')} title="La IA te pasó estos chats">🎧 De la IA</Chip>
        <Chip activo={filtro.alerta} color="#fb923c" n={n.alerta} onClick={() => onCambiar('alerta')} title="Se cierra la ventana de 24 h">⏰ Se cierra</Chip>
        <Chip activo={filtro.interno} color={P.creamDim} n={n.interno} onClick={() => onCambiar('interno')} title="Equipo, taller, proveedores">🏷️ Internos</Chip>
      </Fila>
      {/* 🔖 Etiquetas: una por chip, envuelven en varias líneas si son muchas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        {etiquetas.map(e => {
          const activo = filtro.etiqueta === e.id
          const cuantos = n.etiqueta?.[e.id] || 0
          return (
            <button key={e.id} onClick={() => onCambiar('etiqueta', e.id)} title={`Solo los chats con «${e.nombre}»`} style={{
              padding: '4px 7px', fontSize: 9, fontWeight: 700, maxWidth: 140,
              background: activo ? `${e.color}22` : 'transparent',
              border: `1px solid ${activo ? e.color : e.color + '44'}`,
              color: activo ? e.color : P.creamDim,
              borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              🔖 {e.nombre}{cuantos > 0 && <span style={{ marginLeft: 3, color: e.color, fontWeight: 800 }}>{cuantos}</span>}
            </button>
          )
        })}
        {onAdministrarEtiquetas && (
          <button onClick={onAdministrarEtiquetas} title="Crear o editar etiquetas" style={{
            padding: '4px 7px', fontSize: 9, fontWeight: 700, background: 'transparent',
            border: `1px dashed ${P.border}`, color: P.creamFaint, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
          }}>{etiquetas.length ? '⚙️' : '🔖 Etiquetas ⚙️'}</button>
        )}
      </div>
      </div>
    </div>
  )
}
