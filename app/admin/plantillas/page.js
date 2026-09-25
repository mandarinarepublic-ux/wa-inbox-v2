'use client'
// /admin/plantillas — Crear plantillas de WhatsApp en la WABA de cada número y ver
// en qué estado las tiene Meta (pendiente, aprobada, rechazada y por qué).
//
// Nació para REPUBLIC (24-sep-2026): su WABA tenía CERO plantillas, así que fuera
// de las 24 h no podía escribirle a nadie. Además es la pantalla que se graba para
// la revisión de la app de Meta (permiso whatsapp_business_management).
//
// Las plantillas son de la WABA, no de la marca: el canal elegido acá decide en
// qué WABA se crea. Por defecto REPUBLIC.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CANALES } from '@/lib/canales'
import { CATEGORIAS, IDIOMAS, armarPlantilla, normalizarNombre, variablesDe } from '@/lib/plantilla-nueva'

const C = { bg: '#0b0f14', card: '#131a22', border: '#243040', text: '#e6edf3', dim: '#8b98a5', green: '#25d366', orange: '#f97316', red: '#f87171' }
const COLOR_ESTADO = { APPROVED: C.green, PENDING: C.orange, REJECTED: C.red }
const NOMBRE_ESTADO = { APPROVED: 'Aprobada', PENDING: 'En revisión', REJECTED: 'Rechazada', PAUSED: 'Pausada', DISABLED: 'Desactivada' }

