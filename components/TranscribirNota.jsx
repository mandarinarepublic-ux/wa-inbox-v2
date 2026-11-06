'use client'
import { useState } from 'react'
import { transcribirNota } from '@/lib/transcribir-navegador'

// 📝 Botón "Transcribir" de una nota de voz. El texto se guarda en la base, así el
// resto del equipo lo ve sin volver a transcribir. Ver lib/transcripcion.js.

function textoEstado(e) {
  if (e.fase === 'descarga') return `Bajando el transcriptor (unos 485 MB, solo la primera vez)… ${e.pct ?? 0} %`
  if (e.fase === 'cargando') return 'Preparando el transcriptor…'
  if (e.fase === 'transcribiendo') return 'Transcribiendo… puede tardar más de 30 segundos'
  return 'En espera…'
}

async function guardar(id, texto) {
  const res = await fetch('/api/transcripcion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, texto }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
  return data.transcripcion
}

export default function TranscribirNota({ src, mensajeId, transcripcion = '' }) {
  const [propia, setPropia] = useState('')
  const [estado, setEstado] = useState(null)
  const [aviso, setAviso] = useState('')
  const texto = transcripcion || propia

  async function transcribir() {
    setAviso('')
    setEstado({ fase: 'cola' })
    try {
      const resultado = (await transcribirNota(src, setEstado)).trim()
      if (!resultado) {
        setAviso('No se entendió nada en este audio.')
        return
      }
      setPropia(resultado)
      try {
        setPropia(await guardar(mensajeId, resultado))
      } catch (err) {
        // El texto ya está: se muestra igual, pero se dice que no quedó para los demás.
        console.error('[transcripcion] no se guardó', err)
        setAviso('No se pudo guardar: los demás no verán este texto.')
      }
    } catch (err) {
      console.error('[transcripcion]', err)
      setAviso(err.message || 'No se pudo transcribir.')
    } finally {
      setEstado(null)
    }
  }

  const avisoEl = aviso && (
    <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 4 }}>{aviso}</div>
  )

  if (texto) return (
    <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,.05)', borderLeft: '2px solid #25d366' }}>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>📝 Transcripción automática, puede tener errores</div>
      <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{texto}</div>
      {avisoEl}
    </div>
  )

  if (estado) return (
    <div role="status" style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>⏳ {textoEstado(estado)}</div>
  )

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" onClick={transcribir} style={{
        background: 'rgba(37,211,102,.1)', border: '1px solid rgba(37,211,102,.25)', borderRadius: 8,
        color: '#25d366', cursor: 'pointer', fontSize: 12, fontWeight: 600, minHeight: 32, padding: '4px 12px',
      }}>
        📝 {aviso ? 'Reintentar' : 'Transcribir'}
      </button>
      {avisoEl}
    </div>
  )
}
