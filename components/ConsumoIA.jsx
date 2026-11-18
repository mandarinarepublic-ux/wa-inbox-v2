'use client'
import { useState, useEffect, useCallback } from 'react'
import { tokensLegibles, dolaresLegibles } from '@/lib/costo-ia'

// 💰 Gasto de tokens de la IA (MANDI) — pestaña VENTAS (17-nov-2026).
// Sale de inbox.ia_consumo; el costo es ESTIMADO (lib/costo-ia.js), la factura real
// está en la consola de Anthropic.
// Regla de Rodrigo: si la IA no gastó nada en ESTE chat, el bloque NO se muestra.
// Es una sola línea con el gasto del chat; al tocarla se ve el total del mes.
export default function ConsumoIA({ telefono }) {
  const [datos, setDatos] = useState(null)
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => {
    if (!telefono) return
    try {
      const r = await fetch(`/api/ia-consumo?phone=${encodeURIComponent(telefono)}&t=${Date.now()}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      // Un fallo de lectura no pinta nada: este bloque es informativo y no debe
      // ensuciar la pestaña de ventas.
      if (r.ok && d?.ok) setDatos(d)
    } catch {}
  }, [telefono])

  useEffect(() => { setDatos(null); setAbierto(false); cargar() }, [cargar])
  // Se refresca cada minuto mientras el chat está abierto: la IA puede estar respondiendo.
  useEffect(() => {
    const id = setInterval(cargar, 60000)
    return () => clearInterval(id)
  }, [cargar])

  const chat = datos?.chat
  if (!chat || !(Number(chat.respuestas) > 0)) return null
  const mes = datos.mes

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid #111c2a', marginTop: 8, background: '#0a1019' }}>
      <button onClick={() => setAbierto(a => !a)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, letterSpacing: '.08em' }}>
          {abierto ? '▾' : '▸'} 🤖 IA
        </span>
        <span style={{ fontSize: 11, color: '#cbd5e1', whiteSpace: 'nowrap' }}>
          {chat.respuestas} resp. · {tokensLegibles(chat.tokens)} tokens · <b style={{ color: '#f59e0b' }}>{dolaresLegibles(chat.costo)}</b>
        </span>
      </button>
      {abierto && mes && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
          Este mes (todos los chats): {mes.chats} chat{mes.chats === 1 ? '' : 's'} · {mes.respuestas} resp. · {tokensLegibles(mes.tokens)} tokens · <b style={{ color: '#f59e0b' }}>{dolaresLegibles(mes.costo)}</b>
          <div style={{ fontSize: 9.5, color: '#475569', marginTop: 4 }}>Estimado. La factura real está en la consola de Anthropic.</div>
        </div>
      )}
    </div>
  )
}
