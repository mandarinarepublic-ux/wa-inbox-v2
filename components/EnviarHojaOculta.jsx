'use client'
import { useEffect, useRef } from 'react'
import { urlEnviarHoja, leerHojaPedido, leerHojaFallida } from '@/lib/pedido-manual'

// El botón «📤 Enviar» del HISTORIAL DE PEDIDOS: manda la hoja del pedido al
// cliente sin abrir VER PEDIDO.
//
// La hoja la sigue dibujando el CRM (es su diseño, el mismo del PDF): acá se abre
// la pantalla del pedido en un iframe ESCONDIDO con `?autoenviar=1`, el CRM arma
// la hoja al terminar de cargar y nos la pasa por postMessage, igual que con el
// botón de adentro. De ahí en adelante es el MISMO camino que VerPedido
// (`onEnviarHoja` → la foto al chat), con las mismas validaciones.
//
// Escondido pero con tamaño real (no display:none): html2canvas necesita que la
// pantalla del CRM se haya pintado para poder capturar la hoja.
//
// `onListo({ ok, error? })` se llama UNA vez: al mandar, al fallar o al vencer el
// tiempo. El padre desmonta este componente al recibirlo.
const TOPE_MS = 45000

export default function EnviarHojaOculta({ pedidoId, onEnviarHoja, onListo }) {
  const iframeRef = useRef(null)
  const terminadoRef = useRef(false)
  const alEnviar = useRef(onEnviarHoja)
  const alListo = useRef(onListo)
  useEffect(() => { alEnviar.current = onEnviarHoja; alListo.current = onListo }, [onEnviarHoja, onListo])

  useEffect(() => {
    terminadoRef.current = false
    const terminar = (r) => {
      if (terminadoRef.current) return
      terminadoRef.current = true
      alListo.current?.(r)
    }
    async function alMensaje(e) {
      // Solo de ESTE iframe: en el celular el panel de escritorio sigue montado y
      // podría haber dos (ver el ⚠️ de VerPedido): la hoja saldría dos veces.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const fallo = leerHojaFallida(e)
      if (fallo && fallo.pedidoId === String(pedidoId)) return terminar({ ok: false, error: fallo.motivo })
      const hoja = leerHojaPedido(e)
      if (!hoja || hoja.pedidoId !== String(pedidoId) || terminadoRef.current) return
      terminadoRef.current = true   // candado ANTES del await: un segundo aviso no manda otra foto
      try {
        const r = await alEnviar.current?.(hoja)
        alListo.current?.(r?.ok ? { ok: true } : { ok: false, error: r?.error || 'No se pudo enviar la hoja' })
      } catch (err) {
        alListo.current?.({ ok: false, error: err?.message || 'No se pudo enviar la hoja' })
      }
    }
    window.addEventListener('message', alMensaje)
    // Sesión del CRM vencida, pedido que no carga, CRM caído: nada responde. Sin
    // tope el botón se quedaría en "Enviando…" para siempre.
    const t = setTimeout(() => terminar({ ok: false, error: 'el CRM no respondió (¿sesión vencida?). Ábrelo con «Ver →» y envíalo desde adentro' }), TOPE_MS)
    return () => { window.removeEventListener('message', alMensaje); clearTimeout(t) }
  }, [pedidoId])

  return (
    <iframe
      ref={iframeRef}
      src={urlEnviarHoja(pedidoId)}
      title={`Enviando la hoja del pedido ${pedidoId}`}
      aria-hidden="true"
      tabIndex={-1}
      style={{ position: 'fixed', left: -10000, top: 0, width: 900, height: 1200, border: 0, opacity: 0, pointerEvents: 'none' }}
    />
  )
}
