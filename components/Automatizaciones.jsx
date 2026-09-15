'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { getAutomatizaciones, saveAutomatizaciones, getAnuncios, patchAnuncio, fetchRepliesFromSheet } from '@/lib/api-client'
import { CANALES } from '@/lib/canales'

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
  const [anuncios,   setAnuncios]   = useState([])
  const [respuestas, setRespuestas] = useState([])

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getAutomatizaciones()
    const c = r?.config || {}
    setConfig(c); setOrig(JSON.stringify(c)); setLoading(false)
    const [a, r2] = await Promise.all([getAnuncios().catch(() => null), fetchRepliesFromSheet().catch(() => [])])
    setAnuncios(a?.anuncios || [])
    setRespuestas(Array.isArray(r2) ? r2 : [])
  }, [])

  // Recarga CADA VEZ que se entra a la pestaña (no solo la primera): si el
  // dueño apaga el cortafuegos desde el celular, un escritorio con esta
  // pestaña abierta debe dejar de mostrar "Respondiendo" al volver a mirarla.
  // Sin esto, además, "Guardar cambios" reenviaría ese `config` viejo completo
  // y desarmaría el cortafuegos ya apagado en la base.
  //
  // OJO con las dependencias: `config` NO va en el arreglo. `cargar()` hace
  // setConfig(...), así que si `config` estuviera aquí cada carga dispararía
  // el efecto de nuevo → bucle infinito. Con solo [active, cargar] (cargar es
  // estable, useCallback sin dependencias) el efecto corre únicamente cuando
  // se entra/sale de la pestaña, que es justo lo que se quiere.
  useEffect(() => { if (active) cargar() }, [active, cargar])

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

  // Los INTERRUPTORES se guardan solos, sin pasar por "Guardar cambios".
  //
  // Antes solo cambiaban el estado visual: el switch se veía apagado, la
  // automatización seguía prendida en la base y los saludos seguían saliendo a
  // clientes reales. Un interruptor que miente sobre si algo está enviando
  // mensajes no puede depender de que además te acuerdes de apretar Guardar.
  //
  // Se manda un patch MÍNIMO (solo el bloque tocado): así una edición de texto a
  // medio escribir no se guarda de contrabando y el botón Guardar sigue pidiéndola.
  // Ojo: el merge del servidor es de UN nivel, por eso los interruptores de
  // seguimientos por temperatura mandan el bloque de esa temperatura completo.
  const guardarInterruptor = async (patch, aplicar) => {
    const previa = config
    setConfig(aplicar(previa))
    setSaving(true)
    const r = await saveAutomatizaciones(patch)
    setSaving(false)
    if (r?.ok) {
      setOrig(JSON.stringify(r.config || {}))
      setToast('✅ Guardado')
    } else {
      setConfig(previa) // no se guardó → el switch vuelve donde estaba, sin mentir
      setToast('❌ No se pudo guardar: ' + (r?.error || 'reintenta'))
    }
    setTimeout(() => setToast(null), 2500)
  }

  const togBloque = (bloque, valor) => guardarInterruptor(
    { [bloque]: { activo: valor } },
    prev => ({ ...prev, [bloque]: { ...(prev?.[bloque] || {}), activo: valor } }))

  const togSegG = (valor) => guardarInterruptor(
    { seguimientos: { activo: valor } },
    prev => ({ ...prev, seguimientos: { ...(prev?.seguimientos || {}), activo: valor } }))

  // Cortafuegos de MANDI AGENT, por canal. Patch plano: el merge del servidor es
  // de un nivel y con booleanos eso es exactamente lo que queremos (el canal
  // hermano se conserva solo).
  const togIA = (canalId, valor) => guardarInterruptor(
    { ia: { [canalId]: valor } },
    prev => ({ ...prev, ia: { ...(prev?.ia || {}), [canalId]: valor } }))

  // `actual` va completo a propósito: el merge del servidor es de un solo nivel,
  // así que un patch con solo {activo} borraría las horas y el texto.
  const togSegT = (key, valor, actual) => guardarInterruptor(
    { seguimientos: { [key]: { ...actual, activo: valor } } },
    prev => ({ ...prev, seguimientos: { ...(prev?.seguimientos || {}),
      [key]: { ...((prev?.seguimientos || {})[key] || {}), activo: valor } } }))

  // ── Recetas de bienvenida por anuncio ──────────────────────────────────────
  // `lista` y `por_anuncio` se mandan COMPLETOS (merge de un nivel). Los
  // interruptores van al instante; el resto con "Guardar cambios".
  const rc = config?.recetas || { activo: false, lista: [], por_anuncio: {} }
  const setRc = (patch) => setConfig(prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), ...patch } }))
  const togRcG = (valor) => guardarInterruptor(
    { recetas: { activo: valor } },
    prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), activo: valor } }))
  const togReceta = (id, valor) => {
    const lista = (rc.lista || []).map(r => r.id === id ? { ...r, activa: valor } : r)
    guardarInterruptor({ recetas: { lista } }, prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), lista } }))
  }
  const nuevaReceta = () => setRc({ lista: [...(rc.lista || []), {
    id: 'r_' + Math.random().toString(36).slice(2, 8), nombre: 'Nueva receta', activa: true, pasos: [], pregunta: null,
  }] })
  const editarReceta = (id, patch) => setRc({ lista: (rc.lista || []).map(r => r.id === id ? { ...r, ...patch } : r) })
  const borrarReceta = (id) => {
    const por_anuncio = Object.fromEntries(Object.entries(rc.por_anuncio || {}).filter(([, v]) => v !== id))
    setRc({ lista: (rc.lista || []).filter(r => r.id !== id), por_anuncio })
  }
  const duplicarReceta = (r) => setRc({ lista: [...(rc.lista || []), { ...r, id: 'r_' + Math.random().toString(36).slice(2, 8), nombre: r.nombre + ' (copia)' }] })
  const asignar = (sourceId, recetaId) => setRc({ por_anuncio: { ...(rc.por_anuncio || {}), [sourceId]: recetaId || null } })
  const moverPaso = (r, i, d) => {
    const pasos = [...r.pasos]; const j = i + d
    if (j < 0 || j >= pasos.length) return
    ;[pasos[i], pasos[j]] = [pasos[j], pasos[i]]
    editarReceta(r.id, { pasos })
  }
  const respuestaDe = (id) => respuestas.find(x => String(x.id) === String(id))
  const resumenRespuesta = (x) => {
    const n = (Array.isArray(x?.adjuntos) && x.adjuntos.length) ? x.adjuntos.length
      : [x?.imageUrl, x?.imageUrl2, x?.imageUrl3, x?.imageUrl4, x?.imageUrl5].filter(Boolean).length
    return `${String(x?.text || '').slice(0, 60)}${n ? ` · ${n} adj.` : ''}`
  }
  const guardarEtiqueta = async (sourceId, etiqueta) => {
    const r = await patchAnuncio(sourceId, etiqueta)
    if (r?.ok) setAnuncios(prev => prev.map(a => a.source_id === sourceId ? { ...a, etiqueta } : a))
    else { setToast('❌ No se guardó la etiqueta'); setTimeout(() => setToast(null), 2500) }
  }
  const btnChico = { background: 'transparent', border: '1px solid #1e2d3d', color: '#94a3b8', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'Outfit,sans-serif' }
  const selectStyle = { background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 8, color: '#e2e8f0', fontSize: 12, padding: '6px 8px', fontFamily: 'Outfit,sans-serif', outline: 'none', maxWidth: '100%' }

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

          {/* CORTAFUEGOS: apaga MANDI AGENT entero en un número. Va primero a
              propósito — es el botón de pánico, no puede estar enterrado abajo. */}
          <div style={{ background:'#0b1220', border:'1px solid #1e293b', borderRadius:14, padding:16, marginBottom:14 }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🤖 MANDI AGENT</div>
            <div style={{ fontSize:12, color:'#94a3b8', marginBottom:12 }}>
              Respuestas automáticas del bot, por número. Apagarlo aquí lo detiene en
              TODOS los chats de ese número, sin cambiar el ajuste de cada chat: al
              volver a prenderlo, cada conversación vuelve a como estaba.
            </div>
            {CANALES.map(c => {
              const on = config?.ia?.[c.id] !== false
              return (
                <div key={c.id} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  gap:12, padding:'10px 12px', borderRadius:10, marginTop:8,
                  background: on ? 'rgba(37,211,102,.06)' : 'rgba(239,68,68,.10)',
                  border: `1px solid ${on ? 'rgba(37,211,102,.20)' : 'rgba(239,68,68,.35)'}`,
                }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:13 }}>{c.etiqueta}</div>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>{c.titulo}</div>
                    <div style={{ fontSize:11, fontWeight:700, marginTop:2, color: on ? '#25d366' : '#ef4444' }}>
                      {on ? 'Respondiendo' : '⛔ DETENIDO — el bot no contesta en este número'}
                    </div>
                  </div>
                  <Switch on={on} onClick={() => togIA(c.id, !on)} />
                </div>
              )
            })}
          </div>

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
              <Switch on={!!sn.activo} onClick={() => togBloque('saludo_nuevo', !sn.activo)} />
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
              <Switch on={!!sr.activo} onClick={() => togBloque('saludo_reactivacion', !sr.activo)} />
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
              <Switch on={!!sg.activo} onClick={() => togSegG(!sg.activo)} />
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
                      <Switch on={!!t.activo} onClick={() => togSegT(key, !t.activo, t)} />
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

          {/* ── BIENVENIDA POR ANUNCIO (recetas) ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: rc.activo ? 14 : 0 }}>
              <div style={{ fontSize: 26 }}>📣</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Bienvenida por anuncio</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Cuando alguien llega de un anuncio, sale sola la <b style={{ color: '#94a3b8' }}>receta</b> que elijas: tus respuestas rápidas en orden y una pregunta con botones. Un anuncio sin receta no recibe nada automático. Una vez por cliente por ventana de 24h.
                </div>
              </div>
              <Switch on={!!rc.activo} onClick={() => togRcG(!rc.activo)} />
            </div>

            {rc.activo && (<>
              {/* Anuncios vistos */}
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', margin: '6px 0 8px' }}>ANUNCIOS VISTOS · {anuncios.length}</div>
              {[{ source_id: 'organico', etiqueta: 'Orgánico (sin anuncio)', titular: 'Contactos nuevos que escriben por su cuenta', chats_30d: null, fijo: true }, ...anuncios].map(a => {
                const asignada = rc.por_anuncio?.[a.source_id] || ''
                const nuevo = !a.fijo && !asignada
                return (
                  <div key={a.source_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, border: `1px solid ${nuevo ? '#f59e0b55' : '#1e2d3d'}`, background: nuevo ? '#f59e0b0c' : 'transparent' }}>
                    {a.imagen_url ? <img src={a.imagen_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, borderRadius: 8, background: '#1e2d3d', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {a.fijo
                        ? <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{a.etiqueta}</div>
                        : <input defaultValue={a.etiqueta || ''} placeholder="Etiqueta (ej. DBZ chaquetas)" maxLength={120}
                            onBlur={e => e.target.value !== (a.etiqueta || '') && guardarEtiqueta(a.source_id, e.target.value)}
                            style={{ ...selectStyle, width: '100%', fontWeight: 800, color: '#e2e8f0', padding: '4px 6px' }} />}
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nuevo && <b style={{ color: '#f59e0b', marginRight: 6 }}>NUEVO</b>}
                        {a.titular || '(sin titular)'}{a.chats_30d != null ? ` · ${a.chats_30d} chats en 30 días` : ''}
                      </div>
                    </div>
                    <select value={asignada} onChange={e => asignar(a.source_id, e.target.value)} style={selectStyle}>
                      <option value="">— sin receta —</option>
                      {(rc.lista || []).map(r => <option key={r.id} value={r.id}>{r.nombre}{r.activa === false ? ' (apagada)' : ''}</option>)}
                    </select>
                  </div>
                )
              })}

              {/* Recetas */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>RECETAS · {(rc.lista || []).length}</div>
                <button onClick={nuevaReceta} style={btnChico}>+ Nueva receta</button>
              </div>
              {(rc.lista || []).map(r => (
                <div key={r.id} style={{ border: `1px solid ${r.activa !== false ? '#f59e0b44' : '#1e2d3d'}`, borderRadius: 12, padding: 12, marginBottom: 10, background: r.activa !== false ? '#f59e0b0a' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input value={r.nombre || ''} onChange={e => editarReceta(r.id, { nombre: e.target.value })} maxLength={60}
                      style={{ ...selectStyle, flex: 1, fontWeight: 800, color: '#e2e8f0' }} />
                    <button onClick={() => duplicarReceta(r)} style={btnChico} title="Duplicar">⧉</button>
                    <button onClick={() => borrarReceta(r.id)} style={{ ...btnChico, color: '#ef4444' }} title="Eliminar">✕</button>
                    <Switch on={r.activa !== false} onClick={() => togReceta(r.id, !(r.activa !== false))} />
                  </div>

                  <div style={{ fontSize: 11, color: '#64748b', margin: '10px 0 6px' }}>Pasos (salen en este orden):</div>
                  {(r.pasos || []).map((p, i) => {
                    const x = respuestaDe(p.respuestaId)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#64748b', width: 16 }}>{i + 1}.</span>
                        <div style={{ flex: 1, fontSize: 12, color: x ? '#e2e8f0' : '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {x ? resumenRespuesta(x) : `⚠️ respuesta rápida borrada (${p.respuestaId})`}
                        </div>
                        <button onClick={() => moverPaso(r, i, -1)} style={btnChico}>▲</button>
                        <button onClick={() => moverPaso(r, i, +1)} style={btnChico}>▼</button>
                        <button onClick={() => editarReceta(r.id, { pasos: r.pasos.filter((_, k) => k !== i) })} style={btnChico}>✕</button>
                      </div>
                    )
                  })}
                  <select value="" onChange={e => { if (e.target.value) editarReceta(r.id, { pasos: [...(r.pasos || []), { tipo: 'respuesta', respuestaId: e.target.value }] }) }} style={{ ...selectStyle, width: '100%', marginTop: 4 }}>
                    <option value="">+ agregar respuesta rápida…</option>
                    {respuestas.map(x => <option key={x.id} value={x.id}>{resumenRespuesta(x)}</option>)}
                  </select>

                  <div style={{ fontSize: 11, color: '#64748b', margin: '12px 0 6px' }}>Pregunta final con botones (opcional):</div>
                  <textarea value={r.pregunta?.texto || ''} rows={2} placeholder="Ej. ¿Cuál te gustó?"
                    onChange={e => editarReceta(r.id, { pregunta: { ...(r.pregunta || { botones: [] }), texto: e.target.value } })} style={inputTxt} />
                  {[0, 1, 2].map(i => (
                    <input key={i} value={r.pregunta?.botones?.[i]?.title || ''} maxLength={20} placeholder={`Botón ${i + 1} (máx 20)`}
                      onChange={e => {
                        const botones = [0, 1, 2].map(k => ({ title: k === i ? e.target.value.slice(0, 20) : (r.pregunta?.botones?.[k]?.title || '') }))
                        editarReceta(r.id, { pregunta: { ...(r.pregunta || {}), texto: r.pregunta?.texto || '', botones } })
                      }}
                      style={{ ...selectStyle, width: 'calc(33% - 4px)', marginRight: i < 2 ? 6 : 0, marginTop: 6 }} />
                  ))}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
                ⚠️ Lo que el cliente toque en un botón entra al chat como texto y lo pone en PENDIENTES; ningún botón hace nada solo. Si el bot está contestando ese chat, la receta no se mete. Cuando aparece un anuncio nuevo te llega un aviso por Telegram.
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
