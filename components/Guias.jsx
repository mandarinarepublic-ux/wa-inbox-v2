'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { listarGuiasServientrega, procesarGuiasServientrega, buscarPedidosParaGuia, asignarGuiaAPedido, buscarGuiaPorNumero } from '@/lib/api-client'
import { pareceNumeroDeGuia } from '@/lib/guias-servientrega'

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
  EXCLUIDA:   { icono: '🚫', texto: 'Excluida', color: '#7c8ba1' },
}

const METODO = { cedula: 'por cédula', celular: 'por celular', nombre: 'por nombre', manual: 'a mano', crm: 'desde el CRM' }

function Asignar({ guia, onListo }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [deLaGuia, setDeLaGuia] = useState(true)   // los resultados salen de lo leído en la guía
  const [buscando, setBuscando] = useState(false)
  const [elegido, setElegido] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [buscado, setBuscado] = useState('')       // el texto de la búsqueda que se está MOSTRANDO
  const ultimaRef = useRef(0)

  const sugeridos = { cel: guia.celular || '', nombre: guia.destinatario || '', dir: guia.direccion || '' }
  // ☠️ Solo la ÚLTIMA búsqueda pinta. La automática del arranque es lenta: si
  // llegaba después de una escrita, pisaba la lista bajo el título de la escrita
  // y se podía asignar la guía al pedido equivocado (que además pasa a COMPLETADO).
  const correr = async (consulta, deGuia) => {
    const id = ++ultimaRef.current
    setBuscando(true); setError(''); setElegido(null); setRes(null)
    try {
      const r = await buscarPedidosParaGuia(consulta)
      if (id !== ultimaRef.current) return
      setRes(r); setDeLaGuia(deGuia); setBuscado(deGuia ? '' : consulta)
    } catch (e) { if (id === ultimaRef.current) setError(e.message) }
    finally { if (id === ultimaRef.current) setBuscando(false) }
  }
  const buscar = () => {
    if (q.trim().length >= 3) correr(q.trim(), false)
    else if (!q.trim()) correr(sugeridos, true)
  }
  // Al abrir: celular, nombre y dirección de la guía A LA VEZ, cada uno por su lado.
  // Antes se buscaba solo con el celular y, si tenía un dígito mal leído, no salía nada.
  useEffect(() => { buscar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

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
          placeholder="Nombre, celular, cédula, dirección o pedido (MAN-…)"
          style={{ flex: 1, minWidth: 0, background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 8, color: '#e2e8f0', fontSize: 13, padding: '8px 10px', outline: 'none', fontFamily: 'inherit' }} />
        <button onClick={buscar} disabled={buscando} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#1e2d3d', color: '#e2e8f0', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {buscando ? '…' : '🔍'}
        </button>
      </div>
      {res && (
        <div style={{ fontSize: 12, color: '#7c8ba1', marginTop: 8 }}>
          {deLaGuia ? 'Sugeridos con el celular, el nombre y la dirección de la guía' : `Resultados para "${buscado}"`}
          {!deLaGuia && (
            <button onClick={() => { setQ(''); correr(sugeridos, true) }} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
              volver a los sugeridos
            </button>
          )}
        </div>
      )}
      {res && !res.length && <div style={{ fontSize: 12, color: '#7c8ba1', marginTop: 6 }}>No encontré pedidos con eso. Prueba con otro dato: un apellido, el celular o una palabra de la dirección.</div>}
      {res && res.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
          {res.map(p => {
            const on = elegido?.pedido_id === p.pedido_id
            return (
              <button key={p.pedido_id} onClick={() => setElegido(p)} style={{
                textAlign: 'left', padding: '7px 9px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? 'rgba(16,185,129,.12)' : 'transparent',
                border: `1px solid ${on ? 'rgba(16,185,129,.5)' : '#1e2d3d'}`, color: '#cbd5e1', fontSize: 12,
              }}>
                <b style={{ color: '#e2e8f0' }}>{p.pedido_id}</b> · {p.cliente || '—'} · <span style={{ color: p.puede ? VERDE : '#94a3b8' }}>{p.estado_pedido}</span> · {fecha(p.fecha_pedido)}
                {p.monto_total != null && ` · $${Number(p.monto_total).toFixed(2)}`}
                {p.tiene_guia && <span style={{ color: '#f59e0b' }}> · ya tiene guía</span>}
                {(p.celular || p.direccion) && (
                  <div style={{ color: '#7c8ba1', marginTop: 2 }}>
                    {p.celular && <>📱 {p.celular}</>}{p.celular && p.direccion && ' · '}{p.direccion && <>📍 {p.direccion}</>}
                  </div>
                )}
                {p.razones?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {p.razones.map(r => <span key={r} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'rgba(56,189,248,.1)', color: '#7dd3fc' }}>{r}</span>)}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
      {elegido && (
        <button onClick={asignar} disabled={guardando || buscando} style={{
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

// Guía encontrada por nombre sin segunda prueba: un clic para confirmarla.
function Confirmar({ g, onListo }) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const confirmar = async () => {
    setGuardando(true); setError('')
    try { await asignarGuiaAPedido(g.numero_guia, g.pedido_sugerido); onListo() }
    catch (e) { setError(e.message); setGuardando(false) }
  }
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={confirmar} disabled={guardando} style={{
        padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
        background: `linear-gradient(135deg,${VERDE},#059669)`, color: '#fff', opacity: guardando ? .6 : 1,
      }}>{guardando ? 'Guardando…' : `✅ Confirmar en ${g.pedido_sugerido}`}</button>
      <a href={CRM_PEDIDO(g.pedido_sugerido)} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: '#94a3b8', fontSize: 12 }}>ver pedido</a>
      {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>⚠️ {error}</div>}
    </div>
  )
}

function Fila({ g, onRecargar }) {
  const [asignando, setAsignando] = useState(false)
  const e = ESTADOS[g.estado] || ESTADOS.NUEVA
  return (
    <div style={{ background: '#0d1828', border: `1px solid ${e.color}66`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {g.media_url
          ? <a href={g.media_url} target="_blank" rel="noreferrer" title="Ver la guía"><img src={g.media_url} alt="" style={{ width: 54, height: 72, objectFit: 'cover', borderRadius: 7, border: '1px solid #1e2d3d' }} /></a>
          : <div style={{ width: 54, height: 72, borderRadius: 7, background: '#111c2a' }} />}
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ color: '#e2e8f0', fontSize: 14 }}>{g.numero_guia}</b>
            <span style={{ color: e.color, fontWeight: 800 }}>{e.icono} {e.texto}</span>
            <span style={{ color: '#7c8ba1' }}>{fecha(g.fecha_mensaje)}</span>
          </div>
          <div>📍 {g.destino || '—'}{g.destinatario && <> · 👤 {g.destinatario}</>}{g.celular && <> · 📱 {g.celular}</>}</div>
          {g.fecha_guia && <div>🗓 Despachada {fecha(g.fecha_guia)}</div>}
          {g.estado === 'REGISTRADA' && (
            <div>
              → <a href={CRM_PEDIDO(g.pedido_id)} target="_blank" rel="noreferrer" style={{ color: VERDE, fontWeight: 800 }}>{g.pedido_id}</a>
              {g.cliente && ` · ${g.cliente}`}{g.estado_pedido && ` · ${g.estado_pedido}`}
              {g.metodo && METODO[g.metodo] && <span style={{ color: '#7c8ba1' }}> · {METODO[g.metodo]}</span>}
            </div>
          )}
          {g.estado === 'REGISTRADA' && g.nota && <div style={{ color: '#7c8ba1' }}>{g.nota}</div>}
          {g.estado === 'PENDIENTE' && <div style={{ color: '#f59e0b' }}>{g.motivo}</div>}
          {g.estado === 'EXCLUIDA' && <div style={{ color: '#7c8ba1' }}>{g.motivo}</div>}
          {g.pedido_sugerido && <Confirmar g={g} onListo={onRecargar} />}
          {g.estado === 'NUEVA' && <div style={{ color: '#7c8ba1' }}>Aprieta "Procesar guías" para leerla.</div>}
        </div>
        {g.estado !== 'REGISTRADA' && g.estado !== 'EXCLUIDA' && (
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
  const [busca, setBusca] = useState('')
  const [enCrm, setEnCrm] = useState(null)     // la guía buscada en TODO el CRM (cualquier fecha)
  const [buscandoCrm, setBuscandoCrm] = useState(false)
  const [errorCrm, setErrorCrm] = useState('')  // aparte del `error` del panel: se limpia al cambiar la búsqueda
  const digitosRef = useRef('')                 // el número que está en la caja AHORA

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
  const texto = busca.trim().toLowerCase()
  const digitos = texto.replace(/\D/g, '')
  const coincide = (g) => !texto ||
    (digitos.length >= 3 && [g.numero_guia, g.celular].some(v => String(v || '').replace(/\D/g, '').includes(digitos))) ||
    [g.destinatario, g.pedido_id, g.pedido_sugerido, g.cliente, g.destino].some(v => String(v || '').toLowerCase().includes(texto))
  // Mientras se busca se mira en TODAS las bandejas: quien busca una guía no sabe en cuál quedó.
  const visibles = guias.filter(g => (texto || filtro === 'TODAS' || g.estado === filtro) && coincide(g))
  const esGuia = pareceNumeroDeGuia(busca)
  digitosRef.current = esGuia ? digitos : ''
  // La respuesta solo se pinta si la caja sigue teniendo el MISMO número: si
  // cambiaron el texto mientras tanto, mostraría guías de otro número.
  const buscarEnCrm = async () => {
    const d = digitos
    setBuscandoCrm(true); setEnCrm(null); setErrorCrm('')
    try { const r = await buscarGuiaPorNumero(d); if (digitosRef.current === d) setEnCrm(r) }
    catch (e) { if (digitosRef.current === d) setErrorCrm(e.message) }
    finally { setBuscandoCrm(false) }
  }
  const limpiarCrm = () => { setEnCrm(null); setErrorCrm('') }
  const chips = [['TODAS', 'Todas', guias.length], ['PENDIENTE', '⚠️ Sin asignar', n('PENDIENTE')], ['NUEVA', '🆕 Sin procesar', n('NUEVA')], ['REGISTRADA', '✅ Registradas', n('REGISTRADA')], ['EXCLUIDA', '🚫 Excluidas', n('EXCLUIDA')]]

  return (
    <div style={{ flex: 1, overflowY: 'auto', height: '100%', background: '#080d14' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 16px 60px' }}>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#e2e8f0' }}>🚚 Guías de Servientrega</div>
        <div style={{ fontSize: 12, color: '#7c8ba1', marginTop: 4, lineHeight: 1.5 }}>
          Las guías que <b style={{ color: '#94a3b8' }}>Rodri VIP</b> reenvía a este número (últimos {datos?.dias || 30} días).
          "Procesar" lee la foto, encuentra al cliente por celular o nombre y anota la guía en su último pedido
          (EN_FABRICA, DESPACHO o COMPLETADO reciente) y lo pasa a <b style={{ color: '#94a3b8' }}>COMPLETADO</b>.
          Solo registra sola cuando no hay duda: celular exacto de un solo cliente, nombre que no lo contradice y un solo pedido posible.
          Ante cualquier duda te propone el pedido y lo confirmas tú con ✅.
          Las que no encuentra quedan en ⚠️ para asignarlas a mano.
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

        <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
          <input value={busca} onChange={e => { setBusca(e.target.value); limpiarCrm() }}
            onKeyDown={e => e.key === 'Enter' && esGuia && !buscandoCrm && buscarEnCrm()}
            placeholder="🔍 Número de guía, cliente, celular, pedido o ciudad"
            style={{ flex: 1, minWidth: 0, background: '#0d1828', border: '1px solid #1e2d3d', borderRadius: 10, color: '#e2e8f0', fontSize: 16, padding: '9px 12px', outline: 'none', fontFamily: 'inherit' }} />
          {busca && (
            <button onClick={() => { setBusca(''); limpiarCrm() }} style={{ padding: '0 12px', borderRadius: 10, border: '1px solid #1e2d3d', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
          )}
        </div>
        {esGuia && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#7c8ba1' }}>
            {errorCrm ? (
              <span style={{ color: '#ef4444' }}>⚠️ No se pudo buscar en el CRM: {errorCrm} · <button onClick={buscarEnCrm} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0, fontSize: 12, fontFamily: 'inherit' }}>reintentar</button></span>
            ) : enCrm === null ? (
              <button onClick={buscarEnCrm} disabled={buscandoCrm} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0, fontSize: 12, fontFamily: 'inherit', textAlign: 'left' }}>
                {buscandoCrm ? 'Buscando en el CRM…' : `Buscar la guía ${digitos} en todo el CRM (cualquier fecha) →`}
              </button>
            ) : !enCrm.length ? (
              <span>Ninguna guía con "{digitos}" en el CRM.</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span>En el CRM ({enCrm.length}):</span>
                {enCrm.map(x => (
                  <div key={x.numero_guia + x.pedido_id} style={{ background: '#0d1828', border: `1px solid ${VERDE}55`, borderRadius: 10, padding: '8px 10px', color: '#94a3b8' }}>
                    <b style={{ color: '#e2e8f0' }}>{x.numero_guia}</b> → <a href={CRM_PEDIDO(x.pedido_id)} target="_blank" rel="noreferrer" style={{ color: VERDE, fontWeight: 800 }}>{x.pedido_id}</a>
                    {x.cliente && ` · ${x.cliente}`}{x.celular && ` · 📱 ${x.celular}`}{x.estado_pedido && ` · ${x.estado_pedido}`}
                    <div style={{ color: '#7c8ba1' }}>
                      🗓 {fecha(x.fecha_despacho)}{x.transportista && ` · ${x.transportista}`}{x.registrado_por && ` · por ${x.registrado_por}`}
                      {x.foto && <> · <a href={x.foto} target="_blank" rel="noreferrer" style={{ color: '#94a3b8' }}>ver foto</a></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', opacity: texto ? .45 : 1 }}>
          {chips.map(([id, txt, cuantos]) => (
            <button key={id} onClick={() => setFiltro(id)} style={{
              padding: '5px 11px', borderRadius: 14, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: filtro === id ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.03)',
              border: `1px solid ${filtro === id ? 'rgba(16,185,129,.5)' : '#1e2d3d'}`, color: filtro === id ? VERDE : '#94a3b8',
            }}>{txt} <span style={{ opacity: .6 }}>{cuantos}</span></button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {cargando && !datos && <div style={{ color: '#7c8ba1', fontSize: 13 }}>Cargando…</div>}
          {datos && !visibles.length && (
            <div style={{ color: '#7c8ba1', fontSize: 13, padding: 12 }}>
              {texto ? `Ninguna guía de los últimos ${datos?.dias || 30} días coincide con "${busca.trim()}".` : 'No hay guías en este filtro.'}
            </div>
          )}
          {visibles.map(g => <Fila key={g.numero_guia} g={g} onRecargar={cargar} />)}
        </div>
      </div>
    </div>
  )
}
