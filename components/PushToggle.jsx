'use client'
import { useEffect, useState } from 'react'

// La clave pública VAPID viaja al navegador como base64url y hay que convertirla
// al Uint8Array que espera pushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

export default function PushToggle() {
  const [estado, setEstado] = useState('cargando') // cargando|no-soportado|off|on|trabajando
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
        if (vivo) setEstado('no-soportado')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (vivo) setEstado(sub ? 'on' : 'off')
      } catch (e) {
        if (vivo) setEstado('off')
      }
    })()
    return () => { vivo = false }
  }, [])

  // El aviso se va solo a los 8 s. Los errores se quedan igual que los éxitos: si
  // algo falló en el celular, tiene que verse en el celular el tiempo suficiente
  // para leerlo. Tocarlo lo cierra antes.
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 8000)
    return () => clearTimeout(t)
  }, [msg])

  // Todo camino termina en un mensaje VISIBLE. Antes el único lugar donde se
  // mostraba algo era `title=`, que es un tooltip de hover: en un celular no
  // existe. Por eso el botón podía fallar y no decir absolutamente nada — y por
  // eso el Android de Rodrigo nunca llegó a suscribirse.
  const avisar = (texto, ok) => { setMsg(texto); setMsgOk(ok) }

  const activar = async () => {
    avisar('', true)
    setEstado('trabajando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado('off')
        avisar('No diste permiso. Actívalo en Ajustes → Notificaciones de esta app.', false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      })
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {})
        setEstado('off')
        avisar(r.status === 401
          ? 'Tu sesión se venció. Vuelve a entrar y toca de nuevo.'
          : `No se pudo registrar (error ${r.status}).`, false)
        return
      }
      setEstado('on')
      avisar('✅ Avisos activados en este aparato.', true)
    } catch (e) {
      setEstado('off')
      avisar('No se pudo activar: ' + (e?.message || 'error desconocido'), false)
    }
  }

  const desactivar = async () => {
    setEstado('trabajando')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setEstado('off')
      avisar('Avisos apagados en este aparato.', true)
    } catch (e) {
      setEstado('on')
      avisar('No se pudo apagar: ' + (e?.message || 'error desconocido'), false)
    }
  }

  if (estado === 'no-soportado') return null

  const on = estado === 'on'
  const ocupado = estado === 'trabajando' || estado === 'cargando'

  return (
    <>
      <button
        onClick={on ? desactivar : activar}
        disabled={ocupado}
        aria-label={on ? 'Apagar avisos' : 'Activar avisos de mensajes nuevos'}
        style={{
          background: on ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.12)',
          border: `1px solid ${on ? 'rgba(16,185,129,.45)' : 'rgba(148,163,184,.3)'}`,
          color: on ? '#10b981' : '#94a3b8',
          borderRadius: 8, width: 28, height: 28,
          cursor: ocupado ? 'default' : 'pointer',
          fontSize: 13, opacity: ocupado ? .5 : 1,
          // Al tacto el blanco de 28px es muy chico. `touch-action` no basta: se
          // agranda el área real solo en punteros gruesos, sin descuadrar la fila
          // de botones del encabezado en escritorio.
          ...(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
            ? { width: 44, height: 44, fontSize: 18 }
            : null),
        }}
      >
        {on ? '🔔' : '🔕'}
      </button>

      {msg ? (
        <div
          role="status"
          onClick={() => setMsg('')}
          style={{
            position: 'fixed', left: 12, right: 12, bottom: 16, zIndex: 9999,
            padding: '12px 16px', borderRadius: 12, textAlign: 'center',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: msgOk ? 'rgba(16,185,129,.96)' : 'rgba(239,68,68,.96)',
            color: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.45)',
          }}
        >
          {msg}
        </div>
      ) : null}
    </>
  )
}
