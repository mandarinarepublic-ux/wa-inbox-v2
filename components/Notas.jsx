'use client'
import { useState, useEffect, useCallback } from 'react'
import { fetchNotas, addNota, editNota, deleteNota } from '@/lib/api-client'
import { pedidoIdDeNota } from '@/lib/pedido-manual'

/**
 * Notas internas del chat: varias, cada una con su fecha, en acordeón.
 *
 * Antes era un textarea único que se sobreescribía: agregar algo obligaba a
 * abrir lo anterior y escribir al final, y si dos personas atendían el mismo
 * chat la última en guardar borraba lo de la otra sin enterarse.
 *
 * No se guarda quién escribió: el inbox no tiene login (decisión del 2-ago-2026).
 *
 * `refrescar` es un contador: el botón CREAR PEDIDO guarda el link del pedido
 * como una nota y lo incrementa para que la lista se actualice sin recargar.
 *
 * `onVerPedido(numero)` abre ese pedido DENTRO del panel. Lo baja `RightPanel`
 * (este componente se renderiza adentro suyo) y es el MISMO camino del "Ver →"
 * del historial: acá no se arma ninguna vista nueva.
 */

const AMBAR = '#f59e0b'
const VERDE = '#10b981'
const ROJO  = '#f87171'

// El color de la nota según su `tipo` (pago_ok = verde, pago_error = rojo,
// null = neutral como siempre). El color NUNCA es la única señal: cada tipo
// lleva también un marcador (✅/❌) que se lee igual sin distinguir colores.
function estiloTipo(tipo) {
  if (tipo === 'pago_ok')    return { color: VERDE, borde: 'rgba(16,185,129,.35)', fondo: 'rgba(16,185,129,.08)', marca: '✅' }
  if (tipo === 'pago_error') return { color: ROJO,  borde: 'rgba(248,113,113,.35)', fondo: 'rgba(248,113,113,.08)', marca: '❌' }
  return null
}

const sTextarea = {
  width: '100%', background: '#111c2a', border: '1px solid #1e2d3d', borderRadius: 7,
  color: '#ffffff', fontSize: 11, padding: '6px 8px', resize: 'vertical', outline: 'none',
  fontFamily: 'inherit', whiteSpace: 'pre-wrap', minHeight: 56,
}

