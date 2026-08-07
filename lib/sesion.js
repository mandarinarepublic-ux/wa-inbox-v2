// Sesión firmada en cookie — reemplaza a "confiar en lo que diga el navegador".
//
// Hasta ahora la identidad vivía en localStorage (`mp_user`, texto plano editable)
// y algunas rutas la recibían en la cabecera `x-mp-usuario-id`. Cualquiera que
// supiera un id de admin podía suplantarlo, y quien conociera la URL de producción
// podía leer o escribir sin ser nadie.
//
// Ahora el servidor emite al hacer login un token `<payload>.<firma>` con HMAC
// SHA-256 y lo guarda en una cookie HttpOnly: el navegador la manda sola en cada
// petición del mismo origen, y el contenido no se puede alterar sin la llave.
//
// Se usa Web Crypto (no `node:crypto`) a propósito: el middleware corre en el
// runtime Edge, donde `node:crypto` no existe.

// ⚠️ COPIA EXACTA de MANDARINACRM/lib/sesion.js. Se mantiene idéntico A PROPÓSITO:
// el CRM emite la cookie y este inbox la verifica, así que si los dos archivos se
// desincronizan, las sesiones dejan de validar sin ningún error visible. Mismo
// criterio que lib/capi.js entre los dos inbox. Si tocas uno, toca el otro.
//
// Acá solo se usan verificarSesion() y secretoSesion(): el inbox NUNCA emite
// cookies. cookieSesion()/cookieBorrada() se conservan para que el archivo siga
// siendo comparable línea por línea con el del CRM.

export const COOKIE_SESION = 'mp_sesion'
export const DIAS_VALIDEZ = 30

const enc = new TextEncoder()

function aBase64Url(bytes) {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64Url(texto) {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function llaveHmac(secreto) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Emite el token de sesión. `datos` = { id, rol } — nada sensible. */
export async function firmarSesion(datos, secreto, dias = DIAS_VALIDEZ) {
  const payload = {
    ...datos,
    exp: Date.now() + dias * 24 * 60 * 60 * 1000,
  }
  const cuerpo = aBase64Url(enc.encode(JSON.stringify(payload)))
  const firma = await crypto.subtle.sign('HMAC', await llaveHmac(secreto), enc.encode(cuerpo))
  return `${cuerpo}.${aBase64Url(firma)}`
}

/**
 * Devuelve el contenido de la sesión, o null si el token falta, fue alterado o
 * caducó. Nunca lanza: un token corrupto es simplemente "no hay sesión".
 */
export async function verificarSesion(token, secreto) {
  if (!token || !secreto) return null
  const [cuerpo, firma] = String(token).split('.')
  if (!cuerpo || !firma) return null

  try {
    // crypto.subtle.verify compara en tiempo constante.
    const valida = await crypto.subtle.verify(
      'HMAC',
      await llaveHmac(secreto),
      deBase64Url(firma),
      enc.encode(cuerpo),
    )
    if (!valida) return null

    const datos = JSON.parse(new TextDecoder().decode(deBase64Url(cuerpo)))
    if (!datos?.exp || Date.now() > datos.exp) return null
    return datos
  } catch {
    return null
  }
}

/**
 * Dominio de la cookie para el HOST que está respondiendo. Vacío = host-only.
 *
 * Se pone `.apps.mandarinaec.com` para que la MISMA sesión valga en el CRM y en
 * los inbox: son subdominios del mismo sitio. Un nivel más abajo que
 * `.mandarinaec.com` a propósito — ese es el dominio de la tienda Shopify, y la
 * cookie viajaría también a Shopify sin ninguna necesidad.
 *
 * El navegador DESCARTA cualquier cookie cuyo `Domain` no cubra el host que la
 * manda (RFC 6265 §5.3). El CRM se sirve por DOS hosts — el nuevo
 * `crm.apps.mandarinaec.com` y el viejo `mandarina-pro-sales.vercel.app`, que
 * sigue vivo — y sin esta comprobación los dos emitían `Domain=.apps.mandarinaec.com`:
 * el host viejo mandaba una cookie que su propio navegador tiraba, el login
 * respondía 200 y el middleware devolvía a quien entraba al login otra vez, en
 * bucle silencioso. Por eso el Domain solo se pone cuando el host que responde
 * está debajo de COOKIE_DOMINIO.
 */
export function dominioCookie(host) {
  const dom = String(process.env.COOKIE_DOMINIO || '').replace(/[^\x21-\x7E]/g, '')
  if (!dom) return ''
  const base = dom.startsWith('.') ? dom.slice(1) : dom

  // Normalizar el host contra ataques HTTP Header Injection y proxies encadenados:
  let h = String(host || '')
  // El primer valor si hay commas: en cadenas de proxies, x-forwarded-host lista
  // el host del cliente original primero; los demás son intermediarios.
  if (h.includes(',')) h = h.split(',')[0]
  // Espacios alrededor, quitar puerto, minúsculas, punto final
  h = h.trim().split(':')[0].toLowerCase()
  if (h.endsWith('.')) h = h.slice(0, -1)

  if (h === base || h.endsWith('.' + base)) return dom
  return ''
}

/** Cabecera Set-Cookie de la sesión. HttpOnly = el JS de la página no la lee. */
export function cookieSesion(token, host) {
  const partes = [
    `${COOKIE_SESION}=${token}`,
    'Path=/',
    `Max-Age=${DIAS_VALIDEZ * 24 * 60 * 60}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  const dom = dominioCookie(host)
  if (dom) partes.push(`Domain=${dom}`)
  if (process.env.NODE_ENV === 'production') partes.push('Secure')
  return partes.join('; ')
}

/** Cabecera Set-Cookie que BORRA la sesión. */
export function cookieBorrada(host) {
  const partes = [
    `${COOKIE_SESION}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ]
  const dom = dominioCookie(host)
  if (dom) partes.push(`Domain=${dom}`)
  if (process.env.NODE_ENV === 'production') partes.push('Secure')
  return partes.join('; ')
}

/** Secreto de firma. Sin él no se emite ni se acepta ninguna sesión. */
export function secretoSesion() {
  // Limpia el BOM invisible que PowerShell le mete a las variables de Vercel:
  // sin esto la firma se calcularía con una llave distinta solo en producción.
  return String(process.env.SESSION_SECRET || '').replace(/[^\x21-\x7E]/g, '')
}
