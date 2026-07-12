'use client'
import { useEffect, useState } from 'react'

const C = {
  bg: '#080d14', card: '#0d1420', border: '#1e2d3d', text: '#e2e8f0', dim: '#64748b',
  orange: '#f97316', green: '#4ade80', red: '#f87171', amber: '#f59e0b', emerald: '#10b981', violet: '#a78bfa', slate: '#64748b',
}
const ESTADOS = [
  { key: 'pendiente',    label: 'Pendientes',  color: C.red },
  { key: 'ventaproceso', label: 'En proceso',  color: C.amber },
  { key: 'atendido',     label: 'Atendidos',   color: C.green },
  { key: 'venta',        label: 'Ventas',      color: C.emerald },
  { key: 'soporte',      label: 'Soporte',     color: C.violet },
  { key: 'archivado',    label: 'Archivados',  color: C.slate },
]

function Tile({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.dim, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

// Gráfico de barras verticales para una serie mensual
function BarChart({ title, months, values, color, fmt = (v) => v }) {
  const max = Math.max(1, ...months.map(m => values[m.key] || 0))
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
        {months.map(m => {
          const v = values[m.key] || 0
          const h = Math.round((v / max) * 100)
          return (
            <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: C.text, fontWeight: 700, whiteSpace: 'nowrap' }}>{v ? fmt(v) : ''}</div>
              <div style={{ width: '100%', maxWidth: 42, height: `${h}%`, minHeight: v ? 4 : 0, background: `linear-gradient(180deg, ${color}, ${color}88)`, borderRadius: '6px 6px 2px 2px', transition: 'height .4s' }} />
              <div style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>{m.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)

  const load = () => {
    setErr(false)
    fetch(`/api/dashboard?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setData).catch(() => setErr(true))
  }
  useEffect(() => { load() }, [])

  const money = (v) => '$' + Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 0 })

  return (
    <div style={{ minHeight: '100dvh', background: C.bg, color: C.text, fontFamily: 'Outfit, system-ui, sans-serif', padding: '24px 20px 40px' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap'); *{box-sizing:border-box}`}</style>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.orange, letterSpacing: '3px' }}>⬡ MANDARINA REPUBLIC</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>Dashboard de conversaciones</div>
          </div>
          <button onClick={load} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Actualizar</button>
        </div>

        {err && <div style={{ background: '#2d0a0a', border: '1px solid #f8717140', color: C.red, borderRadius: 12, padding: 16, marginBottom: 20 }}>No se pudieron cargar los datos. <button onClick={load} style={{ color: C.red, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>Reintentar</button></div>}

        {!data && !err && <div style={{ color: C.dim, padding: 40, textAlign: 'center' }}>Cargando métricas...</div>}

        {data && (<>
          {/* Tiles principales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Tile label="Pendientes" value={data.estados.pendiente} color={C.red} sub="esperando respuesta" />
            <Tile label="En proceso" value={data.estados.ventaproceso} color={C.amber} />
            <Tile label="Atendidos" value={data.estados.atendido} color={C.green} />
            <Tile label="Sin responder +24h" value={data.sinResponder} color={data.sinResponder ? C.red : C.green} sub="requieren atención" />
            <Tile label="Tiempo de respuesta" value={data.tiempoRespMin != null ? `${data.tiempoRespMin} min` : '—'} color={C.text} sub="promedio 1ª respuesta" />
            <Tile label="Contactos totales" value={data.totalContactos} color={C.text} />
          </div>

          {/* Ventas destacadas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            <Tile label="Ventas (6 meses)" value={data.ventasTotalPeriodo} color={C.emerald} sub="pedidos creados" />
            <Tile label="Monto vendido (6 meses)" value={money(data.ventasMontoPeriodo)} color={C.emerald} sub="del CRM Mandarina" />
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
            <BarChart title="💰 Ventas por mes ($)" months={data.months} values={data.ventasMontoPorMes} color={C.emerald} fmt={money} />
            <BarChart title="📈 Actividad por mes (mensajes enviados)" months={data.months} values={data.salientesPorMes} color={C.orange} />
            <BarChart title="✨ Leads nuevos por mes" months={data.months} values={data.leadsPorMes} color={C.amber} />
            <BarChart title="🧾 Nº de ventas por mes" months={data.months} values={data.ventasNPorMes} color={C.green} />
          </div>

          {/* Estados actuales — barras */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 26 }}>
            <div style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 14 }}>Estado actual de las bandejas</div>
            {(() => {
              const max = Math.max(1, ...ESTADOS.map(e => data.estados[e.key] || 0))
              return ESTADOS.map(e => {
                const v = data.estados[e.key] || 0
                return (
                  <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 90, fontSize: 12, color: C.dim, flexShrink: 0 }}>{e.label}</div>
                    <div style={{ flex: 1, height: 20, background: '#0a0f18', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: e.color, borderRadius: 6, transition: 'width .4s' }} />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontSize: 13, fontWeight: 700, color: e.color }}>{v}</div>
                  </div>
                )
              })
            })()}
          </div>
        </>)}

        {/* Botones a las apps */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <a href="/" style={{ display: 'block', textAlign: 'center', padding: '18px', borderRadius: 14, background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontSize: 16, fontWeight: 800, textDecoration: 'none' }}>
            📱 Abrir MANDARINA Inbox
          </a>
          <a href="https://ind-inbox-v2.vercel.app" style={{ display: 'block', textAlign: 'center', padding: '18px', borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 16, fontWeight: 800, textDecoration: 'none' }}>
            🖤 Abrir IND STORE Inbox →
          </a>
        </div>

        {data && <div style={{ textAlign: 'center', color: C.dim, fontSize: 11, marginTop: 20 }}>Actualizado {new Date(data.generadoEn).toLocaleString('es-EC')}</div>}
      </div>
    </div>
  )
}
