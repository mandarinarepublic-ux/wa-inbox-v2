'use client'
import React, { useState, useRef, useEffect } from 'react'
import { urlVerPedido, leerHojaPedido } from '@/lib/pedido-manual'
import MarcoCRM from './MarcoCRM'

// Un pedido del CRM, para MIRARLO dentro del panel derecho. Antes el "Ver →"
// del historial abría una pestaña nueva y te sacaba del chat.
//
// Comparte el armazón con PEDIDO MANUAL (`MarcoCRM`): el iframe escalado, su
// envoltorio y la cabecera con la ✕ son los mismos. Lo que NO comparte:
//
//  · NO pasa por el guard que pregunta antes de descartar. Mirar un pedido no
//    escribe nada, y preguntar "¿lo descartas?" al cerrar algo que solo estabas
//    leyendo es ruido puro — y un aviso que molesta de gusto se aprende a
//    ignorar, que es justo como se pierde el que sí importa. En `RightPanel`
//    esto entra por `onVerPedido`, un camino aparte de `onPedidoManual`.
//    ⚠️ Mandar la hoja NO cambia esto: se manda con un clic y se termina; no
//    queda nada a medio llenar que se pueda perder al cerrar.
//
// Lo que sí comparte además del armazón: congela la url al montar (por la misma
// razón, un repintado no puede navegar el iframe) y ensancha el panel al abrir,
// porque el pedido del CRM no se lee en 340 px.
//
// ── ENVIARLE LA HOJA AL CLIENTE ─────────────────────────────────────────────
// El botón «📤 Enviar al cliente» NO está acá: vive DENTRO de la pantalla del
// pedido, o sea del otro lado del iframe. El CRM dibuja la hoja como JPG y nos
// la pasa por `postMessage`; nosotros la recibimos, la validamos y la mandamos
// al chat como una foto más. Por qué se valida tanto un `postMessage` está
// explicado con ⚠️ en `leerHojaPedido` — resumen: llega de OTRO dominio y
// `window` recibe mensajes de cualquiera.
export default function VerPedido({ pedidoId, onCerrar, onEnviarHoja }) {
  // La ref del iframe la expone `MarcoCRM` justo para esto: comprobar que el
  // aviso vino de ESTE iframe. En el celular el panel de escritorio sigue
  // MONTADO (solo lo esconde el CSS), así que puede haber dos vistas del mismo
  // pedido a la vez: sin esta comprobación las dos escucharían el único aviso
  // del CRM y el cliente recibiría la hoja DOS VECES.
  const iframeRef = useRef(null)

  // null | { estado:'enviando' } | { estado:'ok' } | { estado:'error', msg }
  const [envio, setEnvio] = useState(null)

  // El candado del doble disparo. Va en una ref y no en el estado porque se
  // consulta dentro del listener, que se suscribe una sola vez: un `envio` leído
  // del estado ahí adentro estaría siempre congelado en su valor inicial.
  const enviandoRef = useRef(false)

  // `onEnviarHoja` cambia en cada render del padre; sin la ref, el efecto se
  // volvería a suscribir todo el tiempo y podríamos perder el aviso.
  const alEnviar = useRef(onEnviarHoja)
  useEffect(() => { alEnviar.current = onEnviarHoja }, [onEnviarHoja])

  // El envío tarda; si mientras tanto se cierra la vista, no hay que tocar el
  // estado de un componente desmontado.
  const vivoRef = useRef(true)
  useEffect(() => () => { vivoRef.current = false }, [])

  useEffect(() => {
    async function alMensaje(e) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const hoja = leerHojaPedido(e)
      if (!hoja) return
      // La hoja tiene que ser la del pedido que estamos mirando. Es el mismo
      // iframe, así que hoy no puede ser otra; pero mandarle al cliente la hoja
      // de un pedido ajeno es un error que no se puede deshacer, y comprobarlo
      // es gratis.
      if (String(hoja.pedidoId) !== String(pedidoId)) return
      // Doble clic o dos avisos seguidos: la hoja se manda UNA vez. Al cliente
      // le llegarían dos fotos iguales y ni siquiera se notaría desde acá.
      if (enviandoRef.current) return
      enviandoRef.current = true
      setEnvio({ estado: 'enviando' })
      try {
        const r = await alEnviar.current?.(hoja)
        if (!vivoRef.current) return
        // ⚠️ Sin `r` no se canta victoria. Un fallo mudo es peor que un error:
        // el vendedor sigue la conversación creyendo que el cliente ya tiene la
        // hoja en el celular.
        setEnvio(r?.ok
          ? { estado: 'ok' }
          : { estado: 'error', msg: r?.error || 'No se pudo enviar la hoja' })
      } catch (err) {
        if (vivoRef.current) setEnvio({ estado: 'error', msg: err?.message || 'No se pudo enviar la hoja' })
      } finally {
        enviandoRef.current = false
      }
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [pedidoId])

  return (
    <MarcoCRM
      titulo={`📄 PEDIDO ${pedidoId}`}
      src={urlVerPedido(pedidoId)}
      tituloIframe={`Pedido ${pedidoId}`}
      onCerrar={onCerrar}
      iframeRef={iframeRef}
      aviso={
        envio?.estado === 'enviando' ? (
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>⏳ Enviando la hoja al cliente…</span>
        ) : envio?.estado === 'ok' ? (
          <span style={{ color: '#25d366', fontWeight: 700 }}>✅ Hoja enviada al chat.</span>
        ) : envio?.estado === 'error' ? (
          <span style={{ color: '#f87171', fontWeight: 700 }}>❌ NO se envió: {envio.msg}. El cliente no la recibió.</span>
        ) : (
          <>Solo lectura. Para cambiar algo, edítalo en el CRM. Con «📤 Enviar al cliente» la hoja
            le llega como foto a este chat.</>
        )
      }
    />
  )
}
