// lib/subir-adjunto.js — Subir UN archivo (foto, audio o documento) a nuestro
// bucket y devolver { tipo, url, nombre } listo para guardarlo como adjunto.
//
// Lo usa el lienzo de FLUJOS (nodo Mensaje → «📎 Subir archivo»). Antes ahí solo
// se podía pegar una URL. Misma regla que el editor de respuestas rápidas
// (RightPanel → MultiImgEditor), para que un adjunto suba igual en los dos lados:
//   - audio → se convierte a nota de voz (OGG/Opus) UNA vez, al subirlo;
//   - documento → todo lo que no es foto, video ni audio (lib/adjuntos.js), con su
//     nombre, que es lo que ve el cliente en WhatsApp;
//   - foto → JPG y a /api/upload-foto.
// Solo navegador (usa canvas y FormData).
import { subirAudioNota, subirDocumento } from './api-client'
import { esDocumento } from './adjuntos'
import { esAudio } from './audio-nota-voz'

async function aJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => (blob ? resolve(new File([blob], 'imagen.jpg', { type: 'image/jpeg' })) : reject(new Error('no se pudo convertir la foto'))), 'image/jpeg', 0.92)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('el archivo no es una imagen válida')) }
    img.src = url
  })
}

async function subirFoto(file) {
  const jpg = await aJpeg(file)
  const fd = new FormData()
  fd.append('file', jpg, jpg.name || 'imagen.jpg')
  const res = await fetch('/api/upload-foto', { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error || `No se pudo subir la foto (HTTP ${res.status})`)
  return data.url
}

/** Sube el archivo y devuelve { tipo, url, nombre }. Lanza con un mensaje legible. */
export async function subirAdjunto(file) {
  if (!file) throw new Error('no llegó ningún archivo')
  if (esAudio(file)) {
    const url = await subirAudioNota(file)
    if (!url) throw new Error('No se pudo subir el audio')
    return { tipo: 'audio', url, nombre: '' }
  }
  if (esDocumento(file)) {
    const sub = await subirDocumento(file)
    if (!sub?.url) throw new Error('No se pudo subir el documento')
    return { tipo: 'documento', url: sub.url, nombre: sub.nombre || file.name || 'documento' }
  }
  if (String(file.type || '').startsWith('video/')) {
    // El adjunto de un flujo solo sabe de imagen, audio y documento.
    throw new Error('los videos no se pueden adjuntar acá todavía')
  }
  return { tipo: 'imagen', url: await subirFoto(file), nombre: '' }
}
