// lib/audio-meta.js — nota de voz .ogg (WhatsApp) → .m4a (Instagram / Messenger).
//
// ☠️ Instagram y Messenger NO aceptan audio .ogg/.opus: solo aac, m4a, wav o mp4
// (doc de "Send a message" de Instagram). Las notas de voz del inbox se graban en
// .ogg porque es lo que pide WhatsApp, y una respuesta rápida es UNA sola para los
// dos mundos: cambiar el archivo rompería WhatsApp (18-oct-2026).
//
// Por eso se convierte AL MANDAR por FB/IG, y la copia queda guardada en el bucket
// (audios-meta/<mismo nombre>.m4a): la segunda vez no se convierte nada.
import { spawn } from 'node:child_process'
import { writeFile, readFile, rm, mkdtemp, access, copyFile, chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// El binario viene DENTRO del paquete de la plataforma (@ffmpeg-installer/linux-x64 en
// Vercel): sin script de instalación, que el npm de Vercel bloquea y su caché saltea.
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
const ffmpegPath = ffmpegInstaller.path
import { getSupabase } from './supabase.js'

const BUCKET = 'inbox-media'
const TOPE_BYTES = 25 * 1024 * 1024

/** ¿Hay que convertir este audio para mandarlo por Meta (FB/IG)? */
export function necesitaConversion(url) {
  return /\.(ogg|opus)$/i.test(String(url || '').split('?')[0])
}

/** Ruta de la copia .m4a dentro del bucket, estable para la misma url de origen. */
export function rutaCopiaM4a(url) {
  const limpio = String(url || '').split('?')[0]
  const marca = `/object/public/${BUCKET}/`
  const i = limpio.indexOf(marca)
  // Lo de adentro del bucket (audios/MANDI/uuid.ogg) → audios-meta/audios/MANDI/uuid.m4a.
  // Una url de afuera del bucket se nombra por su final, que basta para no chocar.
  const dentro = i >= 0 ? limpio.slice(i + marca.length) : limpio.replace(/^https?:\/\//, '').replace(/[^\w./-]/g, '_')
  return `audios-meta/${dentro.replace(/\.(ogg|opus)$/i, '')}.m4a`
}

// ☠️ El paquete trae el binario SIN permiso de ejecución y lo arregla con un
// `postinstall: chmod u+x` que el npm de Vercel bloquea. Y en Vercel /var/task es
// de solo lectura: no se puede hacer chmod ahí. Se copia UNA vez por arranque a
// /tmp y se le da el permiso en la copia.
let ejecutable = null
async function binarioFfmpeg() {
  if (ejecutable) return ejecutable
  try { await access(ffmpegPath, constants.X_OK); ejecutable = ffmpegPath; return ejecutable } catch {}
  const copia = join(tmpdir(), 'ffmpeg-inbox')
  await copyFile(ffmpegPath, copia)
  await chmod(copia, 0o755)
  ejecutable = copia
  return ejecutable
}

async function correrFfmpeg(args) {
  const bin = await binarioFfmpeg()
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', d => { err = (err + d).slice(-2000) })
    p.on('error', reject)
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${code}: ${err.trim().split('\n').pop()}`))))
  })
}

/**
 * Devuelve una url pública .m4a para esta nota de voz. Si ya se convirtió antes, la
 * reutiliza; si no, descarga el .ogg, lo convierte (AAC 64 kb/s, mono) y lo sube.
 * Lanza con un mensaje entendible si algo falla: el vendedor tiene que enterarse.
 */
export async function audioParaMeta(url) {
  if (!necesitaConversion(url)) return url
  const sb = getSupabase()
  // 🔒 La url llega del navegador: SOLO se descarga de NUESTRO bucket. Sin esto el
  // servidor bajaría cualquier dirección que le pasen (SSRF) y la copia se nombraría
  // con una ruta ajena. Prefijo exacto + sin '..' + sin seguir redirecciones.
  const prefijo = sb.storage.from(BUCKET).getPublicUrl('').data.publicUrl.replace(/\/?$/, '/')
  const limpio = String(url).split('?')[0]
  if (!limpio.startsWith(prefijo) || limpio.includes('..')) {
    throw new Error('el audio no está en el almacenamiento del inbox')
  }
  const ruta = rutaCopiaM4a(limpio)
  const publica = sb.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl

  // ¿Ya existe la copia? (HEAD barato; un 200 basta.)
  const ya = await fetch(publica, { method: 'HEAD', cache: 'no-store' }).catch(() => null)
  if (ya?.ok) return publica

  const res = await fetch(limpio, { cache: 'no-store', redirect: 'error' })
  if (!res.ok) throw new Error(`no se pudo bajar el audio (HTTP ${res.status})`)
  const datos = Buffer.from(await res.arrayBuffer())
  // Meta acepta hasta 25 MB; una nota de voz pesa ~100 KB. Más que eso no es un audio.
  if (datos.length > TOPE_BYTES) throw new Error('el audio pesa más de 25 MB')
  const dir = await mkdtemp(join(tmpdir(), 'audio-meta-'))
  try {
    const entrada = join(dir, 'in.ogg'), salida = join(dir, 'out.m4a')
    await writeFile(entrada, datos)
    await correrFfmpeg(['-y', '-i', entrada, '-vn', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', salida])
    const buf = await readFile(salida)
    const { error } = await sb.storage.from(BUCKET).upload(ruta, buf, { contentType: 'audio/mp4', upsert: true })
    if (error) throw new Error(`no se pudo guardar el audio convertido: ${error.message}`)
    return publica
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
