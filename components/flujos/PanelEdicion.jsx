'use client'
// components/flujos/PanelEdicion.jsx — el panel derecho del lienzo.
//
// Edita LO QUE ESTÉ SELECCIONADO: un nodo (sus datos) o una línea (su espera).
// No sabe nada de guardar ni de publicar: avisa el cambio hacia arriba y el
// lienzo lo aplica al grafo, que es la única fuente de la verdad.
//
// ⚠️ El padre lo monta con `key={id de lo seleccionado}` a propósito: los campos
// que llevan estado propio acá adentro (la palabra a medio escribir, el número de
// la espera) tienen que arrancar limpios al saltar a otro nodo. Sin esa `key`,
// React reusaría el componente y se vería la palabra del nodo anterior.
import React, { useState } from 'react'
import { MAX_BOTONES, MAX_TITULO } from '@/lib/recetas'
import { MAX_ESPERA_MIN, MAX_ESPERA_SEG, MAX_PAUSA_TANDA_SEG } from '@/lib/flujo'
import { adjuntosDeRespuesta } from '@/lib/adjuntos-respuesta'
import { EMOJI_ETAPA } from './nodos'

const BORDE = '#1e2d3d'
const FONDO_CAMPO = '#080d14'

const estiloCampo = {
  width: '100%', padding: '7px 9px', background: FONDO_CAMPO, border: `1px solid ${BORDE}`,
  borderRadius: 8, color: '#e2e8f0', fontSize: 12, outline: 'none', fontFamily: 'Outfit,sans-serif',
}
const estiloBotonChico = {
  background: 'rgba(255,255,255,.04)', border: `1px solid ${BORDE}`, color: '#94a3b8',
  borderRadius: 8, padding: '4px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'Outfit,sans-serif',
}

function Bloque({ titulo, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: '1.2px', color: '#475569', marginBottom: 6 }}>
        {titulo}
      </div>
      {children}
    </div>
  )
}

