'use client'
// Una línea de anuncio con foto, nombre del Administrador de anuncios, campaña,
// estado, texto y chats. La usan el disparador de FLUJOS y la lista de AUTOS.
import { useState } from 'react'
import { nombreDeAnuncio, extractoDeAnuncio, estadoDeAnuncio } from '@/lib/anuncio-vista'

export default function AnuncioResumen({ a, tam = 44 }) {
  const [sinFoto, setSinFoto] = useState(false)
  const estado = estadoDeAnuncio(a)
  const activo = estado === 'activo'
  const extracto = extractoDeAnuncio(a)
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
      {a.imagen_url && !sinFoto
        ? <img src={`/api/media?url=${encodeURIComponent(a.imagen_url)}`} alt="" onError={() => setSinFoto(true)}
            style={{ width: tam, height: tam, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid #1e2d3d' }} />
        : <div style={{ width: tam, height: tam, borderRadius: 8, background: '#1e2d3d', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📣</div>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreDeAnuncio(a)}</span>
          {estado && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 10, flexShrink: 0,
              color: activo ? '#25d366' : '#94a3b8', background: activo ? 'rgba(37,211,102,.12)' : 'rgba(148,163,184,.12)',
            }}>
              {activo ? '● activo' : estado}
            </span>
          )}
        </div>
        {a.campana && (
          <div style={{ fontSize: 10, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📂 {a.campana}</div>
        )}
        {extracto && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{extracto}</div>
        )}
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
          {a.chats_30d != null ? `${a.chats_30d} chats en 30 días` : ''}
          {a.ultimo_chat ? ` · último ${new Date(a.ultimo_chat).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
        </div>
      </div>
    </div>
  )
}
