// lib/imagen-whatsapp.js — la foto de un producto de Shopify, en un tamaño que WhatsApp acepte.
//
// ☠️ Por qué existe (13-nov-2026): WhatsApp rechaza imágenes de más de 5 MB. Las
// fotos de producto de Shopify se suben en PNG enorme ("4FANTASTICOS-03.png" pesaba
// 5,3 MB) y el botón 📷 Foto de la Tienda las mandaba tal cual: las 3 fotos de los
// 4 Fantásticos salieron como `failed` y el cliente recibió solo el texto.
//
// El CDN de Shopify redimensiona solo con `width=`: a 1600 px esa misma foto baja a
// 2,5 MB y se sigue viendo nítida en el celular. Cualquier otra URL se deja igual.

const ANCHO = 1600

export function imagenParaWhatsapp(url) {
  const s = String(url || '')
  let u
  try { u = new URL(s) } catch { return s }
  if (u.hostname !== 'cdn.shopify.com') return s
  // Si ya trae un ancho menor, se respeta.
  const actual = Number(u.searchParams.get('width'))
  if (!(actual > 0 && actual <= ANCHO)) u.searchParams.set('width', String(ANCHO))
  return u.toString()
}
