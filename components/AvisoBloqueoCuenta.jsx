'use client'
import { useEffect, useState } from 'react'

const CADA_MS = 60_000

// Banner rojo cuando Meta frenó todos los envíos (lib/bloqueo-cuenta.js). Es fixed,
// como AvisoSesion, y no captura toques: el vendedor sigue pudiendo usar lo de abajo.
export default function AvisoBloqueoCuenta() {
  const [bloqueo, setBloqueo] = useState(null)

  useEffect(() => {
    let vivo = true
    const preguntar = async () => {
      if (document.hidden) return
      try {
        const res = await fetch('/api/estado-envios', { cache: 'no-store' })
        if (!res.ok) return // Si no se pudo saber, se deja lo último que se supo.
        const d = await res.json()
        if (vivo) setBloqueo(d.bloqueo || null)
      } catch { /* sin red: se vuelve a preguntar en un minuto */ }
    }
    preguntar()
    const id = setInterval(preguntar, CADA_MS)
    document.addEventListener('visibilitychange', preguntar)
    return () => {
      vivo = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', preguntar)
    }
  }, [])

  if (!bloqueo) return null
  return (
    <div role="alert" style={{
      position:'fixed', top:0, left:0, right:0, zIndex:10000, pointerEvents:'none',
      background:'#b91c1c', color:'#fff', padding:'6px 12px', textAlign:'center',
      fontSize:13, fontWeight:600, lineHeight:1.3, fontFamily:'Outfit,sans-serif',
    }}>
      🛑 NO está saliendo ningún mensaje: no le llegan a los clientes. {bloqueo.motivo}
    </div>
  )
}
