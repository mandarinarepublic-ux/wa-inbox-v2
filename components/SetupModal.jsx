'use client'
import { useState } from 'react'
import { CFG } from '@/lib/config'

export default function SetupModal({ onClose }) {
  const [read,  setRead]  = useState(CFG.MAKE_READ_WEBHOOK)
  const [send,  setSend]  = useState(CFG.MAKE_SEND_WEBHOOK)
  const [poll,  setPoll]  = useState(CFG.POLL_INTERVAL)
  const [saved, setSaved] = useState(false)

  const save = () => {
    CFG.MAKE_READ_WEBHOOK = read
    CFG.MAKE_SEND_WEBHOOK = send
    CFG.POLL_INTERVAL     = Number(poll)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 1400)
  }

  const inputStyle = {
    width: '100%', marginTop: 6, padding: '11px 14px',
    background: '#0a0f1a', border: '1px solid #1e2d3d',
    borderRadius: 10, color: '#f1f5f9', fontSize: 13,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }
  const labelStyle = {
    fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: '.06em',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(6px)', padding: '20px 0', overflowY: 'auto',
    }}>
      <div style={{
        background: '#0d1420', borderRadius: 22, padding: 32,
        maxWidth: 520, width: '92%',
        border: '1px solid #1e2d3d', boxShadow: '0 32px 80px rgba(0,0,0,.6)',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 14,
            background: 'linear-gradient(135deg,#25d366,#128c7e)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>⚙️</div>
          <div>
            <h2 style={{ margin: 0, color: '#f1f5f9', fontSize: 19, fontWeight: 800 }}>Configuración</h2>
            <p style={{ margin: '3px 0 0', color: '#475569', fontSize: 13 }}>
              Conecta tus escenarios de Make
            </p>
          </div>
        </div>

        {/* webhooks */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>WEBHOOK — LEER MENSAJES (Make devuelve JSON del Sheet)</label>
          <input
            value={read} onChange={e => setRead(e.target.value)}
            placeholder="https://hook.eu2.make.com/xxxxxxxxxxxx"
            style={inputStyle}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#334155' }}>
            Escenario Make: Google Sheets Watch Rows → Webhook Response (JSON)
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>WEBHOOK — ENVIAR RESPUESTAS (POST de esta web a Make)</label>
          <input
            value={send} onChange={e => setSend(e.target.value)}
            placeholder="https://hook.eu2.make.com/xxxxxxxxxxxx"
            style={inputStyle}
          />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#334155' }}>
            Escenario Make: Custom Webhook → HTTP Meta API → Sheets Add Row
          </p>
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>ACTUALIZAR CADA (segundos, mín. 5)</label>
          <input
            type="number" value={poll} onChange={e => setPoll(e.target.value)}
            min={5} max={60} style={inputStyle}
          />
        </div>

        {/* flow summary */}
        <div style={{
          background: 'rgba(37,211,102,.04)', border: '1px solid rgba(37,211,102,.12)',
          borderRadius: 12, padding: 14, marginBottom: 22,
        }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: '#25d366', fontWeight: 700 }}>
            📋 FLUJO COMPLETO
          </p>
          {[
            '① WhatsApp → Meta Webhook → Make lo recibe',
            '② Make escribe la fila en tu Google Sheet',
            '③ Esta web lee el Sheet cada ' + poll + ' segundos',
            '④ Escribes la respuesta aquí → POST a Make',
            '⑤ Make llama a Meta API → envía el WhatsApp',
            '⑥ Make escribe la respuesta en el Sheet',
          ].map((s, i) => (
            <p key={i} style={{ margin: '2px 0', fontSize: 12, color: '#475569' }}>{s}</p>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid #1e2d3d', borderRadius: 12, color: '#64748b',
            fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancelar</button>
          <button onClick={save} style={{
            flex: 2, padding: '12px',
            background: saved ? '#22c55e' : 'linear-gradient(135deg,#25d366,#128c7e)',
            border: 'none', borderRadius: 12, color: '#fff',
            fontSize: 14, fontWeight: 800, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'all .2s',
          }}>
            {saved ? '✓ Guardado' : 'Guardar y conectar'}
          </button>
        </div>
      </div>
    </div>
  )
}
