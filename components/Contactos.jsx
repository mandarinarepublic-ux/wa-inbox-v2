'use client'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchDirectorio, fetchPlantillas, sendReply, sendTemplate } from '@/lib/api-client'

// ── Pestaña CONTACTOS ─────────────────────────────────────────────────────────
// Directorio de todos los que te han escrito. Marca dentro/fuera de la ventana de
// 24h de WhatsApp: DENTRO → texto libre o ir al chat; FUERA → solo PLANTILLA.

const ORANGE = '#f59e0b'
const soloDig = (s) => String(s || '').replace(/\D/g, '')

// Tiempo relativo corto (es).
function hace(iso) {
  if (!iso) return 'sin mensajes'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'ahora'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `hace ${d} d`
  const mes = Math.floor(d / 30)
  return `hace ${mes} mes${mes > 1 ? 'es' : ''}`
}

// Sustituye {{1}}, {{2}}… por los valores dados (para la vista previa).
function render(txt, params = []) {
  return String(txt || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`)
}

function Badge24h({ on }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      background: on ? 'rgba(37,211,102,.12)' : 'rgba(148,163,184,.1)',
      color: on ? '#25d366' : '#94a3b8',
      border: `1px solid ${on ? 'rgba(37,211,102,.3)' : 'rgba(148,163,184,.2)'}`,
    }}>{on ? '🟢 24h abierta' : '🔒 solo plantilla'}</span>
  )
}

export default function Contactos({ active, onOpenChat }) {
  const [contactos, setContactos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [sel,       setSel]       = useState(null)   // contacto abierto en el panel
  const [toast,     setToast]     = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await fetchDirectorio()
    setContactos(r?.contactos || [])
    setLoading(false)
  }, [])

  useEffect(() => { if (active && !contactos.length) cargar() }, [active, contactos.length, cargar])

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = soloDig(q)
    let list = contactos
    if (q) {
      list = contactos.filter(c =>
        String(c.nombre || '').toLowerCase().includes(q) ||
        String(c.alias || '').toLowerCase().includes(q) ||
        (qd && soloDig(c.telefono).includes(qd))
      )
    }
    return list.slice(0, 400)
  }, [contactos, search])

  const dentro24h = contactos.filter(c => c.dentro24h).length

  if (!active) return null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: '#080d14', minWidth: 0 }}>
      {/* Encabezado + buscador */}
      <div style={{ padding: '16px 16px 10px', borderBottom: '1px solid #162030', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 19, fontWeight: 900, color: '#e2e8f0' }}>👥 Contactos</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {contactos.length} en total · <b style={{ color: '#25d366' }}>{dentro24h}</b> dentro de 24h
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 10, padding: '8px 12px' }}>
          <span style={{ fontSize: 14, color: '#475569' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o número…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e2e8f0', fontSize: 13, fontFamily: 'Outfit,sans-serif' }} />
          {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 15 }}>✕</button>}
        </div>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && <div style={{ color: '#475569', fontSize: 13, padding: 20 }}>Cargando contactos…</div>}
        {!loading && filtrados.length === 0 && <div style={{ color: '#475569', fontSize: 13, padding: 20 }}>Sin resultados.</div>}
        {filtrados.map((c) => (
          <button key={c.telefono} onClick={() => setSel(c)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px',
            background: 'transparent', border: 'none', borderBottom: '1px solid #111c2a', cursor: 'pointer', textAlign: 'left',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg,#1e2d3d,#0d1828)', color: ORANGE, fontWeight: 800, fontSize: 15,
            }}>{(c.nombre || c.telefono || '?').trim().charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.nombre || c.alias || c.telefono}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                {soloDig(c.telefono)} · {hace(c.ultimoEntranteAt)}
              </div>
            </div>
            <Badge24h on={c.dentro24h} />
          </button>
        ))}
        {!loading && contactos.length > 400 && !search && (
          <div style={{ color: '#334155', fontSize: 11, padding: '12px 16px', textAlign: 'center' }}>
            Mostrando los 400 más recientes · usa el buscador para el resto
          </div>
        )}
      </div>

      {sel && (
        <PanelContacto
          contacto={sel}
          onClose={() => setSel(null)}
          onOpenChat={onOpenChat}
          flash={flash}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#0d1828', border: '1px solid #1e2d3d', color: '#e2e8f0',
          padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, zIndex: 400,
          boxShadow: '0 8px 30px rgba(0,0,0,.5)', maxWidth: '86vw', textAlign: 'center',
        }}>{toast}</div>
      )}
    </div>
  )
}

// ── Panel de acción por contacto (modal) ──────────────────────────────────────
function PanelContacto({ contacto: c, onClose, onOpenChat, flash }) {
  const [texto,   setTexto]   = useState('')
  const [sending, setSending] = useState(false)

  const enviarLibre = async () => {
    if (!texto.trim()) return
    setSending(true)
    const r = await sendReply(c.telefono, c.nombre || '', texto.trim())
    setSending(false)
    if (r?.ok) { flash('✅ Mensaje enviado'); onClose() }
    else flash('❌ No se pudo enviar')
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(460px, 94vw)', maxHeight: '88vh', overflowY: 'auto', zIndex: 501,
        background: '#0b1220', border: '1px solid #1e2d3d', borderRadius: 18, padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
      }}>
        {/* Cabecera */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#1e2d3d,#0d1828)', color: ORANGE, fontWeight: 800, fontSize: 18,
          }}>{(c.nombre || c.telefono || '?').trim().charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.nombre || c.alias || soloDig(c.telefono)}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{soloDig(c.telefono)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        <div style={{ marginBottom: 14 }}><Badge24h on={c.dentro24h} /></div>

        {/* Ir al chat */}
        <button
          onClick={() => { onOpenChat?.(c.telefono); onClose() }}
          style={{
            width: '100%', padding: '11px', borderRadius: 11, border: '1px solid #1e2d3d', marginBottom: 16,
            background: '#0d1828', color: '#e2e8f0', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'Outfit,sans-serif',
          }}>💬 Abrir la conversación</button>

        {c.dentro24h ? (
          // ── Dentro de 24h → texto libre ──
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>Enviar mensaje (texto libre)</div>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Escribe tu mensaje…"
              style={{
                width: '100%', background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10,
                color: '#e2e8f0', fontSize: 13, padding: '10px 12px', fontFamily: 'Outfit,sans-serif',
                resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: 10,
              }} />
            <button onClick={enviarLibre} disabled={!texto.trim() || sending}
              style={{
                width: '100%', padding: '11px', borderRadius: 11, border: 'none',
                background: texto.trim() ? `linear-gradient(135deg,${ORANGE},#f97316)` : '#1e2d3d',
                color: texto.trim() ? '#0b1220' : '#475569', fontWeight: 900, fontSize: 14,
                cursor: texto.trim() && !sending ? 'pointer' : 'default', fontFamily: 'Outfit,sans-serif',
              }}>{sending ? 'Enviando…' : 'Enviar'}</button>
          </div>
        ) : (
          // ── Fuera de 24h → plantilla ──
          <SelectorPlantilla contacto={c} flash={flash} onClose={onClose} />
        )}
      </div>
    </>
  )
}

