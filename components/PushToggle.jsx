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

  const activar = async () => {
    setMsg('')
    const clave = window.prompt('Clave para activar los avisos:')
    if (clave === null) return
    setEstado('trabajando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado('off')
        setMsg('Diste "bloquear". Hay que permitirlo desde el candado de la barra de direcciones.')
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
        body: JSON.stringify({ subscription: sub.toJSON(), clave }),
      })
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {})
        setEstado('off')
        setMsg(r.status === 401 ? 'Clave incorrecta.' : 'No se pudo registrar.')
        return
      }
      setEstado('on')
      setMsg('Avisos activados en este aparato.')
    } catch (e) {
      setEstado('off')
      setMsg('No se pudo activar: ' + (e?.message || 'error'))
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
      setMsg('Avisos apagados en este aparato.')
    } catch (e) {
      setEstado('on')
      setMsg('No se pudo apagar.')
    }
  }

  if (estado === 'no-soportado') return null

  const on = estado === 'on'
  const ocupado = estado === 'trabajando' || estado === 'cargando'

  return (
    <button
      onClick={on ? desactivar : activar}
      disabled={ocupado}
      title={msg || (on ? 'Avisos activados — click para apagarlos' : 'Activar avisos de mensajes nuevos')}
      style={{
        background: on ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.12)',
        border: `1px solid ${on ? 'rgba(16,185,129,.45)' : 'rgba(148,163,184,.3)'}`,
        color: on ? '#10b981' : '#94a3b8',
        borderRadius: 8, width: 28, height: 28,
        cursor: ocupado ? 'default' : 'pointer',
        fontSize: 13, opacity: ocupado ? .5 : 1,
      }}
    >
      {on ? '🔔' : '🔕'}
    </button>
  )
}
