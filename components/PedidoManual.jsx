'use client'
import React, { useEffect, useRef, useState } from 'react'
import { urlPedidoManual, leerAvisoPedido, ESCALA_PEDIDO } from '@/lib/pedido-manual'

// Cuánto se encoge el formulario del CRM para que entre entero en el panel.
// Es la única perilla del zoom: subirlo agranda la letra y baja lo que entra,
// bajarlo al revés. La compensación de ancho y alto se deriva sola de acá
// (`100 / ESCALA`), así que este número se cambia solo y no hay que tocar nada más.
//
// 0.70 lo pidió Rodrigo el 8-ago tras probarlo: con 0.80 la barra de SIGUIENTE
// —la que hace avanzar los 4 pasos del asistente— no le quedaba a la vista.
//
// ⚠️ Vive en `lib/pedido-manual.js` y no acá porque el ANCHO del panel se deriva
// de él: el CRM cambia a diseño de celular por debajo de 768 px internos, y esos
// internos son `ancho del panel ÷ ESCALA`. Cambiar la escala mueve el ancho solo.
const ESCALA = ESCALA_PEDIDO

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

  // ⚠️ La URL se congela AL ABRIR y no se vuelve a calcular. Si se derivara en
  // cada render, cualquier cambio de `nombre` reescribiría el `src` y el iframe
  // navegaría de cero, perdiendo todo lo escrito. Y `nombre` cambia solo: sale
  // de `contactInfo.alias`, y el lápiz ✏️ que edita el alias está en la cabecera
  // del panel, a la vista con el formulario abierto — además de que un sondeo
  // puede traer un alias nuevo. El inicializador perezoso de useState corre una
  // sola vez; al cerrar y volver a abrir, el componente se monta de nuevo y la
  // URL se arma otra vez con los datos frescos.
  //
  // ☠️ NO BORRES el efecto de RightPanel.jsx que hace `setManualAbierto(false)`
  // cuando cambia `activeConv?.telefono`. Parece redundante ahora que el iframe
  // sobrevive al cambio de pestaña — NO LO ES: ese efecto es lo ÚNICO que fuerza
  // el desmontaje al cambiar de cliente, y sin desmontaje este `useState` no se
  // vuelve a inicializar. O sea que la URL se quedaría con el teléfono del
  // cliente ANTERIOR y el siguiente pedido saldría a nombre equivocado, con los
  // datos de otra persona y sin ningún error a la vista.
  //
  // Si algún día hace falta quitarlo, hay que reemplazarlo por otra cosa que
  // garantice el remontaje —por ejemplo un `key={telefono}` en este componente—
  // antes de tocarlo, no después.
  const [src] = useState(() => urlPedidoManual(telefono, nombre))

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
      {/* Cuál es la señal de que salió bien. Si el CRM guarda el pedido pero su
          aviso no llega hasta acá, el inbox no deja la nota ni marca la venta y
          NO hay forma de enterarse desde este lado: lo único que lo delata es
          que el panel siga abierto. Decirlo de frente es lo más barato que
          podemos hacer para que no pase de largo. */}
      <div style={{
        flexShrink:0, padding:'5px 10px', background:'#0a0f1a',
        borderBottom:'1px solid #111c2a', fontSize:10, color:'#64748b', lineHeight:1.35,
      }}>
        Al guardar, este panel se cierra solo y queda la nota en el chat. Si no se cierra,
        revisa el pedido en el CRM y avisa.
      </div>
      {/* El asistente del CRM está pensado para pantalla completa y en el panel
          va justo. Se dibuja al ESCALA (hoy 70%) para que entre entero.

          Por qué `transform: scale()` y no `zoom`: con `zoom` habría que
          adivinar cómo resuelve cada motor los porcentajes de un hijo zoomeado
          —cambió al estandarizarse y no es igual en todos—, y una franja blanca
          o una barra de más aparecería recién en producción. Acá la cuenta la
          controlo yo: el iframe se hace 1/ESCALA de grande (hoy 143%) y se encoge a
          ESCALA, así que ocupa exactamente el 100% del hueco, sin franjas ni
          barras de sobra, y por dentro el CRM cree tener un 43% más de sitio.
          El `overflow:hidden` del envoltorio se come el redondeo de subpíxel. */}
      <div style={{ flex:1, minHeight:0, position:'relative', overflow:'hidden', background:'#0a0f1a' }}>
        <iframe
          ref={iframeRef}
          src={src}
          title="Nuevo pedido"
          style={{
            position:'absolute', top:0, left:0,
            width:`${100 / ESCALA}%`, height:`${100 / ESCALA}%`,
            transform:`scale(${ESCALA})`, transformOrigin:'top left',
            border:'none', background:'#0a0f1a',
          }}
        />
      </div>
    </div>
  )
}
