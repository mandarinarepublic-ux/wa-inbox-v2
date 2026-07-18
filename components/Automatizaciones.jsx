'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { getAutomatizaciones, saveAutomatizaciones } from '@/lib/api-client'

// ── Pestaña AUTOMATIZACIONES ──────────────────────────────────────────────────
// Reglas del inbox que se prenden/apagan. Hoy: dos saludos automáticos. Pensada
// para ir sumando módulos (seguimiento, fuera de horario, etc.).

const ORANGE = '#f59e0b'

function Switch({ on, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} style={{
      width: 46, height: 26, borderRadius: 999, border: 'none', cursor: disabled ? 'default' : 'pointer',
      background: on ? '#25d366' : '#334155', position: 'relative', transition: 'background .2s', flexShrink: 0,
      opacity: disabled ? .6 : 1,
    }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
        background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.4)',
      }} />
    </button>
  )
}

function Card({ children }) {
  return (
    <div style={{
      background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 16, padding: 18,
      marginBottom: 16, boxShadow: '0 4px 20px rgba(0,0,0,.25)',
    }}>{children}</div>
  )
}

export default function Automatizaciones({ active }) {
  const [config,  setConfig]  = useState(null)
  const [orig,    setOrig]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getAutomatizaciones()
    const c = r?.config || {}
    setConfig(c); setOrig(JSON.stringify(c)); setLoading(false)
  }, [])

  useEffect(() => { if (active && !config) cargar() }, [active, config, cargar])

  const dirty = config && orig !== JSON.stringify(config)

  const setBloque = (bloque, campo, valor) =>
    setConfig(prev => ({ ...prev, [bloque]: { ...(prev?.[bloque] || {}), [campo]: valor } }))

  // Seguimientos: config anidada (global + por temperatura).
  const setSegG = (campo, valor) =>
    setConfig(prev => ({ ...prev, seguimientos: { ...(prev?.seguimientos || {}), [campo]: valor } }))
  const setSegT = (sub, campo, valor) =>
    setConfig(prev => ({ ...prev, seguimientos: {
      ...(prev?.seguimientos || {}),
      [sub]: { ...((prev?.seguimientos || {})[sub] || {}), [campo]: valor },
    } }))

  const guardar = async () => {
    setSaving(true)
    const r = await saveAutomatizaciones(config)
    setSaving(false)
    if (r?.ok) {
      const c = r.config || config
      setConfig(c); setOrig(JSON.stringify(c))
      setToast('✅ Guardado')
    } else {
      setToast('❌ ' + (r?.error || 'No se pudo guardar'))
    }
    setTimeout(() => setToast(null), 2500)
  }

  if (!active) return null

  const sn = config?.saludo_nuevo || {}
  const sr = config?.saludo_reactivacion || {}
  const sg = config?.seguimientos || {}

  // Config visual de las 3 temperaturas para el bloque de seguimientos.
  const TEMPS = [
    { key: 'caliente', icon: '🔥', label: 'Caliente', color: '#f97316', ayuda: 'Primero te AVISA a ti; si no actúas, manda un “sujeta-ventana” antes de las 24h.' },
    { key: 'tibio',    icon: '🌤️', label: 'Tibio',    color: '#fbbf24', ayuda: 'Seguimiento suave a media ventana.' },
    { key: 'frio',     icon: '❄️', label: 'Frío',     color: '#38bdf8', ayuda: 'Último toque opcional antes de cerrar la ventana.' },
  ]
  const inputNum = { width: 60, background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 8, color: ORANGE, fontSize: 14, fontWeight: 800, padding: '6px 8px', textAlign: 'center', fontFamily: 'Outfit,sans-serif', outline: 'none' }
  const inputTxt = { width: '100%', background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10, color: '#e2e8f0', fontSize: 13, padding: '10px 12px', fontFamily: 'Outfit,sans-serif', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ flex: 1, overflowY: 'auto', height: '100%', background: '#080d14' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '22px 16px 90px' }}>

        {/* Encabezado */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0', letterSpacing: '.5px' }}>⚙️ Automatizaciones</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Reglas que responden solas por ti. Se aplican cuando la IA está <b style={{ color: '#94a3b8' }}>apagada</b> para ese contacto (si está prendida, la IA se encarga).
          </div>
        </div>

        {loading && <div style={{ color: '#475569', fontSize: 13, padding: 20 }}>Cargando…</div>}

        {!loading && config && (<>

          {/* ── Saludo a contacto NUEVO ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: sn.activo ? 14 : 0 }}>
              <div style={{ fontSize: 26 }}>👋</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Saludo a contacto nuevo</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Se envía la primera vez que alguien te escribe. Atiende al instante aunque la IA esté apagada.
                </div>
              </div>
              <Switch on={!!sn.activo} onClick={() => setBloque('saludo_nuevo', 'activo', !sn.activo)} />
            </div>
            {sn.activo && (
              <textarea
                value={sn.texto || ''} onChange={e => setBloque('saludo_nuevo', 'texto', e.target.value)}
                rows={3} placeholder="Escribe el mensaje de bienvenida…"
                style={{
                  width: '100%', background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10,
                  color: '#e2e8f0', fontSize: 13, padding: '10px 12px', fontFamily: 'Outfit,sans-serif',
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }} />
            )}
          </Card>

          {/* ── Saludo de REACTIVACIÓN ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: sr.activo ? 14 : 0 }}>
              <div style={{ fontSize: 26 }}>🔄</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Saludo "hola de vuelta"</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Cuando un cliente reaparece después de un tiempo sin escribir.
                </div>
              </div>
              <Switch on={!!sr.activo} onClick={() => setBloque('saludo_reactivacion', 'activo', !sr.activo)} />
            </div>
            {sr.activo && (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Se dispara si estuvo callado más de</span>
                <input
                  type="number" min={1} max={720}
                  value={sr.horas ?? 12}
                  onChange={e => setBloque('saludo_reactivacion', 'horas', Math.max(1, Number(e.target.value) || 1))}
                  style={{
                    width: 64, background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 8,
                    color: ORANGE, fontSize: 14, fontWeight: 800, padding: '6px 8px', textAlign: 'center',
                    fontFamily: 'Outfit,sans-serif', outline: 'none',
                  }} />
                <span style={{ fontSize: 12, color: '#94a3b8' }}>horas</span>
              </div>
              <textarea
                value={sr.texto || ''} onChange={e => setBloque('saludo_reactivacion', 'texto', e.target.value)}
                rows={3} placeholder="Escribe el mensaje de reactivación…"
                style={{
                  width: '100%', background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 10,
                  color: '#e2e8f0', fontSize: 13, padding: '10px 12px', fontFamily: 'Outfit,sans-serif',
                  resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }} />
            </>)}
          </Card>

          {/* ── SEGUIMIENTO por temperatura del lead (cron) ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: sg.activo ? 14 : 0 }}>
              <div style={{ fontSize: 26 }}>🌡️</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Seguimiento por temperatura</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Escribe solo, según qué tan caliente esté el lead y cuánto lleva callado — <b style={{ color: '#94a3b8' }}>siempre dentro de la ventana de 24h</b> de WhatsApp. Máx 1 mensaje por ventana; se cancela si el cliente responde.
                </div>
              </div>
              <Switch on={!!sg.activo} onClick={() => setSegG('activo', !sg.activo)} />
            </div>

            {sg.activo && (<>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
                <Switch on={sg.solo_ia_apagada !== false} onClick={() => setSegG('solo_ia_apagada', !(sg.solo_ia_apagada !== false))} />
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Solo en chats con la <b style={{ color: '#cbd5e1' }}>IA apagada</b> (para no chocar con el agente)</span>
              </label>

              {TEMPS.map(({ key, icon, label, color, ayuda }) => {
                const t = sg[key] || {}
                return (
                  <div key={key} style={{ border: `1px solid ${t.activo ? color + '44' : '#1e2d3d'}`, borderRadius: 12, padding: 12, marginBottom: 10, background: t.activo ? color + '0c' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: t.activo ? color : '#94a3b8' }}>{label}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{ayuda}</div>
                      </div>
                      <Switch on={!!t.activo} onClick={() => setSegT(key, 'activo', !t.activo)} />
                    </div>
                    {t.activo && (<>
                      {key === 'caliente' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>⏰ Avísame a las</span>
                          <input type="number" min={1} max={24} value={t.alerta_horas ?? 20}
                            onChange={e => setSegT(key, 'alerta_horas', Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
                            style={inputNum} />
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>h de silencio</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{key === 'caliente' ? 'Y si no actúo, envía a las' : 'Envía a las'}</span>
                        <input type="number" min={1} max={24} value={t.horas ?? (key === 'tibio' ? 12 : key === 'frio' ? 22 : 23)}
                          onChange={e => setSegT(key, 'horas', Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
                          style={inputNum} />
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>h de silencio</span>
                      </div>
                      <textarea value={t.texto || ''} onChange={e => setSegT(key, 'texto', e.target.value)}
                        rows={3} placeholder={`Mensaje de seguimiento para leads ${label.toLowerCase()}…`} style={inputTxt} />
                    </>)}
                  </div>
                )
              })}

              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
                ⚠️ Pasadas las 24h la ventana se cierra y ya no se envía gratis (reenganche por plantilla = próximamente). La temperatura la pones solo tú desde el chat.
              </div>
            </>)}
          </Card>

          {/* Nota siguiente módulo */}
          <div style={{
            border: '1px dashed #1e2d3d', borderRadius: 14, padding: 16, textAlign: 'center',
            color: '#475569', fontSize: 12,
          }}>
            🚧 Aquí iremos sumando más automatizaciones (seguimiento, fuera de horario, etiquetas…).
          </div>
        </>)}
      </div>

      {/* Barra de guardar (sticky) */}
      {!loading && config && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0, padding: '12px 16px',
          background: 'linear-gradient(180deg, transparent, #080d14 40%)',
          display: 'flex', justifyContent: 'center',
        }}>
          <button
            onClick={guardar} disabled={!dirty || saving}
            style={{
              padding: '11px 34px', borderRadius: 12, border: 'none',
              background: dirty ? `linear-gradient(135deg,${ORANGE},#f97316)` : '#1e2d3d',
              color: dirty ? '#0b1220' : '#475569', fontWeight: 900, fontSize: 14,
              cursor: dirty && !saving ? 'pointer' : 'default', fontFamily: 'Outfit,sans-serif',
              boxShadow: dirty ? '0 6px 20px rgba(245,158,11,.3)' : 'none', minWidth: 200,
            }}>
            {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}
          </button>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)',
          background: '#0d1828', border: '1px solid #1e2d3d', color: '#e2e8f0',
          padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700, zIndex: 300,
          boxShadow: '0 8px 30px rgba(0,0,0,.5)',
        }}>{toast}</div>
      )}
    </div>
  )
}
