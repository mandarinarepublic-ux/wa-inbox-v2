'use client'
import { useEffect, useState } from 'react'

const C = {
  bg: '#080d14', card: '#0d1420', border: '#1e2d3d', text: '#e2e8f0', dim: '#64748b',
  orange: '#f97316', green: '#4ade80', red: '#f87171', amber: '#f59e0b', emerald: '#10b981', violet: '#a78bfa', slate: '#64748b', blue: '#60a5fa',
}
const money = (v) => '$' + Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 0 })

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function BarChart({ title, periods, values, color, fmt = (v) => v }) {
  const max = Math.max(1, ...periods.map(m => values[m.key] || 0))
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: periods.length > 14 ? 3 : 8, height: 130 }}>
        {periods.map(m => {
          const v = values[m.key] || 0
          const h = Math.round((v / max) * 100)
          return (
            <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {periods.length <= 14 && <div style={{ fontSize: 9.5, color: C.text, fontWeight: 700, whiteSpace: 'nowrap' }}>{v ? fmt(v) : ''}</div>}
              <div title={`${m.label}: ${fmt(v)}`} style={{ width: '100%', maxWidth: 38, height: `${h}%`, minHeight: v ? 4 : 0, background: `linear-gradient(180deg, ${color}, ${color}88)`, borderRadius: '6px 6px 2px 2px', transition: 'height .4s' }} />
              {periods.length <= 16 && <div style={{ fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>{m.label}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BarList({ title, rows }) {
  const max = Math.max(1, ...rows.map(r => r.value || 0))
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 100, fontSize: 12, color: C.dim, flexShrink: 0 }}>{r.label}</div>
          <div style={{ flex: 1, height: 20, background: '#0a0f18', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: r.color, borderRadius: 6, transition: 'width .4s' }} />
          </div>
          <div style={{ width: 40, textAlign: 'right', fontSize: 13, fontWeight: 700, color: r.color }}>{r.value}</div>
        </div>
      ))}
    </div>
  )
}

function FilterBtns({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          style={{ padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', transition: 'all .15s',
            background: value === o.v ? (o.color || C.orange) : 'transparent', color: value === o.v ? '#fff' : C.dim }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const RANGOS = [
  { v: 'hoy', label: 'Hoy' }, { v: 'ayer', label: 'Ayer' }, { v: 'semana', label: 'Esta semana' },
  { v: 'mes', label: 'Este mes' }, { v: '30d', label: 'Últimos 30 días' }, { v: 'rango', label: 'Rango…' },
]
const RANGO_LABEL = Object.fromEntries(RANGOS.map(r => [r.v, r.label]))

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [err, setErr]   = useState(false)
  const [rango, setRango] = useState('mes')
  const [cd, setCd] = useState('') // custom desde
  const [ch, setCh] = useState('') // custom hasta
  const [vista, setVista] = useState('total') // 'total' | 'MANDARINA' | 'INDSTORE'

  const load = () => {
    setErr(false); setData(null)
    let url = `/api/dashboard?rango=${rango}&t=${Date.now()}`
    if (rango === 'rango') { if (!cd || !ch) return; url += `&desde=${cd}&hasta=${ch}` }
    fetch(url, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData).catch(() => setErr(true))
  }
  useEffect(() => { load() }, [rango, cd, ch]) // eslint-disable-line

  const D = data ? (vista === 'total' ? data.total : data.porTienda[vista]) : null
  const tituloVista = vista === 'total' ? 'Total del negocio' : (data?.porTienda[vista]?.label || vista)
  const accent = vista === 'INDSTORE' ? C.blue : vista === 'MANDARINA' ? C.orange : C.emerald
  const hoy = D?.hoy

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Outfit, system-ui, sans-serif', padding: '24px 20px 40px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap'); *{box-sizing:border-box}
        input[type=date]{color-scheme:dark}`}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.orange, letterSpacing: '3px' }}>⬡ DASHBOARD DEL NEGOCIO</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{tituloVista}</div>
          </div>
          <button onClick={load} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Actualizar</button>
        </div>

        {/* Selector de tienda */}
        <div style={{ marginBottom: 16 }}>
          <FilterBtns value={vista} onChange={setVista} options={[
            { v: 'total', label: '🌎 Todo', color: C.emerald },
            { v: 'MANDARINA', label: '🍊 Mandarina', color: C.orange },
            { v: 'INDSTORE', label: '🖤 IND Store', color: C.blue },
          ]} />
        </div>

        {/* ══════ HOY (siempre visible, no depende del filtro de rango) ══════ */}
        {hoy && (
          <div style={{ background: `linear-gradient(90deg, ${accent}22, ${C.card})`, border: `1px solid ${accent}55`, borderRadius: 16, padding: '16px 20px', marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: accent, letterSpacing: '2px', marginBottom: 8 }}>📌 HOY</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
              Te faltan <span style={{ color: hoy.porContestar ? C.red : C.green }}>{hoy.porContestar}</span> por contestar
              {hoy.calientes > 0 && <span style={{ fontSize: 15, color: C.orange, fontWeight: 700 }}>{'  '}· 🔥 {hoy.calientes} caliente{hoy.calientes === 1 ? '' : 's'}</span>}
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }}>
              <span>✨ <b>{hoy.nuevos}</b> <span style={{ color: C.dim }}>chats nuevos</span></span>
              <span>📥 <b>{hoy.entrantes}</b> <span style={{ color: C.dim }}>recibidos</span></span>
              <span>📤 <b>{hoy.salientes}</b> <span style={{ color: C.dim }}>enviados</span></span>
              <span>💰 <b style={{ color: C.emerald }}>{hoy.ventas}</b> <span style={{ color: C.dim }}>ventas</span> <b style={{ color: C.emerald }}>{money(hoy.ventasMonto)}</b></span>
            </div>
          </div>
        )}

        {/* Filtro de rango (afecta KPIs y gráficas de abajo) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <FilterBtns value={rango} onChange={setRango} options={RANGOS} />
          {rango === 'rango' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={cd} onChange={e => setCd(e.target.value)} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }} />
              <span style={{ color: C.dim }}>→</span>
              <input type="date" value={ch} onChange={e => setCh(e.target.value)} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }} />
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>Métricas de: <b style={{ color: C.dim2 || C.text }}>{RANGO_LABEL[rango]}</b></div>

        {err && <div style={{ background: '#2d0a0a', border: '1px solid #f8717140', color: C.red, borderRadius: 12, padding: 16, marginBottom: 20 }}>No se pudieron cargar los datos. <button onClick={load} style={{ color: C.red, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>Reintentar</button></div>}
        {!data && !err && <div style={{ color: C.dim, padding: 40, textAlign: 'center' }}>Cargando métricas...</div>}

        {D && (<>
          {/* KPIs de VENTAS del rango */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
            <Tile label="Ventas" value={D.ventasTotal} color={accent} sub="pedidos (CRM)" />
            <Tile label="Monto vendido" value={money(D.ventasMonto)} color={accent} />
            <Tile label="Ticket promedio" value={D.ticket != null ? money(D.ticket) : '—'} color={C.text} sub="$ por venta" />
            <Tile label="Conversión" value={D.conversion != null ? `${D.conversion}%` : '—'} color={C.emerald} sub="ventas ÷ leads" />
          </div>
          {/* KPIs de ATENCIÓN del rango */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Tile label="Leads nuevos" value={D.leads} color={C.amber} sub="1er contacto en el periodo" />
            <Tile label="% Leads contestados" value={D.leadsContestadosPct != null ? `${D.leadsContestadosPct}%` : '—'} color={D.leadsContestadosPct != null && D.leadsContestadosPct < 80 ? C.red : C.green} sub={`${D.leadsContestados}/${D.leads} respondidos`} />
            <Tile label="Tiempo 1ª respuesta" value={D.tiempoRespMin != null ? (D.tiempoRespMin >= 60 ? `${Math.round(D.tiempoRespMin / 60 * 10) / 10} h` : `${D.tiempoRespMin} min`) : '—'} color={C.text} sub="promedio" />
            <Tile label="% Leídos ✓✓" value={D.readRate != null ? `${D.readRate}%` : '—'} color={C.blue} sub="de mensajes rastreados" />
          </div>

          {/* Gráficas del rango */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
            <BarChart title="💰 Ventas ($)" periods={data.periods} values={D.ventasMontoPorPeriodo} color={C.emerald} fmt={money} />
            <BarChart title="🧾 Nº de ventas" periods={data.periods} values={D.ventasNPorPeriodo} color={C.green} />
            <BarChart title="📤 Mensajes enviados" periods={data.periods} values={D.salientesPorPeriodo} color={C.orange} />
            <BarChart title="✨ Leads nuevos" periods={data.periods} values={D.leadsPorPeriodo} color={C.amber} />
          </div>

          {/* Estado actual (no depende del rango) */}
          <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', margin: '4px 0 12px' }}>Estado actual del inbox · {D.totalContactos} contactos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 26 }}>
            <BarList title="Estado de las bandejas" rows={[
              { label: 'Pendientes', color: C.red,     value: D.estados.pendiente },
              { label: 'Atendidos',  color: C.green,   value: D.estados.atendido },
              { label: 'Soporte',    color: C.violet,  value: D.estados.soporte },
              { label: 'Archivados', color: C.slate,   value: D.estados.archivado },
              { label: '💰 Ventas',  color: C.emerald, value: D.ventasInbox },
            ]} />
            <BarList title="🌡️ Temperatura de leads" rows={[
              { label: '🔥 Caliente', color: C.orange, value: D.temperatura.caliente },
              { label: '🌤️ Tibio',    color: C.amber,  value: D.temperatura.tibio },
              { label: '❄️ Frío',     color: C.blue,   value: D.temperatura.frio },
            ]} />
          </div>
        </>)}

        {/* Botones a las apps */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <a href="/" style={{ display: 'block', textAlign: 'center', padding: '18px', borderRadius: 14, background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontSize: 16, fontWeight: 800, textDecoration: 'none' }}>📱 Abrir MANDARINA Inbox</a>
          <a href="https://ind-inbox-v2.vercel.app" style={{ display: 'block', textAlign: 'center', padding: '18px', borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 16, fontWeight: 800, textDecoration: 'none' }}>🖤 Abrir IND STORE Inbox →</a>
        </div>

        {data && <div style={{ textAlign: 'center', color: C.dim, fontSize: 11, marginTop: 20 }}>Actualizado {new Date(data.generadoEn).toLocaleString('es-EC')}</div>}
      </div>
    </div>
  )
}
