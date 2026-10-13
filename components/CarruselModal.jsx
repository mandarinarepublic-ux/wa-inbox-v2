'use client'
// 🛍️ Elegir de 2 a 10 productos del catálogo de Meta y mandarlos como carrusel.
// La vía (interactivo o plantilla) la decide el servidor: ver lib/carrusel.js.
import React, { useEffect, useMemo, useState } from 'react'
import { fetchCatalogoCarrusel } from '@/lib/api-client'
import { MIN_TARJETAS, MAX_TARJETAS, MAX_TEXTO } from '@/lib/carrusel'

const P = { bg: '#0d1520', borde: '#1e2d3d', texto: '#e2e8f0', tenue: '#94a3b8', muy: '#475569', verde: '#25d366' }

export default function CarruselModal({ nombreCliente, onEnviar, onCerrar }) {
  const [productos, setProductos] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [elegidos, setElegidos] = useState([])   // en el orden en que se eligen = orden de las tarjetas
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = async (fresco = false) => {
    setError(''); setProductos(null)
    const r = await fetchCatalogoCarrusel(fresco)
    if (r.ok) setProductos(r.productos || [])
    else { setError(r.error || 'No se pudo leer el catálogo'); setProductos([]) }
  }
  useEffect(() => { cargar() }, [])

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    const l = productos || []
    return t ? l.filter(p => p.nombre.toLowerCase().includes(t)) : l
  }, [productos, q])

  const alternar = (p) => setElegidos(prev => {
    if (prev.some(x => x.retailerId === p.retailerId)) return prev.filter(x => x.retailerId !== p.retailerId)
    if (prev.length >= MAX_TARJETAS) return prev
    return [...prev, p]
  })

  const listo = elegidos.length >= MIN_TARJETAS && elegidos.length <= MAX_TARJETAS && texto.trim() && texto.length <= MAX_TEXTO
  const enviar = async () => {
    if (!listo || enviando) return
    setEnviando(true); setError('')
    const r = await onEnviar(texto.trim(), elegidos)
    setEnviando(false)
    if (r?.ok) onCerrar()
    else setError(r?.error || 'No se pudo enviar')
  }

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 720, height: '88vh', display: 'flex', flexDirection: 'column', background: P.bg, border: `1px solid ${P.borde}`, borderRadius: 14, padding: 14, fontFamily: 'Outfit,sans-serif', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, color: P.texto, fontSize: 14 }}>🛍️ Enviar productos{nombreCliente ? ` a ${nombreCliente}` : ''}</div>
          <button onClick={onCerrar} style={{ background: 'transparent', border: 'none', color: P.tenue, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" autoFocus
            style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${P.borde}`, background: '#080d14', color: P.texto, fontFamily: 'inherit', fontSize: 13 }} />
          <button onClick={() => cargar(true)} title="Volver a leer el catálogo de Meta" style={{ padding: '0 10px', borderRadius: 8, border: `1px solid ${P.borde}`, background: 'transparent', color: P.tenue, cursor: 'pointer' }}>↻</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {productos === null ? (
            <div style={{ color: P.tenue, fontSize: 12, padding: 20, textAlign: 'center' }}>Leyendo el catálogo…</div>
          ) : visibles.length === 0 ? (
            <div style={{ color: P.tenue, fontSize: 12, padding: 20, textAlign: 'center' }}>{error ? '' : 'Ningún producto con ese nombre'}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
              {visibles.map(p => {
                const n = elegidos.findIndex(x => x.retailerId === p.retailerId)
                const on = n >= 0
                return (
                  <button key={p.retailerId} onClick={() => alternar(p)} title={p.nombre} style={{
                    position: 'relative', padding: 0, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${on ? P.verde : P.borde}`, background: '#080d14', fontFamily: 'inherit',
                    opacity: !on && elegidos.length >= MAX_TARJETAS ? .4 : 1,
                  }}>
                    <img src={p.foto} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                    <div style={{ padding: '5px 6px' }}>
                      <div style={{ fontSize: 11, color: P.texto, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.nombre}</div>
                      <div style={{ fontSize: 11, color: P.verde, fontWeight: 800, marginTop: 2 }}>{p.precio}</div>
                    </div>
                    {on && <span style={{ position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, background: P.verde, color: '#0d1520', fontWeight: 900, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n + 1}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2} maxLength={MAX_TEXTO}
          placeholder="Texto que acompaña al carrusel (obligatorio)…"
          style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${P.borde}`, background: '#080d14', color: P.texto, fontFamily: 'inherit', fontSize: 13, resize: 'vertical' }} />
        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: elegidos.length >= MIN_TARJETAS ? P.verde : P.tenue }}>
            {elegidos.length}/{MAX_TARJETAS} elegidos{elegidos.length < MIN_TARJETAS ? ` · mínimo ${MIN_TARJETAS}` : ''}
          </span>
          {elegidos.length > 0 && <button onClick={() => setElegidos([])} style={{ background: 'transparent', border: 'none', color: P.muy, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>limpiar</button>}
          <span style={{ flex: 1 }} />
          <button disabled={!listo || enviando} onClick={enviar} style={{
            padding: '9px 16px', borderRadius: 9, border: 'none', fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
            background: listo ? 'linear-gradient(135deg,#25d366,#128c7e)' : '#111c2a', color: listo ? '#fff' : P.muy,
            cursor: listo && !enviando ? 'pointer' : 'default',
          }}>{enviando ? 'Enviando…' : '🛍️ Enviar carrusel'}</button>
        </div>
      </div>
    </div>
  )
}
