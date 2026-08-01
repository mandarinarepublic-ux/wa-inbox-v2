// lib/env.js — Lee variables de entorno sin la basura invisible.
//
// Cargar variables a Vercel desde PowerShell les pega un BOM (U+FEFF) al
// principio. No se ve en ningún lado: ni en el panel de Vercel, ni al imprimir
// la variable, ni al comparar a ojo. Solo revienta en producción y con un error
// que no menciona el BOM por ningún lado.
//
// Ya pasó dos veces:
//   - Supabase: `TypeError ... ByteString ... 65279` (65279 = 0xFEFF).
//   - Telegram: el token entra en la URL `/bot<token>/sendMessage`, así que un
//     BOM la vuelve una ruta que no existe y la API responde 404 "Not Found",
//     como si el bot no existiera.
//
// La regla: cualquier variable que termine dentro de una URL o de una cabecera
// se lee por acá.
export function env(nombre) {
  const v = process.env[nombre]
  if (!v) return ''
  return String(v).replace(/^﻿/, '').trim()
}

/**
 * ¿Tiene pinta de estar mal cargada? Devuelve el problema o null.
 * Sirve para diagnosticar sin imprimir el secreto.
 */
export function revisarEnv(nombre) {
  const crudo = process.env[nombre]
  if (!crudo) return 'no está puesta'
  if (String(crudo).startsWith('﻿')) return 'tiene un BOM al inicio (se cargó desde PowerShell)'
  if (String(crudo) !== String(crudo).trim()) return 'tiene espacios o saltos de línea alrededor'
  return null
}
