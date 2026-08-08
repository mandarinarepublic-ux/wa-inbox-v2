'use client'
import React, { useEffect, useRef } from 'react'
import { urlPedidoManual, leerAvisoPedido } from '@/lib/pedido-manual'

// El formulario de pedidos del CRM, dentro del panel derecho.
//
// La sesión viaja sola: la cookie `mp_sesion` es de `.apps.mandarinaec.com` y el
// CRM es un subdominio de ahí, así que el iframe entra autenticado sin que
// tengamos que pasarle nada. Si la sesión venció, el CRM muestra su propio login
// DENTRO del panel en vez de expulsarte del inbox.
export default function PedidoManual({ telefono, nombre, onCreado, onCerrar }) {
  // `onCreado` cambia en cada render del padre; sin la ref, el efecto se
  // volvería a suscribir todo el tiempo y podríamos perder el aviso.
  const alCrear = useRef(onCreado)
  useEffect(() => { alCrear.current = onCreado }, [onCreado])

  useEffect(() => {
    function alMensaje(e) {
      const aviso = leerAvisoPedido(e)
      if (aviso) alCrear.current?.(aviso)
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div style={{
        flexShrink:0, padding:'8px 10px', background:'#0a0f1a',
        borderBottom:'1px solid #111c2a', display:'flex',
        alignItems:'center', justifyContent:'space-between', gap:8,
      }}>
        <span style={{ fontSize:12, fontWeight:800, color:'#e2e8f0', letterSpacing:'.03em' }}>
          🧾 PEDIDO MANUAL
        </span>
        <button onClick={onCerrar} style={{
          background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8',
          borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:700,
          cursor:'pointer', fontFamily:'inherit',
        }}>✕ Cerrar</button>
      </div>
      <iframe
        src={urlPedidoManual(telefono, nombre)}
        title="Nuevo pedido"
        style={{ flex:1, width:'100%', border:'none', background:'#0a0f1a', minHeight:0 }}
      />
    </div>
  )
}
