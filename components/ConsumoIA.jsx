'use client'
import { useState, useEffect, useCallback } from 'react'
import { tokensLegibles, dolaresLegibles } from '@/lib/costo-ia'

// 💰 Gasto de tokens de la IA (MANDI) — pestaña VENTAS (17-nov-2026).
// "Este chat" y "este mes" (todos los chats). Sale de inbox.ia_consumo; el costo es
// ESTIMADO (lib/costo-ia.js), la factura real está en la consola de Anthropic.
export default function ConsumoIA({ telefono }) {
  const [datos, setDatos] = useState(null)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    if (!telefono) return
    try {
      const r = await fetch(`/api/ia-consumo?phone=${encodeURIComponent(telefono)}&t=${Date.now()}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.ok) { setError(d?.error || `HTTP ${r.status}`); return }
      setError(''); setDatos(d)
    } catch (e) { setError(e.message) }
  }, [telefono])

  useEffect(() => { setDatos(null); cargar() }, [cargar])
  // Se refresca cada minuto mientras el chat está abierto: la IA puede estar respondiendo.
  useEffect(() => {
    const id = setInterval(cargar, 60000)
    return () => clearInterval(id)
  }, [cargar])

  const fila = (etiqueta, a, extra) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
      <span>{etiqueta}{extra ? <span style={{ color: '#64748b' }}> · {extra}</span> : null}</span>
      <span style={{ whiteSpace: 'nowrap' }}>
        {a ? <>{tokensLegibles(a.tokens)} tokens · <b style={{ color: '#f59e0b' }}>{dolaresLegibles(a.costo)}</b></> : '…'}
      </span>
    </div>
  )

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #111c2a', marginTop: 8, background: '#0a1019' }}>
      <p style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, letterSpacing: '.08em', margin: 0 }}>
        🤖 GASTO DE IA (TOKENS)
      </p>
      {error
        ? <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>No se pudo leer: {error}</div>
        : <>
            {fila('Este chat', datos?.chat, datos ? `${datos.chat.respuestas} respuesta${datos.chat.respuestas === 1 ? '' : 's'}` : '')}
            {fila('Este mes', datos?.mes, datos ? `${datos.mes.chats} chat${datos.mes.chats === 1 ? '' : 's'} · ${datos.mes.respuestas} resp.` : '')}
            <div style={{ fontSize: 9.5, color: '#475569', marginTop: 4 }}>Estimado. La factura real está en la consola de Anthropic.</div>
          </>}
    </div>
  )
}
