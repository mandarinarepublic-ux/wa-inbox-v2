'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { listarGuiasServientrega, procesarGuiasServientrega, buscarPedidosParaGuia, asignarGuiaAPedido } from '@/lib/api-client'

// ── Pestaña 🚚 GUÍAS ──────────────────────────────────────────────────────────
// Las guías de Servientrega que Rodri VIP reenvía a MANDI: cuáles quedaron en el
// CRM, cuáles no (y por qué) y un botón para asignar a mano las que no.
// Servidor: lib/guias-registro.js · decisiones: lib/guias-servientrega.js.

const VERDE = '#10b981'
const CRM_PEDIDO = (id) => `https://crm.apps.mandarinaec.com/dashboard/pedido/${encodeURIComponent(id)}`

const fecha = (iso) => {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch { return '' }
}

const ESTADOS = {
  REGISTRADA: { icono: '✅', texto: 'Registrada', color: VERDE },
  PENDIENTE:  { icono: '⚠️', texto: 'Sin asignar', color: '#f59e0b' },
  NUEVA:      { icono: '🆕', texto: 'Sin procesar', color: '#38bdf8' },
}

const METODO = { celular: 'por celular', nombre: 'por nombre', manual: 'a mano', crm: 'desde el CRM' }

function Asignar({ guia, onListo }) {
  const [q, setQ] = useState(guia.celular || guia.destinatario || '')
  const [res, setRes] = useState(null)
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const buscar = async () => {
    if (q.trim().length < 3) return
    setBuscando(true); setError(''); setElegido(null)
    try { setRes(await buscarPedidosParaGuia(q.trim())) } catch (e) { setError(e.message) } finally { setBuscando(false) }
  }
  useEffect(() => { if (q.trim().length >= 3) buscar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const asignar = async () => {
    if (!elegido) return
    setGuardando(true); setError('')
    try { await asignarGuiaAPedido(guia.numero_guia, elegido.pedido_id); onListo() }
    catch (e) { setError(e.message); setGuardando(false) }
  }

  return (
    <div style={{ marginTop: 10, background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()}
          placeholder="Nombre, celular o número de pedido (MAN-…, IND-…)"
          style={{ flex: 1, minWidth: 0, background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '8px 10px', outline: 'none', fontFamily: 'inherit' }} />
        <button onClick={buscar} disabled={buscando} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#1e2d3d', color: '#e2e8f0', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {buscando ? '…' : '🔍'}
        </button>
      </div>
      {res && !res.length && <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>No encontré pedidos con eso.</div>}
      {res && res.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
          {res.map(p => {
            const on = elegido?.pedido_id === p.pedido_id
            return (
              <button key={p.pedido_id} onClick={() => setElegido(p)} style={{
                textAlign: 'left', padding: '7px 9px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? 'rgba(16,185,129,.12)' : 'transparent',
                border: `1px solid ${on ? 'rgba(16,185,129,.5)' : '#1e2d3d'}`, color: '#cbd5e1', fontSize: 12,
              }}>
                <b style={{ color: '#e2e8f0' }}>{p.pedido_id}</b> · {p.cliente || '—'} · {p.estado_pedido} · {fecha(p.fecha_pedido)}
                {p.monto_total != null && ` · $${Number(p.monto_total).toFixed(2)}`}
                {p.tiene_guia && <span style={{ color: '#f59e0b' }}> · ya tiene guía</span>}
              </button>
            )
          })}
        </div>
      )}
      {elegido && (
        <button onClick={asignar} disabled={guardando} style={{
          marginTop: 10, width: '100%', padding: '9px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: `linear-gradient(135deg,${VERDE},#059669)`, color: '#fff', fontWeight: 900, fontSize: 13, opacity: guardando ? .6 : 1,
        }}>
          {guardando ? 'Guardando…' : `Asignar guía ${guia.numero_guia} a ${elegido.pedido_id}${elegido.tiene_guia ? ' (ya tiene otra guía)' : ''}`}
        </button>
      )}
      {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>⚠️ {error}</div>}
    </div>
  )
}

function Fila({ g, onRecargar }) {
  const [asignando, setAsignando] = useState(false)
  const e = ESTADOS[g.estado] || ESTADOS.NUEVA
  return (
    <div style={{ background: '#0d1828', border: '1px solid #1e2d3d', borderLeft: `3px solid ${e.color}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {g.media_url
          ? <a href={g.media_url} target="_blank" rel="noreferrer" title="Ver la guía"><img src={g.media_url} alt="" style={{ width: 54, height: 72, objectFit: 'cover', borderRadius: 7, border: '1px solid #1e2d3d' }} /></a>
          : <div style={{ width: 54, height: 72, borderRadius: 7, background: '#111c2a' }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ color: '#e2e8f0', fontSize: 14 }}>{g.numero_guia}</b>
            <span style={{ color: e.color, fontWeight: 800 }}>{e.icono} {e.texto}</span>
            <span style={{ color: '#475569' }}>{fecha(g.fecha_mensaje)}</span>
          </div>
          <div>📍 {g.destino || '—'}{g.destinatario && <> · 👤 {g.destinatario}</>}{g.celular && <> · 📱 {g.celular}</>}</div>
          {g.estado === 'REGISTRADA' && (
            <div>
              → <a href={CRM_PEDIDO(g.pedido_id)} target="_blank" rel="noreferrer" style={{ color: VERDE, fontWeight: 800 }}>{g.pedido_id}</a>
              {g.cliente && ` · ${g.cliente}`}{g.estado_pedido && ` · ${g.estado_pedido}`}
              {g.metodo && METODO[g.metodo] && <span style={{ color: '#64748b' }}> · {METODO[g.metodo]}</span>}
            </div>
          )}
          {g.estado === 'REGISTRADA' && g.nota && <div style={{ color: '#64748b' }}>{g.nota}</div>}
          {g.estado === 'PENDIENTE' && <div style={{ color: '#f59e0b' }}>{g.motivo}</div>}
          {g.estado === 'NUEVA' && <div style={{ color: '#64748b' }}>Aprieta "Procesar guías" para leerla.</div>}
        </div>
        {g.estado !== 'REGISTRADA' && (
          <button onClick={() => setAsignando(a => !a)} style={{
            flexShrink: 0, padding: '7px 11px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
            background: asignando ? '#1e2d3d' : 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: '#f59e0b',
          }}>{asignando ? 'Cancelar' : '✋ Asignar'}</button>
        )}
      </div>
      {asignando && <Asignar guia={g} onListo={() => { setAsignando(false); onRecargar() }} />}
    </div>
  )
}

export default function Guias({ active }) {
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [filtro, setFiltro] = useState('TODAS')

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try { setDatos(await listarGuiasServientrega()) } catch (e) { setError(e.message) } finally { setCargando(false) }
  }, [])
  useEffect(() => { if (active) cargar() }, [active, cargar])

  const procesar = async () => {
    setProcesando(true); setError(''); setAviso('')
    try {
      const r = await procesarGuiasServientrega(false)
      setAviso(`${r.registradas.length} registradas · ${r.pendientes.length} sin asignar` +
        (r.quedanParaOtraVuelta ? ` · faltan ${r.quedanParaOtraVuelta}: vuelve a apretar` : ''))
      await cargar()
    } catch (e) { setError(e.message) } finally { setProcesando(false) }
  }

  if (!active) return null
  const guias = datos?.guias || []
  const n = (est) => guias.filter(g => g.estado === est).length
  const visibles = filtro === 'TODAS' ? guias : guias.filter(g => g.estado === filtro)
  const chips = [['TODAS', 'Todas', guias.length], ['PENDIENTE', '⚠️ Sin asignar', n('PENDIENTE')], ['NUEVA', '🆕 Sin procesar', n('NUEVA')], ['REGISTRADA', '✅ Registradas', n('REGISTRADA')]]

  return (
    <div style={{ flex: 1, overflowY: 'auto', height: '100%', background: '#080d14' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 16px 60px' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0' }}>🚚 Guías de Servientrega</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
          Las guías que <b style={{ color: '#94a3b8' }}>Rodri VIP</b> reenvía a este número (últimos {datos?.dias || 30} días).
          "Procesar" lee la foto, encuentra al cliente por celular o nombre y anota la guía en su último pedido
          (EN_FABRICA, DESPACHO o COMPLETADO reciente). Las que no encuentra quedan en ⚠️ para asignarlas a mano.
          No cambia el estado del pedido.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={procesar} disabled={procesando} style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', fontWeight: 900, fontSize: 13, cursor: procesando ? 'default' : 'pointer',
            fontFamily: 'Outfit,sans-serif', background: `linear-gradient(135deg,${VERDE},#059669)`, color: '#fff', opacity: procesando ? .6 : 1,
          }}>{procesando ? 'Leyendo guías…' : '🚚 Procesar guías'}</button>
          <button onClick={cargar} disabled={cargando} title="Recargar" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #1e2d3d', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>
            {cargando ? '…' : '🔄'}
          </button>
          {aviso && <span style={{ fontSize: 12, color: VERDE, fontWeight: 700 }}>{aviso}</span>}
        </div>
        {error && <div style={{ marginTop: 10, color: '#ef4444', fontSize: 12 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
          {chips.map(([id, txt, cuantos]) => (
            <button key={id} onClick={() => setFiltro(id)} style={{
              padding: '5px 11px', borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: filtro === id ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.03)',
              border: `1px solid ${filtro === id ? 'rgba(16,185,129,.5)' : '#1e2d3d'}`, color: filtro === id ? VERDE : '#94a3b8',
            }}>{txt} <span style={{ opacity: .6 }}>{cuantos}</span></button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {cargando && !datos && <div style={{ color: '#475569', fontSize: 13 }}>Cargando…</div>}
          {datos && !visibles.length && <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>No hay guías en este filtro.</div>}
          {visibles.map(g => <Fila key={g.numero_guia} g={g} onRecargar={cargar} />)}
        </div>
      </div>
    </div>
  )
}