export default function Notas({ telefono, refrescar = 0, onVerPedido }) {
  const [notas, setNotas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const [nueva, setNueva] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [abiertas, setAbiertas] = useState(() => new Set())
  const [editandoId, setEditandoId] = useState(null)
  const [editTexto, setEditTexto] = useState('')
  const [confirmarBorrar, setConfirmarBorrar] = useState(null)

  const cargar = useCallback(async () => {
    if (!telefono) return
    setCargando(true); setError('')
    try {
      const lista = await fetchNotas(telefono)
      setNotas(lista)
      // La más reciente abierta de entrada: es la que casi siempre se viene a
      // leer, y si es la única no tiene sentido un click para verla.
      setAbiertas(lista.length ? new Set([lista[0].id]) : new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setCargando(false)
    }
  }, [telefono])

  useEffect(() => { cargar() }, [cargar, refrescar])

  async function guardarNueva() {
    const texto = nueva.trim()
    if (!texto || guardando) return
    setGuardando(true); setError('')
    try {
      const nota = await addNota(telefono, texto)
      setNotas(n => [nota, ...n])
      setAbiertas(a => new Set([nota.id, ...a]))
      setNueva('')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  async function guardarEdicion(id) {
    const texto = editTexto.trim()
    if (!texto) return
    try {
      const nota = await editNota(id, texto)
      setNotas(n => n.map(x => (x.id === id ? nota : x)))
      setEditandoId(null)
    } catch (e) { setError(e.message) }
  }

  async function borrar(id) {
    try {
      await deleteNota(id)
      setNotas(n => n.filter(x => x.id !== id))
      setConfirmarBorrar(null)
    } catch (e) { setError(e.message) }
  }

  function alternar(id) {
    setAbiertas(a => {
      const s = new Set(a)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  return (
    <div>
      {/* Caja de nota nueva ARRIBA del listado: escribir es lo que más se hace,
          y con varias notas quedaría empujada fuera de la pantalla si fuera al
          final. Ctrl+Enter guarda sin soltar el teclado. */}
      <textarea
        value={nueva}
        onChange={e => setNueva(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardarNueva() }
        }}
        placeholder="Ej: Falta que envíe la foto del pago..."
        rows={3}
        style={sTextarea}
        onFocus={e => (e.target.style.borderColor = AMBAR)}
        onBlur={e => (e.target.style.borderColor = '#1e2d3d')}
      />
      <button
        onClick={guardarNueva}
        disabled={!nueva.trim() || guardando}
        style={{
          width: '100%', marginTop: 5, padding: 6,
          background: guardando ? '#111c2a' : 'rgba(245,158,11,.12)',
          border: '1px solid rgba(245,158,11,.3)', color: AMBAR, borderRadius: 7,
          fontSize: 11, fontWeight: 700, fontFamily: 'inherit', transition: 'all .15s',
          cursor: !nueva.trim() || guardando ? 'default' : 'pointer',
          opacity: !nueva.trim() && !guardando ? .45 : 1,
        }}>
        {guardando ? '⏳ Guardando...' : '＋ Agregar nota'}
      </button>

      {error && <div style={{ fontSize: 10, color: '#f87171', marginTop: 5 }}>⚠️ {error}</div>}

      {cargando ? (
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>Cargando notas...</div>
      ) : notas.length === 0 ? (
        <div style={{ fontSize: 10, color: '#475569', marginTop: 8 }}>Sin notas todavía.</div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {notas.map(nota => {
            const abierta = abiertas.has(nota.id)
            const editando = editandoId === nota.id
            // pago_ok = verde, pago_error = rojo, null = exactamente como antes.
            // El color nunca es la única señal: el marcador (✅/❌) se lee igual
            // aunque no se distingan los colores.
            const est = estiloTipo(nota.tipo)
            return (
              <div key={nota.id} style={{
                border: `1px solid ${est ? est.borde : '#1e2d3d'}`, borderRadius: 7, overflow: 'hidden',
                background: est ? est.fondo : '#0d1523',
              }}>
                <div
                  onClick={() => alternar(nota.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', cursor: 'pointer' }}>
                  <span style={{ fontSize: 8, color: '#64748b', flexShrink: 0 }}>{abierta ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtFecha(nota.creado_at)}
                  </span>
                  {est && <span style={{ fontSize: 10, flexShrink: 0 }}>{est.marca}</span>}
                  {/* Cerrada muestra la primera línea: así se encuentra la nota
                      que se busca sin tener que abrirlas todas. */}
                  {!abierta && (
                    <span style={{ fontSize: 11, color: est ? est.color : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {primeraLinea(nota.texto)}
                    </span>
                  )}
                </div>

                {abierta && (
                  <div style={{ padding: '7px 8px 8px', borderTop: '1px solid #111c2a' }}>
                    {editando ? (
                      <>
                        <textarea value={editTexto} onChange={e => setEditTexto(e.target.value)} rows={4} autoFocus style={sTextarea} />
                        <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                          <button onClick={() => guardarEdicion(nota.id)}
                            style={{ flex: 1, padding: 5, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.3)', color: AMBAR, borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Guardar</button>
                          <button onClick={() => setEditandoId(null)}
                            style={{ flex: 1, padding: 5, background: 'rgba(255,255,255,.04)', border: '1px solid #2a3f55', color: '#94a3b8', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* El pedido del CRM: el botón PEDIDO MANUAL deja la
                            nota con su número y su link.

                            Era un <a target="_blank"> y ABRÍA UNA PESTAÑA NUEVA:
                            te sacaba del inbox justo cuando estabas atendiendo.
                            Ahora abre el pedido DENTRO del panel, exactamente
                            por donde lo abre el "Ver →" del historial
                            (`onVerPedido` → `VerPedido`).

                            Se le pasa el NÚMERO, nunca la url que trae escrita
                            la nota: esa la armó el CRM el día del pedido y puede
                            apuntar al dominio de Vercel, donde la cookie de
                            sesión no viaja y se vería un login. Ver el ⚠️ de
                            `pedidoIdDeNota`. */}
                        {(() => {
                          const id = pedidoIdDeNota(nota.texto)
                          return id && onVerPedido ? (
                            <button onClick={() => onVerPedido(id)} title="Ver el pedido acá mismo"
                              style={{ display: 'inline-block', marginBottom: 5, padding: '3px 8px', background: 'rgba(16,185,129,.15)', border: '1px solid rgba(16,185,129,.35)', color: '#10b981', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📄 Ver pedido</button>
                          ) : null
                        })()}
                        <div style={{ fontSize: 11, color: est ? est.color : '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {est ? `${est.marca} ` : ''}{nota.texto}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                          <button onClick={() => { setEditandoId(nota.id); setEditTexto(nota.texto) }}
                            style={{ background: 'none', border: 'none', padding: 0, color: '#64748b', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Editar</button>
                          {confirmarBorrar === nota.id ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: 10, color: '#f87171' }}>¿Borrar?</span>
                              <button onClick={() => borrar(nota.id)}
                                style={{ background: '#ef4444', border: 'none', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>Sí</button>
                              <button onClick={() => setConfirmarBorrar(null)}
                                style={{ background: '#334155', border: 'none', color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>No</button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmarBorrar(nota.id)}
                              style={{ background: 'none', border: 'none', padding: 0, color: '#475569', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>✕ Borrar</button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function primeraLinea(texto) {
  const l = String(texto || '').split('\n').find(x => x.trim())
  return l ? l.trim() : '(vacía)'
}

/**
 * Fecha corta, en hora de Ecuador.
 *
 * Supabase devuelve los timestamptz en UTC; sin la zona, una nota escrita a las
 * 8 de la noche aparecería con la fecha del día siguiente. Si es de hoy solo se
 * muestra la hora — la fecha completa sería ruido.
 */
function fmtFecha(iso) {
  try {
    const d = new Date(iso)
    const dia = (x) => x.toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })
    const esHoy = dia(d) === dia(new Date())
    return d.toLocaleString('es-EC', {
      timeZone: 'America/Guayaquil',
      ...(esHoy ? {} : { day: '2-digit', month: '2-digit' }),
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return '' }
}