export default function Plantillas() {
  const [canalId, setCanalId] = useState('REPUBLIC')
  const canal = CANALES.find((c) => c.id === canalId) || CANALES[0]
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState({ nombre: '', categoria: 'UTILITY', idioma: 'es', cuerpo: '', pie: '', ejemplos: [] })
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState(null)   // { tipo: 'ok'|'error', texto }

  const cargar = useCallback(() => {
    setLista(null)
    fetch(`/api/plantillas?canal=${canal.phoneId}&todas=1`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setLista(j.ok ? j.templates : { error: j.error || j.needsEnv || 'No se pudo leer' }))
      .catch((e) => setLista({ error: e.message }))
  }, [canal.phoneId])
  useEffect(() => { cargar() }, [cargar])

  const vars = useMemo(() => variablesDe(form.cuerpo), [form.cuerpo])
  const revision = useMemo(() => armarPlantilla(form), [form])
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setEjemplo = (i) => (e) => setForm((f) => { const ej = [...f.ejemplos]; ej[i] = e.target.value; return { ...f, ejemplos: ej } })

  const crear = async () => {
    setAviso(null); setOcupado(true)
    try {
      const r = await fetch('/api/plantillas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canal: canal.phoneId, ...form }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.errores?.join(' ') || j.error || `HTTP ${r.status}`)
      setAviso({ tipo: 'ok', texto: `Listo: "${j.nombre}" quedó ${NOMBRE_ESTADO[j.status] || j.status} en ${canal.etiqueta}. Meta suele revisarla en minutos.` })
      setForm((f) => ({ ...f, nombre: '', cuerpo: '', pie: '', ejemplos: [] }))
      cargar()
    } catch (e) {
      setAviso({ tipo: 'error', texto: e.message })
    } finally { setOcupado(false) }
  }

  // Vista previa con los ejemplos puestos, como la verá el cliente.
  const vista = form.cuerpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => form.ejemplos[Number(n) - 1] || m)

  return (
    <main style={{ background: C.bg, color: C.text, minHeight: '100vh', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Plantillas de WhatsApp</h1>
        <p style={{ color: C.dim, margin: '0 0 18px', lineHeight: 1.5 }}>
          Las plantillas son el único mensaje que se le puede mandar a un cliente <b>después de 24 horas</b> sin que
          haya escrito. Cada número tiene las suyas. Meta revisa cada plantilla nueva antes de dejarla usar.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {CANALES.map((c) => (
            <button key={c.id} onClick={() => setCanalId(c.id)} style={{
              background: c.id === canalId ? c.color : C.card, color: c.id === canalId ? C.bg : C.text,
              border: `1px solid ${C.border}`, borderRadius: 999, padding: '8px 14px', fontWeight: 700, cursor: 'pointer',
            }}>{c.titulo}</button>
          ))}
        </div>

        <section style={card}>
          <div style={rotulo}>Nueva plantilla en {canal.etiqueta}</div>

          <label style={lbl}>Nombre
            <input value={form.nombre} onChange={set('nombre')} placeholder="retomar_consulta" style={inp} />
            {form.nombre && <span style={{ color: C.dim, fontSize: 12 }}>Se guardará como <b>{normalizarNombre(form.nombre) || '—'}</b></span>}
          </label>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...lbl, flex: 1, minWidth: 160 }}>Categoría
              <select value={form.categoria} onChange={set('categoria')} style={inp}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c === 'UTILITY' ? 'Servicio (pedido, envío, seguimiento)' : 'Marketing (promos, novedades)'}</option>)}
              </select>
            </label>
            <label style={{ ...lbl, flex: 1, minWidth: 120 }}>Idioma
              <select value={form.idioma} onChange={set('idioma')} style={inp}>
                {IDIOMAS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </div>

          <label style={lbl}>Mensaje <span style={{ color: C.dim, fontWeight: 400 }}>— usa {'{{1}}'}, {'{{2}}'}… para lo que cambia (nombre, pedido)</span>
            <textarea value={form.cuerpo} onChange={set('cuerpo')} rows={5} placeholder="Hola {{1}}, te escribimos de Mandarina Republic por tu consulta. ¿Seguimos con tu pedido?" style={{ ...inp, resize: 'vertical' }} />
          </label>

          {vars.map((n, i) => (
            <label key={n} style={lbl}>Ejemplo para {`{{${n}}}`}
              <input value={form.ejemplos[i] || ''} onChange={setEjemplo(i)} placeholder={i === 0 ? 'Ana' : ''} style={inp} />
            </label>
          ))}

          <label style={lbl}>Pie (opcional)
            <input value={form.pie} onChange={set('pie')} maxLength={60} placeholder="Mandarina Republic" style={inp} />
          </label>

          {form.cuerpo && (
            <div style={{ background: '#0f2a1d', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, margin: '6px 0 12px', whiteSpace: 'pre-wrap' }}>
              {vista}
              {form.pie && <div style={{ color: C.dim, fontSize: 12, marginTop: 6 }}>{form.pie}</div>}
            </div>
          )}

          {!revision.ok && form.cuerpo && (
            <ul style={{ color: C.orange, margin: '0 0 12px', paddingLeft: 18 }}>{revision.errores.map((e) => <li key={e}>{e}</li>)}</ul>
          )}

          <button onClick={crear} disabled={!revision.ok || ocupado} style={btn(canal.color, !revision.ok || ocupado)}>
            {ocupado ? 'Enviando a Meta…' : `Crear plantilla en ${canal.etiqueta}`}
          </button>

          {aviso && <div style={{ color: aviso.tipo === 'ok' ? C.green : C.red, marginTop: 12 }}>{aviso.texto}</div>}
        </section>

        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={rotulo}>Plantillas de {canal.etiqueta}</div>
            <button onClick={cargar} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer' }}>↻ Actualizar</button>
          </div>
          {lista === null && <div style={{ color: C.dim }}>Leyendo…</div>}
          {lista?.error && <div style={{ color: C.red }}>{lista.error}</div>}
          {Array.isArray(lista) && lista.length === 0 && <div style={{ color: C.dim }}>Este número todavía no tiene plantillas.</div>}
          {Array.isArray(lista) && lista.map((t) => (
            <div key={`${t.name}-${t.language}`} style={{ borderTop: `1px solid ${C.border}`, padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>{t.name} <span style={{ color: C.dim, fontWeight: 400 }}>· {t.language} · {t.category}</span></b>
                <span style={{ color: COLOR_ESTADO[t.status] || C.dim, fontWeight: 700 }}>{NOMBRE_ESTADO[t.status] || t.status}</span>
              </div>
              <div style={{ color: C.dim, whiteSpace: 'pre-wrap', marginTop: 4 }}>{t.bodyText}</div>
              {t.rejectedReason && <div style={{ color: C.red, fontSize: 12, marginTop: 4 }}>Motivo de Meta: {t.rejectedReason}</div>}
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}

const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }
const rotulo = { fontSize: 12, color: C.dim, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 600, fontSize: 14, marginBottom: 12 }
const inp = { background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', fontWeight: 400 }

function btn(color, disabled = false) {
  return {
    background: disabled ? '#1f2937' : color, color: disabled ? '#6b7280' : '#0b0f14',
    border: 'none', borderRadius: 10, padding: '12px 18px', fontWeight: 800, fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer', width: '100%',
  }
}
