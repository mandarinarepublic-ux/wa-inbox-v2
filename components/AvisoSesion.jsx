'use client'
import React, { useEffect, useState } from 'react'
import { vigilarSesion, alCaerLaSesion } from '@/lib/sesion-caida'

// La barra que aparece cuando la sesión se cayó.
//
// A propósito NO manda al login sola: si te saca en medio de un mensaje largo o
// de una foto a medio subir, pierdes el trabajo. Avisa, se queda fija arriba, y
// tú decides cuándo salir. El botón lleva al login del CRM con `volver`, así que
// después de entrar caes de vuelta en esta misma pantalla.
//
// Nace de lo del 7-ago-2026: tres salientes con 401 que solo mostraron
// "no se pudo enviar". El aviso importa MÁS por ser raro que por ser frecuente:
// la sesión dura 30 días, así que cuando pase nadie va a acordarse del síntoma.
const LOGIN = 'https://crm.apps.mandarinaec.com'

export default function AvisoSesion() {
  const [caida, setCaida] = useState(false)

  useEffect(() => {
    vigilarSesion()
    return alCaerLaSesion(() => setCaida(true))
  }, [])

  if (!caida) return null

  const volver = () => {
    const destino = `${window.location.origin}${window.location.pathname}${window.location.search}`
    window.location.href = `${LOGIN}/?volver=${encodeURIComponent(destino)}`
  }

  return (
    <div role="alert" style={{
      position:'fixed', top:0, left:0, right:0, zIndex:9999,
      background:'#7f1d1d', borderBottom:'1px solid #b91c1c',
      color:'#fee2e2', padding:'10px 14px',
      display:'flex', alignItems:'center', gap:12, flexWrap:'wrap',
      fontFamily:"'Outfit',sans-serif", fontSize:13,
      // El teléfono tiene la barra de pestañas arriba; el aviso va por encima.
      paddingTop:'calc(10px + env(safe-area-inset-top))',
    }}>
      <span style={{ fontSize:16 }}>⚠️</span>
      <span style={{ flex:1, minWidth:180, lineHeight:1.4 }}>
        <strong>Tu sesión terminó.</strong>{' '}
        Lo que escribas <strong>no se está enviando</strong>. Vuelve a entrar y
        sigues donde estabas.
      </span>
      <button onClick={volver} style={{
        background:'#25d366', color:'#04220f', border:'none', borderRadius:6,
        padding:'7px 14px', fontWeight:700, fontSize:13, cursor:'pointer',
        fontFamily:"'Outfit',sans-serif", flexShrink:0,
      }}>Volver a entrar</button>
    </div>
  )
}
