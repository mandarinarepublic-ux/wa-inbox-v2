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
      <div style={{ fontSize: 30, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function BarChart({ title, months, values, color, fmt = (v) => v }) {
  const max = Math.max(1, ...months.map(m => values[m.key] || 0))
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 130 }}>
        {months.map(m => {
          const v = values[m.key] || 0
          const h = Math.round((v / max) * 100)
          return (
            <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 9.5, color: C.text, fontWeight: 700, whiteSpace: 'nowrap' }}>{v ? fmt(v) : ''}</div>
              <div style={{ width: '100%', maxWidth: 38, height: `${h}%`, minHeight: v ? 4 : 0, background: `linear-gradient(180deg, ${color}, ${color}88)`, borderRadius: '6px 6px 2px 2px', transition: 'height .4s' }} />
              <div style={{ fontSize: 9, color: C.dim, whiteSpace: 'nowrap' }}>{m.label}</div>
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
    <div style={{ display: 'flex', gap: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3 }}>
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

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  const [meses, setMeses] = useState(6)
  const [vista, setVista] = useState('total') // 'total' | 'MANDARINA' | 'INDSTORE'

  const load = (m = meses) => {
    setErr(false); setData(null)
    fetch(`/api/dashboard?meses=${m}&t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData).catch(() => setErr(true))
  }
  useEffect(() => { load(meses) }, [meses])

  const D = data ? (vista === 'total' ? data.total : data.porTienda[vista]) : null
  const tituloVista = vista === 'total' ? 'Total del negocio' : (data?.porTienda[vista]?.label || vista)
  const accent = vista === 'INDSTORE' ? C.blue : vista === 'MANDARINA' ? C.orange : C.emerald

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Outfit, system-ui, sans-serif', padding: '24px 20px 40px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap'); *{box-sizing:border-box}`}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header + filtros */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.orange, letterSpacing: '3px' }}>⬡ DASHBOARD DEL NEGOCIO</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{tituloVista}</div>
          </div>
          <button onClick={() => load()} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Actualizar</button>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
          <FilterBtns value={vista} onChange={setVista} options={[
            { v: 'total', label: '🌎 Todo', color: C.emerald },
            { v: 'MANDARINA', label: '🍊 Mandarina', color: C.orange },
            { v: 'INDSTORE', label: '🖤 IND Store', color: C.blue },
          ]} />
          <FilterBtns value={meses} onChange={setMeses} options={[
            { v: 3, label: '3 meses' }, { v: 6, label: '6 meses' }, { v: 12, label: '12 meses' },
          ]} />
        </div>

        {err && <div style={{ background: '#2d0a0a', border: '1px solid #f8717140', color: C.red, borderRadius: 12, padding: 16, marginBottom: 20 }}>No se pudieron cargar los datos. <button onClick={() => load()} style={{ color: C.red, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>Reintentar</button></div>}
        {!data && !err && <div style={{ color: C.dim, padding: 40, textAlign: 'center' }}>Cargando métricas...</div>}

        {D && (<>
          {/* Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Tile label="Pendientes" value={D.estados.pendiente} color={C.red} sub="esperando respuesta" />
            <Tile label="Atendidos" value={D.estados.atendido} color={C.green} />
            <Tile label="Sin responder +24h" value={D.sinResponder} color={D.sinResponder ? C.red : C.green} sub="requieren atención" />
            <Tile label="Tiempo de respuesta" value={D.tiempoRespMin != null ? `${D.tiempoRespMin} min` : '—'} color={C.text} sub="promedio 1ª respuesta" />
            <Tile label="Contactos totales" value={D.totalContactos} color={C.text} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Tile label={`Ventas (${meses} meses)`} value={D.ventasTotal} color={accent} sub="pedidos creados" />
            <Tile label={`Monto vendido (${meses} meses)`} value={money(D.ventasMonto)} color={accent} sub="del CRM" />
            <Tile label="% Leídos" value={D.readRate != null ? `${D.readRate}%` : '—'} color={C.blue} sub="✓✓ de mensajes rastreados" />
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
            <BarChart title="💰 Ventas por mes ($)" months={data.months} values={D.ventasMontoPorMes} color={C.emerald} fmt={money} />
            <BarChart title="🧾 Nº de ventas por mes" months={data.months} values={D.ventasNPorMes} color={C.green} />
            <BarChart title="📈 Mensajes enviados por mes" months={data.months} values={D.salientesPorMes} color={C.orange} />
            <BarChart title="✨ Leads nuevos por mes" months={data.months} values={D.leadsPorMes} color={C.amber} />
          </div>

          {/* Estados: bandeja (Eje 1) + temperatura del lead (Eje 2) */}
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
