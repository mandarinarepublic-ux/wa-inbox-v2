'use client'
import React, { useState } from 'react'
import { procesarGuiasServientrega } from '@/lib/api-client'

// 🚚 Tarjeta de AUTOMATIZACIONES: registrar en el CRM las guías de Servientrega
// que Rodri VIP reenvía al inbox. Un botón, y el resultado guía por guía.
// La lógica está en lib/guias-registro.js (servidor) y lib/guias-servientrega.js.

const fecha = (iso) => {
  try {
    return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch { return '' }
}

function Fila({ g, ok }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', borderTop: '1px solid #1e2d3d' }}>
      {g.foto
        ? <a href={g.foto} target="_blank" rel="noreferrer"><img src={g.foto} alt="" style={{ width: 42, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #1e2d3d' }} /></a>
        : <div style={{ width: 42, height: 56, borderRadius: 6, background: '#111c2a' }} />}
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
        <div style={{ color: '#e2e8f0', fontWeight: 800 }}>
          {ok ? '✅' : '⚠️'} Guía {g.guia}{ok && <> → <span style={{ color: '#25d366' }}>{g.pedido}</span></>}
        </div>
        <div>{[g.destinatario, g.celular, g.destino].filter(Boolean).join(' · ') || '—'}</div>
        {!ok && <div style={{ color: '#f59e0b' }}>{g.motivo}</div>}
        {ok && g.nota && <div style={{ color: '#64748b' }}>{g.nota}</div>}
        <div style={{ color: '#475569', fontSize: 11 }}>{fecha(g.fecha)}</div>
      </div>
    </div>
  )
}

export default function GuiasServientrega() {
  const [corriendo, setCorriendo] = useState(false)
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')

  const correr = async (simular) => {
    setCorriendo(true); setError('')
    try { setRes(await procesarGuiasServientrega(simular)) }
    catch (e) { setError(e?.message || String(e)); setRes(null) }
    finally { setCorriendo(false) }
  }

  const btn = (fondo, color) => ({
    padding: '10px 18px', borderRadius: 10, border: 'none', fontWeight: 900, fontSize: 13,
    cursor: corriendo ? 'default' : 'pointer', fontFamily: 'Outfit,sans-serif', background: fondo, color,
    opacity: corriendo ? .6 : 1,
  })

  return (
    <div style={{ background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 16, padding: 18, marginBottom: 16, boxShadow: '0 4px 20px rgba(0,0,0,.25)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 26 }}>🚚</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Guías de Servientrega → CRM</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.45 }}>
            Lee las guías que <b style={{ color: '#94a3b8' }}>Rodri VIP</b> reenvía a este chat (foto + texto de Servientrega),
            encuentra al cliente por el celular de la guía y la anota en su último pedido abierto
            (EN_FABRICA o DESPACHO). No cambia el estado del pedido. Una guía ya registrada no se repite.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button disabled={corriendo} onClick={() => correr(false)} style={btn('linear-gradient(135deg,#10b981,#059669)', '#fff')}>
          {corriendo ? 'Leyendo guías…' : '🚚 Registrar guías ahora'}
        </button>
        <button disabled={corriendo} onClick={() => correr(true)} style={btn('#1e2d3d', '#94a3b8')}>
          👀 Solo ver qué haría
        </button>
      </div>

      {error && <div style={{ marginTop: 12, color: '#ef4444', fontSize: 12 }}>⚠️ {error}</div>}

      {res && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            {res.simular && <b style={{ color: '#f59e0b' }}>SIMULACIÓN — no se escribió nada. </b>}
            {res.registradas.length} {res.simular ? 'se registrarían' : 'registradas'} · {res.pendientes.length} sin asignar · {res.yaEstaban} ya estaban en el CRM
            {res.quedanParaOtraVuelta > 0 && ` · faltan ${res.quedanParaOtraVuelta}: vuelve a apretar`}
          </div>
          {res.registradas.map(g => <Fila key={'r' + g.guia} g={g} ok />)}
          {res.pendientes.map(g => <Fila key={'p' + g.guia} g={g} ok={false} />)}
          {!res.revisadas && <div style={{ fontSize: 12, color: '#64748b' }}>No hay guías reenviadas en los últimos 15 días.</div>}
        </div>
      )}
    </div>
  )
}
