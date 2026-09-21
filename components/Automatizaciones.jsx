'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { getAutomatizaciones, saveAutomatizaciones, getAnuncios, patchAnuncio, getFlujos } from '@/lib/api-client'
import { elegirFlujo } from '@/lib/flujo'
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
  const [flujos,     setFlujos]     = useState([])

  const cargar = useCallback(async () => {
    setLoading(true)
    const [r, a, f] = await Promise.all([
      getAutomatizaciones(),
      getAnuncios().catch(() => null),
      getFlujos().catch(() => null),
    ])
    const c = r?.config || {}
    setConfig(c); setOrig(JSON.stringify(c))
    setAnuncios(a?.anuncios || [])
    setFlujos(f?.flujos || [])
    // Si alguna de las dos falló, la tarjeta sigue usable con lo que sí cargó,
    // pero hay que avisar: si no, "ANUNCIOS VISTOS · 0" se ve como que no hay
    // anuncios, no como que falló la carga.
    if (!a?.ok || !f?.ok) {
      setToast('⚠️ No pude cargar anuncios o flujos')
      setTimeout(() => setToast(null), 2500)
    }
    setLoading(false)
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

  // ── Recetas de bienvenida por anuncio (retiradas) ──────────────────────────
  // El editor se fue a FLUJOS (spec §5/§7). Acá solo queda el interruptor
  // global, y SOLO si aún queda alguna receta sin importar: una vez importadas
  // todas, este bloque entero desaparece de la pantalla.
  const rc = config?.recetas || { activo: false, lista: [], por_anuncio: {} }
  const togRcG = (valor) => guardarInterruptor(
    { recetas: { activo: valor } },
    prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), activo: valor } }))

  // INTERRUPTOR GENERAL de los flujos publicados (el botón de pánico del motor
  // nuevo). `!== false` y no `!!`: el default es PRENDIDO, así que una config
  // vieja sin el bloque `flujos` tiene que verse prendida, no apagada.
  const flujosOn = config?.flujos?.activo !== false
  const togFlujos = (valor) => guardarInterruptor(
    { flujos: { activo: valor } },
    prev => ({ ...prev, flujos: { ...(prev?.flujos || {}), activo: valor } }))
  const guardarEtiqueta = async (sourceId, etiqueta) => {
    const r = await patchAnuncio(sourceId, etiqueta)
    if (r?.ok) setAnuncios(prev => prev.map(a => a.source_id === sourceId ? { ...a, etiqueta } : a))
    else { setToast('❌ No se guardó la etiqueta'); setTimeout(() => setToast(null), 2500) }
  }
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

          {/* ── ANUNCIOS VISTOS (antes "Bienvenida por anuncio"; el editor de
              recetas se fue a FLUJOS — spec §5/§7) ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 26 }}>📣</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Anuncios vistos</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Cada anuncio que el inbox vio, con el flujo que lo atiende. Los flujos se dibujan en la pestaña FLUJOS.
                </div>
              </div>
            </div>

            {/* Interruptor general de FLUJOS. Va ARRIBA de todo en esta tarjeta:
                es el que de verdad decide si sale algo automático por anuncio,
                palabra u orgánico. Ver DEFAULTS.flujos en lib/automatizaciones.js. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 14,
              background: flujosOn ? 'rgba(167,139,250,.08)' : 'rgba(239,68,68,.10)',
              border: `1px solid ${flujosOn ? 'rgba(167,139,250,.30)' : 'rgba(239,68,68,.35)'}`,
            }}>
              <Switch on={flujosOn} onClick={() => togFlujos(!flujosOn)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>🧭 Flujos</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Interruptor general de los flujos publicados. Apagado, ningún flujo manda nada (no hace falta despublicarlos).
                </div>
                {!flujosOn && (
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', marginTop: 3 }}>
                    ⛔ APAGADOS — ningún flujo publicado está mandando nada
                  </div>
                )}
              </div>
            </div>

            {/* El interruptor de recetas solo tiene sentido mientras quede algo
                por importar: apenas la lista quede vacía, este bloque entero
                desaparece (no hay nada que un switch pueda seguir prendiendo). */}
            {(rc.lista || []).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.25)' }}>
                <Switch on={!!rc.activo} onClick={() => togRcG(!rc.activo)} />
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Las recetas ahora viven en FLUJOS. Importa las que tengas desde esa pestaña; al importar, esto se apaga solo.
                </div>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', margin: '6px 0 8px' }}>ANUNCIOS VISTOS · {anuncios.length}</div>
            {[{ source_id: 'organico', etiqueta: 'Orgánico (sin anuncio)', titular: 'Contactos nuevos que escriben por su cuenta', chats_30d: null, fijo: true }, ...anuncios].map(a => {
              const flujo = a.fijo
                ? elegirFlujo({ flujos, esNuevo: true })
                : elegirFlujo({ flujos, sourceId: a.source_id })
              return (
                <div key={a.source_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, border: `1px solid ${flujo ? '#1e2d3d' : '#f59e0b55'}`, background: flujo ? 'transparent' : '#f59e0b0c' }}>
                  {a.imagen_url ? <img src={a.imagen_url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, borderRadius: 8, background: '#1e2d3d', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {a.fijo
                      ? <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{a.etiqueta}</div>
                      : <input defaultValue={a.etiqueta || ''} placeholder="Etiqueta (ej. DBZ chaquetas)" maxLength={120}
                          onBlur={e => e.target.value !== (a.etiqueta || '') && guardarEtiqueta(a.source_id, e.target.value)}
                          style={{ ...selectStyle, width: '100%', fontWeight: 800, color: '#e2e8f0', padding: '4px 6px' }} />}
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.titular || '(sin titular)'}{a.chats_30d != null ? ` · ${a.chats_30d} chats en 30 días` : ''}{a.ultimo_chat ? ` · último chat ${new Date(a.ultimo_chat).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0, color: flujo ? '#25d366' : ORANGE }}>
                    {flujo ? `→ flujo: ${flujo.nombre}` : 'sin flujo'}
                  </div>
                </div>
              )
            })}
          </Card>

        </>)}

        {/* ══════ NÚMEROS CONECTADOS A LA API ══════
            Va FUERA del `config &&` de arriba a propósito. Es la herramienta de
            rescate del inbox, y el día que se necesita puede ser justo el día en
            que /api/automatizaciones no contesta: un botón de emergencia
            escondido detrás de una carga que falló no sirve para nada.

            Por qué existe esta tarjeta: REPUBLIC se cayó de la API el 5-sep-2026
            y pasaron 16 días sin que nadie se enterara. En coexistencia el
            celular es el dueño del número, así que siguió recibiendo y
            contestando todo con normalidad; lo único que se cortó fue la copia
            hacia el inbox — sin error en pantalla y sin un solo 5xx en Vercel.
            La página para re-engancharlo existe desde el 12-sep, pero no estaba
            enlazada en ningún lado: había que saberse la dirección de memoria. */}
        <Card>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>📱 Números conectados a la API</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
            Un número que vive en la app de WhatsApp Business de un celular está en{' '}
            <b style={{ color: '#cbd5e1' }}>coexistencia</b>: el teléfono es el dueño y la API va al
            costado, copiando todo al inbox. Ese enganche se cae solo cada tanto, y cuando se cae el
            celular sigue igual de bien — lo único que se queda mudo es esta pantalla.
          </div>

          <a href="/admin/conectar-whatsapp" target="_blank" rel="noopener noreferrer" style={{
            display: 'block', textAlign: 'center', textDecoration: 'none',
            background: 'linear-gradient(135deg,#25d366,#1da851)', color: '#0b1220',
            borderRadius: 12, padding: '12px 18px', fontWeight: 900, fontSize: 14,
            fontFamily: 'Outfit,sans-serif',
          }}>
            🔌 Conectar o re-enganchar un número del celular
          </a>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
            Abre el diálogo de Meta. Te manda un WhatsApp de <b>Facebook Business</b> al celular con un
            código: ahí tocas <b>Conectar a la Plataforma empresarial</b> y pegas el código.
            <b style={{ color: '#94a3b8' }}> Ten el teléfono a mano</b> antes de empezar.
          </div>

          <div style={{
            fontSize: 11, color: '#64748b', letterSpacing: '.05em',
            marginTop: 16, marginBottom: 6, textTransform: 'uppercase',
          }}>
            ¿Qué dice Meta de cada número? (solo lectura)
          </div>
          {/* Un enlace por canal en vez de uno solo: el diagnóstico es POR número
              —`platform_type`, `status` y las apps suscritas son de ese número, no
              de la cuenta— y el que se cae casi nunca es el que estás mirando. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CANALES.map(c => (
              <a key={c.id} href={`/api/admin/meta-waba?canal=${c.id}`} target="_blank" rel="noopener noreferrer"
                title={c.titulo}
                style={{
                  textDecoration: 'none', color: c.color, fontWeight: 800, fontSize: 12,
                  border: `1px solid ${c.color}55`, borderRadius: 10, padding: '7px 13px',
                  background: `${c.color}12`, fontFamily: 'Outfit,sans-serif',
                }}>
                🔎 {c.etiqueta}
              </a>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
            Sano es <b style={{ color: '#25d366' }}>CLOUD_API · CONNECTED</b>. Si sale{' '}
            <b style={{ color: '#f97316' }}>ON_PREMISE</b>, <b style={{ color: '#f97316' }}>NOT_APPLICABLE</b>{' '}
            o el número ni aparece, el enganche está muerto y toca rehacerlo con el botón de arriba.
          </div>
        </Card>

        {/* Nota siguiente módulo */}
        <div style={{
          border: '1px dashed #1e2d3d', borderRadius: 14, padding: 16, textAlign: 'center',
          color: '#475569', fontSize: 12,
        }}>
          🚧 Aquí iremos sumando más automatizaciones (seguimiento, fuera de horario, etiquetas…).
        </div>
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
