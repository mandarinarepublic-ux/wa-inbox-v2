'use client'
import { useState } from 'react'
import { ESCALA_PEDIDO } from '@/lib/pedido-manual'

// El armazón compartido para meter una pantalla del CRM dentro del panel
// derecho: la cabecera con su ✕, el iframe escalado y el envoltorio que le
// recorta el sobrante. Lo usan PEDIDO MANUAL (crear) y VER PEDIDO (mirar).
//
// ⚠️ ES UN SOLO ARMAZÓN A PROPÓSITO. La tentación de copiar este archivo para
// la vista nueva era grande y sería un error conocido en este repo: copiar en
// vez de compartir ya nos costó el bug de las fotos saliendo por el número
// equivocado (ver `lib/responder-ia.js`). Si mañana hace falta una tercera
// pantalla del CRM embebida, se le pasan props a este componente; no se
// duplica.
//
// La sesión viaja sola: la cookie `mp_sesion` es de `.apps.mandarinaec.com` y
// el CRM es un subdominio de ahí, así que el iframe entra autenticado sin que
// tengamos que pasarle nada. Si la sesión venció, el CRM muestra su propio
// login DENTRO del panel en vez de expulsarte del inbox.

// Cuánto se encoge la pantalla del CRM para que entre entera en el panel.
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

/**
 * @param titulo       Lo que dice la cabecera, p.ej. '🧾 PEDIDO MANUAL'.
 * @param src          La URL del CRM. ⚠️ SE LEE UNA SOLA VEZ, al montar (ver abajo).
 * @param tituloIframe El `title` del iframe (accesibilidad).
 * @param onCerrar     Qué hace la ✕.
 * @param iframeRef    Opcional: para que quien escuche `postMessage` pueda
 *                     comprobar que el aviso vino de ESTE iframe y no de otro.
 * @param aviso        Opcional: una franja de texto entre la cabecera y el iframe.
 */
export default function MarcoCRM({ titulo, src, tituloIframe, onCerrar, iframeRef, aviso }) {
  // ⚠️ La URL se congela AL MONTAR y no se vuelve a leer. Si se siguiera al
  // prop en cada render, cualquier cambio en los datos del chat reescribiría el
  // `src` y el iframe navegaría de cero, perdiendo todo lo escrito. Y esos datos
  // cambian solos: el nombre sale de `contactInfo.alias`, el lápiz ✏️ que lo
  // edita está en la cabecera del panel, y además un sondeo puede traer un alias
  // nuevo sin que nadie toque nada. El inicializador perezoso de useState corre
  // una sola vez.
  //
  // ☠️ Por eso mismo, para mostrar OTRA url hay que MONTAR de nuevo el
  // componente (un `key` distinto, o cerrar y volver a abrir). Cambiarle el prop
  // no hace nada, y no hacer nada es lo correcto acá: es la garantía de que un
  // repintado no te tira el formulario a medio llenar.
  //
  // ☠️ NO BORRES los efectos de `RightPanel.jsx` que cierran esto cuando cambia
  // `activeConv?.telefono`. Parecen redundantes ahora que el iframe sobrevive al
  // cambio de pestaña — NO LO SON: son lo ÚNICO que fuerza el desmontaje al
  // cambiar de cliente, y sin desmontaje este `useState` no se vuelve a
  // inicializar. O sea que la URL se quedaría con el teléfono del cliente
  // ANTERIOR y el siguiente pedido saldría a nombre equivocado, con los datos de
  // otra persona y sin ningún error a la vista.
  //
  // Si algún día hace falta quitarlos, hay que reemplazarlos por otra cosa que
  // garantice el remontaje —por ejemplo un `key={telefono}`— antes de tocarlos,
  // no después.
  const [srcCongelado] = useState(() => src)

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div style={{
        flexShrink:0, padding:'8px 10px', background:'#0a0f1a',
        borderBottom:'1px solid #111c2a', display:'flex',
        alignItems:'center', justifyContent:'space-between', gap:8,
      }}>
        <span style={{ fontSize:12, fontWeight:800, color:'#e2e8f0', letterSpacing:'.03em' }}>
          {titulo}
        </span>
        {/* En rojo a pedido de Rodrigo: en gris se le perdía de vista contra la
            cabecera oscura, y es el único camino de salida de estas dos vistas.
            Al vivir acá, vale para PEDIDO MANUAL y para VER PEDIDO de una vez. */}
        <button onClick={onCerrar} style={{
          background:'rgba(248,113,113,.15)', border:'1px solid rgba(248,113,113,.5)', color:'#f87171',
          borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:800,
          cursor:'pointer', fontFamily:'inherit',
        }}>✕ Cerrar</button>
      </div>
      {aviso && (
        <div style={{
          flexShrink:0, padding:'5px 10px', background:'#0a0f1a',
          borderBottom:'1px solid #111c2a', fontSize:10, color:'#64748b', lineHeight:1.35,
        }}>
          {aviso}
        </div>
      )}
      {/* Las pantallas del CRM están pensadas para pantalla completa y en el
          panel van justas. Se dibujan al ESCALA (hoy 70%) para que entren enteras.

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
          src={srcCongelado}
          title={tituloIframe}
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
