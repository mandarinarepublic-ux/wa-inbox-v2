'use client'
import React, { useEffect, useRef } from 'react'
import { urlPedidoManual, leerAvisoPedido } from '@/lib/pedido-manual'
import MarcoCRM from './MarcoCRM'

// El formulario de pedidos del CRM, dentro del panel derecho.
//
// El armazón —el iframe escalado, su envoltorio y la cabecera con la ✕— vive en
// `MarcoCRM` y lo comparte con VER PEDIDO. Acá queda SOLO lo propio de crear un
// pedido: escuchar el aviso de "pedido creado" que manda el CRM. (Mirar un
// pedido no crea nada, así que esa vista no escucha nada.)
//
// ⚠️ La URL se congela al montar. Eso pasa dentro de `MarcoCRM` y depende de que
// `RightPanel` desmonte esto al cambiar de teléfono: está explicado ahí con ☠️,
// léelo antes de tocar cualquiera de los dos.
export default function PedidoManual({ telefono, nombre, onCreado, onCerrar }) {
  // `onCreado` cambia en cada render del padre; sin la ref, el efecto se
  // volvería a suscribir todo el tiempo y podríamos perder el aviso.
  const alCrear = useRef(onCreado)
  useEffect(() => { alCrear.current = onCreado }, [onCreado])

  const iframeRef = useRef(null)

  useEffect(() => {
    function alMensaje(e) {
      // Solo el iframe de ESTE componente. En el celular el panel de escritorio
      // sigue MONTADO (solo lo esconde el CSS), así que puede haber dos paneles
      // con el formulario abierto a la vez: sin esta comprobación, un solo aviso
      // del CRM lo escucharían los dos y la nota y la marca de venta se harían
      // por duplicado. De paso endurece la validación de `leerAvisoPedido`: ya no
      // alcanza con venir del CRM, tiene que venir de NUESTRO iframe.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const aviso = leerAvisoPedido(e)
      if (aviso) alCrear.current?.(aviso)
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [])

  return (
    <MarcoCRM
      titulo="🧾 PEDIDO MANUAL"
      src={urlPedidoManual(telefono, nombre)}
      tituloIframe="Nuevo pedido"
      onCerrar={onCerrar}
      iframeRef={iframeRef}
      /* Cuál es la señal de que salió bien. Si el CRM guarda el pedido pero su
         aviso no llega hasta acá, el inbox no deja la nota ni marca la venta y
         NO hay forma de enterarse desde este lado: lo único que lo delata es
         que el panel siga abierto. Decirlo de frente es lo más barato que
         podemos hacer para que no pase de largo. */
      aviso={<>Al guardar, este panel se cierra solo y queda la nota en el chat. Si no se cierra,
        revisa el pedido en el CRM y avisa.</>}
    />
  )
}
