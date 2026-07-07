'use client'
import { useEffect } from 'react'

// Registra el service worker para que el navegador ofrezca "Instalar app".
export default function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
