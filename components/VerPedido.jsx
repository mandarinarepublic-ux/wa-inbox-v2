'use client'
import React from 'react'
import { urlVerPedido } from '@/lib/pedido-manual'
import MarcoCRM from './MarcoCRM'

// Un pedido del CRM, para MIRARLO dentro del panel derecho. Antes el "Ver →"
// del historial abría una pestaña nueva y te sacaba del chat.
//
// Comparte el armazón con PEDIDO MANUAL (`MarcoCRM`): el iframe escalado, su
// envoltorio y la cabecera con la ✕ son los mismos. Lo que NO comparte:
//
//  · No escucha el `postMessage` del CRM. Acá no se crea nada, así que no hay
//    ningún aviso que atender.
//  · NO pasa por el guard que pregunta antes de descartar. Mirar un pedido no
//    escribe nada, y preguntar "¿lo descartas?" al cerrar algo que solo estabas
//    leyendo es ruido puro — y un aviso que molesta de gusto se aprende a
//    ignorar, que es justo como se pierde el que sí importa. En `RightPanel`
//    esto entra por `onVerPedido`, un camino aparte de `onPedidoManual`.
//
// Lo que sí comparte además del armazón: congela la url al montar (por la misma
// razón, un repintado no puede navegar el iframe) y ensancha el panel al abrir,
// porque el pedido del CRM no se lee en 340 px.
export default function VerPedido({ pedidoId, onCerrar }) {
  return (
    <MarcoCRM
      titulo={`📄 PEDIDO ${pedidoId}`}
      src={urlVerPedido(pedidoId)}
      tituloIframe={`Pedido ${pedidoId}`}
      onCerrar={onCerrar}
      aviso={<>Solo lectura. Para cambiar algo, edítalo en el CRM.</>}
    />
  )
}