function Casilla({ marcada, onChange, children }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', cursor: 'pointer', marginBottom: 6 }}>
      <input type="checkbox" checked={!!marcada} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function Radios({ valor, opciones, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {opciones.map((o) => (
        <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#cbd5e1', cursor: 'pointer' }}>
          <input type="radio" checked={valor === o.id} onChange={() => onChange(o.id)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

// ── Disparador ────────────────────────────────────────────────────────────────

function EditorDisparador({ datos, anuncios, onCambiar }) {
  const [palabraNueva, setPalabraNueva] = useState('')
  const tipo = datos?.tipo || 'organico'
  const sourceIds = (Array.isArray(datos?.sourceIds) ? datos.sourceIds : []).map(String)
  const palabras = Array.isArray(datos?.palabras) ? datos.palabras : []

  const alternarAnuncio = (sid) => {
    const s = String(sid)
    onCambiar({ sourceIds: sourceIds.includes(s) ? sourceIds.filter((x) => x !== s) : [...sourceIds, s] })
  }

  const agregarPalabra = () => {
    const p = palabraNueva.trim()
    if (!p) return
    // Sin repetidas: dos veces la misma palabra no captura más, solo ensucia.
    if (!palabras.some((x) => String(x).trim().toLowerCase() === p.toLowerCase())) {
      onCambiar({ palabras: [...palabras, p] })
    }
    setPalabraNueva('')
  }

  return (
    <>
      <Bloque titulo="CUÁNDO ARRANCA">
        <Radios valor={tipo} onChange={(t) => onCambiar({ tipo: t })} opciones={[
          { id: 'organico', label: '🌱 Contacto nuevo sin anuncio' },
          { id: 'anuncio', label: '📣 Llega desde un anuncio' },
          { id: 'palabra', label: '🔤 Escribe una palabra' },
          { id: 'boton', label: '🔘 Toca un botón' },
        ]} />
      </Bloque>

      {tipo === 'boton' && (
        <Bloque titulo="TÍTULO DEL BOTÓN">
          <input value={String(datos?.boton || '')} onChange={(e) => onCambiar({ boton: e.target.value })}
            placeholder="ej. Banco Pichincha" maxLength={MAX_TITULO} style={estiloCampo} />
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
            Arranca cuando el cliente TOCA un botón con este título, aunque lo haya mandado
            una persona desde una respuesta rápida. Tiene que ser el título exacto (sin
            importar mayúsculas ni tildes); si lo escribe a mano, no arranca.
          </div>
        </Bloque>
      )}

      {tipo === 'anuncio' && (
        <Bloque titulo={`ANUNCIOS (${sourceIds.length})`}>
          {(anuncios || []).length === 0 && (
            <div style={{ fontSize: 11, color: '#64748b' }}>Todavía no hay anuncios vistos.</div>
          )}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {(anuncios || []).map((a) => (
              <label key={a.source_id} style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 7px', borderRadius: 8,
                border: `1px solid ${sourceIds.includes(String(a.source_id)) ? '#f59e0b55' : BORDE}`,
                background: sourceIds.includes(String(a.source_id)) ? '#f59e0b0c' : 'transparent',
                marginBottom: 5, cursor: 'pointer',
              }}>
                <input type="checkbox" checked={sourceIds.includes(String(a.source_id))} onChange={() => alternarAnuncio(a.source_id)} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0' }}>{a.etiqueta || `(sin etiqueta) ${a.source_id}`}</div>
                  <div style={{ fontSize: 10, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.titular || '(sin titular)'}{a.chats_30d != null ? ` · ${a.chats_30d} chats en 30 días` : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </Bloque>
      )}

      {tipo === 'palabra' && (
        <Bloque titulo={`PALABRAS (${palabras.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 7 }}>
            {palabras.map((p, i) => (
              <span key={`${p}-${i}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, background: '#111c2a',
                border: `1px solid ${BORDE}`, borderRadius: 999, padding: '2px 5px 2px 9px', fontSize: 11, color: '#cbd5e1',
              }}>
                {p}
                <button onClick={() => onCambiar({ palabras: palabras.filter((_, j) => j !== i) })}
                  title="Quitar" style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={palabraNueva} onChange={(e) => setPalabraNueva(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregarPalabra() } }}
              placeholder="ej. precio" maxLength={60} style={estiloCampo} />
            <button onClick={agregarPalabra} style={estiloBotonChico}>+</button>
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
            Se compara sin mayúsculas ni tildes, y basta con que el mensaje la contenga.
          </div>
        </Bloque>
      )}
    </>
  )
}

// ── Mensaje ───────────────────────────────────────────────────────────────────

const tituloDeBoton = (b) => String((b && typeof b === 'object') ? b.title : b || '')

function EditorMensaje({ datos, respuestas, onCambiar }) {
  const origen = datos?.origen === 'respuesta' ? 'respuesta' : 'texto'
  const adjuntos = Array.isArray(datos?.adjuntos) ? datos.adjuntos : []
  const botones = Array.isArray(datos?.botones) ? datos.botones : []
  const elegida = (respuestas || []).find((r) => String(r.id) === String(datos?.respuestaId))

  const cambiarBoton = (i, titulo) => {
    const titulos = Array.from({ length: MAX_BOTONES }, (_, k) => (k === i ? titulo : tituloDeBoton(botones[k])))
    // Se recortan solo los vacíos DEL FINAL: uno vacío en el medio se conserva a
    // propósito para que la validación lo marque en rojo en vez de tapar el hueco
    // y renumerar los puertos por detrás (las líneas ya conectadas se moverían de
    // botón sin que nadie lo pida).
    while (titulos.length && !titulos[titulos.length - 1].trim()) titulos.pop()
    onCambiar({ botones: titulos.map((t) => ({ title: t })) })
  }

  const cambiarAdjunto = (i, parcial) =>
    onCambiar({ adjuntos: adjuntos.map((a, j) => (j === i ? { ...a, ...parcial } : a)) })

  return (
    <>
      <Bloque titulo="QUÉ MANDA">
        <Radios valor={origen} onChange={(o) => onCambiar({ origen: o })} opciones={[
          { id: 'respuesta', label: '⚡ Una respuesta rápida' },
          { id: 'texto', label: '✍️ Texto propio' },
        ]} />
      </Bloque>

      {origen === 'respuesta' ? (
        <Bloque titulo="RESPUESTA RÁPIDA">
          <select value={datos?.respuestaId || ''} onChange={(e) => onCambiar({ respuestaId: e.target.value })} style={estiloCampo}>
            <option value="">— elegir —</option>
            {(respuestas || []).map((r) => (
              <option key={r.id} value={r.id}>{String(r.text || '(sin texto)').slice(0, 60)}</option>
            ))}
          </select>
          {elegida && (
            <div style={{ marginTop: 8, padding: 9, background: FONDO_CAMPO, border: `1px solid ${BORDE}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{elegida.text || '(sin texto)'}</div>
              {adjuntosDeRespuesta(elegida).length > 0 && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>📎 {adjuntosDeRespuesta(elegida).length} adjunto(s)</div>
              )}
            </div>
          )}
          {datos?.respuestaId && !elegida && (
            <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>Esa respuesta rápida ya no existe.</div>
          )}
        </Bloque>
      ) : (
        <>
          <Bloque titulo="TEXTO">
            <textarea value={datos?.texto || ''} onChange={(e) => onCambiar({ texto: e.target.value })}
              rows={4} placeholder="Lo que le llega al cliente…" style={{ ...estiloCampo, resize: 'vertical' }} />
          </Bloque>
          <Bloque titulo={`ADJUNTOS (${adjuntos.length})`}>
            {adjuntos.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
                <input value={a?.url || ''} onChange={(e) => cambiarAdjunto(i, { url: e.target.value })}
                  placeholder="https://…" style={{ ...estiloCampo, flex: 1, minWidth: 0 }} />
                <select value={a?.tipo || 'imagen'} onChange={(e) => cambiarAdjunto(i, { tipo: e.target.value })}
                  style={{ ...estiloCampo, width: 100, flexShrink: 0 }}>
                  <option value="imagen">imagen</option>
                  <option value="audio">audio</option>
                  <option value="documento">documento</option>
                </select>
                <button onClick={() => onCambiar({ adjuntos: adjuntos.filter((_, j) => j !== i) })}
                  title="Quitar" style={{ ...estiloBotonChico, flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button onClick={() => onCambiar({ adjuntos: [...adjuntos, { url: '', tipo: 'imagen' }] })} style={estiloBotonChico}>
              + Adjunto por URL
            </button>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
              Salen en este orden, uno por mensaje: es el orden en que los ve el cliente.
            </div>
          </Bloque>
        </>
      )}

      <Bloque titulo={`BOTONES (máx. ${MAX_BOTONES} × ${MAX_TITULO} letras)`}>
        {Array.from({ length: MAX_BOTONES }, (_, i) => (
          <input key={i} value={tituloDeBoton(botones[i])} maxLength={MAX_TITULO}
            onChange={(e) => cambiarBoton(i, e.target.value)}
            placeholder={`Botón ${i + 1}`} style={{ ...estiloCampo, marginBottom: 5 }} />
        ))}
        <div style={{ fontSize: 10, color: '#64748b' }}>
          Con botones, cada uno abre su propia salida en la tarjeta (más «Otra respuesta»).
        </div>
      </Bloque>

      <Bloque titulo="Y DESPUÉS">
        <Casilla marcada={datos?.esperarRespuesta} onChange={(v) => onCambiar({ esperarRespuesta: v })}>
          ✋ Esperar la respuesta del cliente
        </Casilla>
        <Casilla marcada={datos?.citarUltimaRespuesta} onChange={(v) => onCambiar({ citarUltimaRespuesta: v })}>
          ↩ Citar la última respuesta del cliente
        </Casilla>
      </Bloque>

      <Bloque titulo="ETAPA AL LLEGAR ACÁ">
        {/* Solo se pone si el chat no tiene etapa: el flujo nunca pisa al vendedor.
            La temperatura ya no se pone desde un flujo (port desde IND, 23-sep-2026). */}
        <select value={datos?.etapa || ''} onChange={(e) => onCambiar({ etapa: e.target.value })} style={estiloCampo}>
          <option value="">— no la cambia —</option>
          <option value="cotizando">{EMOJI_ETAPA.cotizando} Cotizando (mandó su idea)</option>
          <option value="esperando_pago">{EMOJI_ETAPA.esperando_pago} Esperando pago</option>
        </select>
      </Bloque>

      <Bloque titulo="📌 LE DEBEMOS AL LLEGAR ACÁ">
        {/* Si este mensaje le PROMETE algo al cliente, anótalo: queda 📌 🤖 hasta que
            una persona cumpla. No pisa un 📌 que ya exista. Vacío = no anota nada. */}
        <input value={datos?.deuda || ''} onChange={(e) => onCambiar({ deuda: e.target.value.slice(0, 60) })}
          placeholder="ej: enviar boceto" style={estiloCampo} />
      </Bloque>
    </>
  )
}

// ── Condición ─────────────────────────────────────────────────────────────────

const PISTA_CONDICION = {
  temperatura: 'caliente (<1 h) · tibio (1–6 h) · frio (6–24 h) · dormido (>24 h)',
  etapa: 'cotizando · esperando_pago · falta_pedido · postventa',
  tiene_venta: 'si · no',
  hora: '09:00-18:00 (hora de Ecuador)',
  bandeja: 'pendiente · atendido · soporte · descartado',
}

function EditorCondicion({ datos, onCambiar }) {
  const campo = datos?.campo || 'temperatura'
  return (
    <>
      <Bloque titulo="QUÉ MIRA">
        <select value={campo} onChange={(e) => onCambiar({ campo: e.target.value })} style={estiloCampo}>
          <option value="temperatura">Temperatura (tiempo desde su último mensaje)</option>
          <option value="etapa">Etapa de la venta</option>
          <option value="tiene_venta">Tiene venta</option>
          <option value="hora">Hora (Ecuador)</option>
          <option value="bandeja">Bandeja</option>
        </select>
      </Bloque>
      <Bloque titulo="VALOR">
        <input value={datos?.valor || ''} onChange={(e) => onCambiar({ valor: e.target.value })}
          placeholder={PISTA_CONDICION[campo] || ''} style={estiloCampo} />
      </Bloque>
    </>
  )
}

// ── Línea ─────────────────────────────────────────────────────────────────────

function EditorLinea({ esperaMin, esperaSeg, onCambiar }) {
  // El estado vive acá porque "2" y "2 h" son la misma espera escrita de dos
  // formas: si el número se recalculara en cada tecla, cambiar la unidad
  // reescribiría el número que la persona está tecleando.
  //
  // SEGUNDOS no es "minutos con otra escala": una pausa en segundos se espera en el
  // mismo envío (el flujo sigue de corrido); una en minutos u horas DETIENE el flujo
  // y lo retoma el cron. Por eso van en campos distintos (`esperaSeg` / `esperaMin`)
  // y elegir una unidad limpia la otra.
  const enSeg = esperaSeg > 0
  const enHoras = !enSeg && esperaMin > 0 && esperaMin % 60 === 0
  const [unidad, setUnidad] = useState(enSeg ? 's' : enHoras ? 'h' : 'min')
  const [valor, setValor] = useState(enSeg ? String(esperaSeg) : esperaMin ? String(enHoras ? esperaMin / 60 : esperaMin) : '')

  const aplicar = (v, u) => {
    setValor(v); setUnidad(u)
    const n = String(v).trim()
    if (!n) { onCambiar({ esperaMin: 0, esperaSeg: 0 }); return }  // vacío = inmediato
    const num = Number(n)
    if (!Number.isFinite(num) || num < 0) return                     // basura: no se toca el grafo
    if (u === 's') { onCambiar({ esperaMin: 0, esperaSeg: Math.min(Math.round(num), MAX_ESPERA_SEG) }); return }
    onCambiar({ esperaMin: Math.min(Math.round(u === 'h' ? num * 60 : num), MAX_ESPERA_MIN), esperaSeg: 0 })
  }

  return (
    <Bloque titulo="ESPERA ANTES DE SEGUIR">
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="number" min="0" value={valor} onChange={(e) => aplicar(e.target.value, unidad)}
          placeholder="0" style={{ ...estiloCampo, flex: 1, minWidth: 0 }} />
        <select value={unidad} onChange={(e) => aplicar(valor, e.target.value)} style={{ ...estiloCampo, width: 96, flexShrink: 0 }}>
          <option value="s">segundos</option>
          <option value="min">minutos</option>
          <option value="h">horas</option>
        </select>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
        En blanco = sale de inmediato.<br />
        <b>Segundos</b>: pausa corta entre mensajes; el flujo sigue de corrido (tope {MAX_ESPERA_SEG} s por línea y {MAX_PAUSA_TANDA_SEG} s por envío).<br />
        <b>Minutos u horas</b>: el flujo se detiene y sigue después (tope {MAX_ESPERA_MIN / 60} h: después de 24 h Meta cierra la ventana).
      </div>
    </Bloque>
  )
}

// ── El panel ──────────────────────────────────────────────────────────────────

const TITULOS = { disparador: '📣 Disparador', mensaje: '💬 Mensaje', condicion: '🔀 Condición', fin: '🔴 Fin' }

/**
 * `nodo` = el nodo de React Flow seleccionado ({ id, type, data }) · `linea` = la
 * línea seleccionada ({ id, data:{esperaMin, esperaSeg} }). Nunca los dos a la vez.
 */
export default function PanelEdicion({ nodo, linea, anuncios, respuestas, errores = [], onCambiarNodo, onCambiarLinea }) {
  if (!nodo && !linea) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: '#64748b', fontFamily: 'Outfit,sans-serif' }}>
        Toca una tarjeta o una línea para editarla.
        <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6 }}>
          · Arrastra de un puerto de abajo al de arriba de otra tarjeta para conectarlas.<br />
          · Cada puerto admite UNA sola línea.<br />
          · Un puerto sin línea ya es un final.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 14, fontFamily: 'Outfit,sans-serif', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: '#e2e8f0', marginBottom: 12 }}>
        {nodo ? (TITULOS[nodo.type] || nodo.type) : '➡️ Línea'}
      </div>

      {nodo?.type === 'disparador' && <EditorDisparador datos={nodo.data} anuncios={anuncios} onCambiar={onCambiarNodo} />}
      {nodo?.type === 'mensaje' && <EditorMensaje datos={nodo.data} respuestas={respuestas} onCambiar={onCambiarNodo} />}
      {nodo?.type === 'condicion' && <EditorCondicion datos={nodo.data} onCambiar={onCambiarNodo} />}
      {nodo?.type === 'fin' && (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          El Fin no tiene nada que configurar. Termine como termine, el chat queda en PENDIENTES.
        </div>
      )}
      {linea && <EditorLinea esperaMin={Number(linea.data?.esperaMin) || 0} esperaSeg={Number(linea.data?.esperaSeg) || 0} onCambiar={onCambiarLinea} />}

      {errores.length > 0 && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.35)' }}>
          {errores.map((t, i) => (
            <div key={i} style={{ fontSize: 11, color: '#f87171', fontWeight: 700 }}>⚠️ {t}</div>
          ))}
        </div>
      )}
    </div>
  )
}
