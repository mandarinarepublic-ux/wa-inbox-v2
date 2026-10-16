// lib/descarga.js — que un documento del cliente se descargue CON SU NOMBRE.
//
// ☠️ 16-oct-2026: los clientes de IND mandan diseños en Illustrator (.ai) y no se
// podían abrir. Meta los manda como `application/postscript`, el archivado no
// conocía ese MIME y los guardaba como `wamid.HBgM….bin`. El enlace abría esa URL
// tal cual: el navegador bajaba un `.bin` que Windows no sabe con qué abrir, sin el
// nombre que le puso el cliente. Lo mismo con .eps, .psd, fuentes, .cdr…
//
// Dos arreglos que se cubren entre sí:
// - Al archivar, la extensión sale del NOMBRE del archivo (`extensionDeArchivo`).
// - Al descargar, se fuerza el nombre original (`urlDeDescarga`), así hasta los
//   `.bin` ya guardados bajan como `Conejo.ai`.

// Extensión del nombre que puso el cliente ('Logo final.AI' → 'ai'). Vacío si no
// hay una creíble: mejor caer al MIME que inventar.
export function extensionDeArchivo(nombre) {
  const m = String(nombre || '').trim().match(/\.([a-z0-9]{1,8})$/i)
  return m ? m[1].toLowerCase() : ''
}

// Nombre apto para el disco: sin separadores de ruta ni caracteres que Windows
// rechaza. Conserva tildes y espacios, que son parte del nombre del cliente.
export function nombreDeDescarga(nombre) {
  const limpio = String(nombre || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('').map(c => (c.charCodeAt(0) < 32 ? '_' : c)).join('')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 180)
  return limpio
}

const RE_SUPABASE_PUBLICO = /\.supabase\.co\/storage\/v1\/object\/public\//i

// URL que descarga con el nombre original. Supabase Storage lo hace solo con
// `?download=<nombre>` (responde con Content-Disposition: attachment). Otras
// fuentes quedan igual: ahí manda el atributo `download` del enlace.
export function urlDeDescarga(src, nombre) {
  const n = nombreDeDescarga(nombre)
  if (!src || !n || !RE_SUPABASE_PUBLICO.test(src)) return src
  const sep = src.includes('?') ? '&' : '?'
  return `${src}${sep}download=${encodeURIComponent(n)}`
}
