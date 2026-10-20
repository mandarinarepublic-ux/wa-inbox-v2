// lib/catalogo-revision.js — 🛍️ ¿El catálogo de WhatsApp (CatMandSF) es igual a la
// tienda de Shopify? Revisión diaria, 19-oct-2026. Módulo PURO.
//
// Por qué existe: la carga la hace META sola (fuente "Productos CatMandSF",
// REEMPLAZAR diario 6:30 desde /api/feed-catalogo), y Meta no avisa a nadie. Si la
// carga falla, o el feed se cae, el catálogo se queda viejo y nadie se entera —
// igual que los ~16 días sin catálogo de sep-2026. Esta revisión compara las dos
// listas producto por producto y deja el resultado en ⏱️ Tareas automáticas del CRM.
//
// Lo que se compara es lo que el cliente VE en WhatsApp: que esté, el precio que
// paga (el de oferta si hay) y si está disponible. La lista de Shopify es la misma
// que se le entrega a Meta (filaDeProducto), así se compara manzanas con manzanas.

/** "35.00 USD", "$35.00", "35,00 US$" → 35. Sin número → null. */
export function precioNumero(v) {
  let s = String(v ?? '').replace(/[^\d.,]/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const precioFinal = (salePrice, price) => precioNumero(salePrice) ?? precioNumero(price)
const disponible = (a) => /^in[ _]stock$/i.test(String(a || '').trim())

/**
 * @param filasShopify filas del feed (filaDeProducto): {id, title, price, sale_price, availability}
 * @param itemsMeta productos del catálogo según Graph: {retailer_id, name, price, sale_price, availability}
 * @param carga última carga de Meta {inicio, fin, detectados, guardados, borrados, errores} o null si no se pudo leer
 * @param ahora Date (para saber si la carga es de hoy)
 */
export function compararCatalogos(filasShopify, itemsMeta, carga, ahora = new Date()) {
  const meta = new Map((itemsMeta || []).map((m) => [String(m.retailer_id), m]))
  const shop = new Map((filasShopify || []).map((f) => [String(f.id), f]))

  const faltan = []
  const precio = []
  const stock = []
  for (const [id, f] of shop) {
    const m = meta.get(id)
    if (!m) { faltan.push({ id, nombre: f.title }); continue }
    const ps = precioFinal(f.sale_price, f.price)
    const pm = precioFinal(m.sale_price, m.price)
    if (ps != null && pm != null && Math.abs(ps - pm) >= 0.01) precio.push({ id, nombre: f.title, shopify: ps, whatsapp: pm })
    if (disponible(f.availability) !== disponible(m.availability)) {
      stock.push({ id, nombre: f.title, shopify: f.availability, whatsapp: m.availability })
    }
  }
  const sobran = [...meta.values()]
    .filter((m) => !shop.has(String(m.retailer_id)))
    .map((m) => ({ id: String(m.retailer_id), nombre: m.name || '' }))

  // La carga de Meta: ¿corrió en las últimas 26 h y sin errores?
  const horas = carga?.inicio ? (ahora - new Date(carga.inicio)) / 3600e3 : null
  const cargaVieja = horas == null || horas > 26
  const cargaConError = Boolean(carga && (carga.errores > 0 || carga.resultado === 'failed'))

  const diferencias = faltan.length + sobran.length + precio.length + stock.length
  const estado = cargaConError || (carga && cargaVieja) ? 'error' : diferencias ? 'aviso' : 'ok'

  const lineas = []
  lineas.push(diferencias
    ? `Shopify ${shop.size} · WhatsApp ${meta.size}: ${diferencias} diferencia${diferencias === 1 ? '' : 's'}.`
    : `Iguales: ${shop.size} productos en Shopify y ${meta.size} en WhatsApp.`)
  const muestra = (xs) => xs.slice(0, 5).map((x) => x.nombre || x.id).join(', ') + (xs.length > 5 ? ` y ${xs.length - 5} más` : '')
  if (faltan.length) lineas.push(`🟡 Faltan en WhatsApp ${faltan.length}: ${muestra(faltan)}.`)
  if (sobran.length) lineas.push(`🟡 Sobran en WhatsApp ${sobran.length} (ya no están en Shopify): ${muestra(sobran)}.`)
  if (precio.length) lineas.push(`🟡 Precio distinto ${precio.length}: ${precio.slice(0, 3).map((x) => `${x.nombre} $${x.shopify} vs $${x.whatsapp}`).join('; ')}${precio.length > 3 ? '…' : ''}.`)
  if (stock.length) lineas.push(`🟡 Disponibilidad distinta ${stock.length}: ${muestra(stock)}.`)
  if (!carga) lineas.push('No se pudo leer la última carga de Meta (sí se comparó el catálogo).')
  else if (cargaConError) lineas.push(`🔴 La última carga de Meta tuvo ${carga.errores} error(es): revisa la fuente "Productos CatMandSF" en Commerce Manager.`)
  else if (cargaVieja) lineas.push(`🔴 Meta no carga el catálogo desde hace ${Math.round(horas)} h: revisa la programación de la fuente.`)
  else lineas.push(`Carga de Meta OK: ${carga.guardados} guardados${carga.borrados ? `, ${carga.borrados} borrados` : ''}.`)
  // Lo normal tras un cambio en Shopify a mitad del día: lo arregla la carga de mañana.
  if (diferencias && !cargaConError && !cargaVieja) lineas.push('Se corrige solo en la carga de mañana 6:30.')

  return { estado, resumen: lineas.join('\n'), detalle: { faltan, sobran, precio, stock, carga } }
}