// ── Modal de plantilla reutilizable (lo usa también el composer del CHAT) ──────
export function PlantillaModal({ telefono, nombre, onClose, flash }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 500 }} />
      <div style={{
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        width: 'min(460px, 94vw)', maxHeight: '88vh', overflowY: 'auto', zIndex: 501,
        background: '#0b1220', border: '1px solid #1e2d3d', borderRadius: 18, padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>📋 Enviar plantilla</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>
        <SelectorPlantilla contacto={{ telefono, nombre }} flash={flash} onClose={onClose} />
      </div>
    </>
  )
}

// ── Selector de plantilla (para contactos fuera de 24h) ───────────────────────
function SelectorPlantilla({ contacto: c, flash, onClose }) {
  const [estado,  setEstado]  = useState('loading') // loading | ready | error | needsEnv
  const [error,   setError]   = useState('')
  const [tpls,    setTpls]    = useState([])
  const [chosen,  setChosen]  = useState(null)
  const [bodyP,   setBodyP]   = useState([])
  const [headP,   setHeadP]   = useState([])
  const [headImg, setHeadImg] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    (async () => {
      const r = await fetchPlantillas()
      if (r?.needsEnv) { setEstado('needsEnv'); setError(r.needsEnv); return }
      if (!r?.ok)      { setEstado('error'); setError(r?.error || 'No se pudieron cargar'); return }
      setTpls(r.templates || []); setEstado('ready')
    })()
  }, [])

  const elegir = (t) => {
    setChosen(t)
    setBodyP(Array(t.bodyVars || 0).fill(''))
    setHeadP(Array(t.header?.vars || 0).fill(''))
    setHeadImg('')
  }

  const preview = chosen ? render(chosen.bodyText, bodyP) : ''
  const listo = chosen &&
    bodyP.every(v => String(v).trim()) &&
    headP.every(v => String(v).trim()) &&
    (chosen.header?.format !== 'IMAGE' || headImg.trim())

  const enviar = async () => {
    setSending(true)
    const r = await sendTemplate(c.telefono, c.nombre || '', {
      name: chosen.name, language: chosen.language,
      bodyParams: bodyP, headerParams: headP, headerImage: headImg,
      preview: preview || `📋 Plantilla: ${chosen.name}`,
    })
    setSending(false)
    if (r?.ok) { flash('✅ Plantilla enviada'); onClose() }
    else flash('❌ ' + (r?.error || 'Meta rechazó el envío'))
  }

  const inp = {
    width: '100%', background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 8,
    color: '#e2e8f0', fontSize: 13, padding: '8px 10px', fontFamily: 'Outfit,sans-serif',
    outline: 'none', boxSizing: 'border-box', marginBottom: 8,
  }

  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#f59e0b', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 9, padding: '8px 10px', marginBottom: 12, lineHeight: 1.4 }}>
        ⚠️ Pasaron más de 24h desde su último mensaje. WhatsApp solo permite enviar una <b>plantilla aprobada</b>.
      </div>

      {estado === 'loading' && <div style={{ color: '#475569', fontSize: 13 }}>Cargando plantillas…</div>}

      {estado === 'needsEnv' && (
        <div style={{ color: '#94a3b8', fontSize: 12.5, lineHeight: 1.5 }}>
          Falta configurar <b style={{ color: ORANGE }}>{error}</b> en Vercel para listar tus plantillas.
          {error === 'META_WABA_ID' && ' Es el ID de tu cuenta de WhatsApp Business (no el phone id).'}
        </div>
      )}

      {estado === 'error' && <div style={{ color: '#ef4444', fontSize: 12.5 }}>Error: {error}</div>}

      {estado === 'ready' && tpls.length === 0 && (
        <div style={{ color: '#94a3b8', fontSize: 12.5, lineHeight: 1.5 }}>
          No hay plantillas aprobadas todavía. Crea una en Meta (WhatsApp Manager → Plantillas) para poder escribir fuera de 24h.
        </div>
      )}

      {estado === 'ready' && tpls.length > 0 && !chosen && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', marginBottom: 8 }}>Elige una plantilla</div>
          {tpls.map((t) => (
            <button key={`${t.name}_${t.language}`} onClick={() => elegir(t)} style={{
              width: '100%', textAlign: 'left', background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 10,
              padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{t.name} <span style={{ fontSize: 10, color: '#475569' }}>· {t.language}</span></div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.bodyText}</div>
            </button>
          ))}
        </div>
      )}

      {chosen && (
        <div>
          <button onClick={() => setChosen(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: 0, marginBottom: 10 }}>← otras plantillas</button>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', marginBottom: 8 }}>{chosen.name}</div>

          {chosen.header?.format === 'IMAGE' && (
            <><div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>URL de la imagen del encabezado</div>
              <input value={headImg} onChange={e => setHeadImg(e.target.value)} placeholder="https://…" style={inp} /></>
          )}
          {headP.map((v, i) => (
            <div key={`h${i}`}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Encabezado · variable {i + 1}</div>
              <input value={v} onChange={e => setHeadP(p => p.map((x, j) => j === i ? e.target.value : x))} style={inp} />
            </div>
          ))}
          {bodyP.map((v, i) => (
            <div key={`b${i}`}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Variable {'{{'}{i + 1}{'}}'}</div>
              <input value={v} onChange={e => setBodyP(p => p.map((x, j) => j === i ? e.target.value : x))} style={inp} />
            </div>
          ))}

          {chosen.bodyText && (
            <div style={{ background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10, padding: '10px 12px', margin: '4px 0 12px' }}>
              <div style={{ fontSize: 10, color: '#475569', fontWeight: 800, marginBottom: 4 }}>VISTA PREVIA</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{preview}</div>
            </div>
          )}

          <button onClick={enviar} disabled={!listo || sending}
            style={{
              width: '100%', padding: '11px', borderRadius: 11, border: 'none',
              background: listo ? `linear-gradient(135deg,${ORANGE},#f97316)` : '#1e2d3d',
              color: listo ? '#0b1220' : '#475569', fontWeight: 900, fontSize: 14,
              cursor: listo && !sending ? 'pointer' : 'default', fontFamily: 'Outfit,sans-serif',
            }}>{sending ? 'Enviando…' : 'Enviar plantilla'}</button>
        </div>
      )}
    </div>
  )
}
