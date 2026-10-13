// lib/catalogo-lista.js — qué productos del catálogo de Meta se ofrecen para el
// carrusel. Módulo PURO (tests/carrusel.test.js).
//
// Fuera: sin foto (las ~70 fichas viejas de CatMandSF con id corto), ocultos y sin
// stock. Si el mismo nombre aparece dos veces, queda el primero CON foto.

// "… | Mandarina Republic" y "… - Mandarina Republic" (los dos conviven en CatMandSF)
const limpiar = (s) => String(s || '').replace(/\s*[|\-–—]\s*Mandarina Republic\s*$/i, '').trim()

export function productosParaCarrusel(filas) {
  const vistos = new Set()
  const out = []
  for (const f of filas || []) {
    const retailerId = String(f?.retailer_id || '').trim()
    const foto = String(f?.image_url || '').trim()
    if (!retailerId || !foto) continue
    if (f.visibility && f.visibility !== 'published') continue
    if (f.availability && !/in stock/i.test(f.availability)) continue
    const nombre = limpiar(f.name)
    const clave = nombre.toLowerCase()
    if (vistos.has(clave)) continue
    vistos.add(clave)
    out.push({ retailerId, nombre, precio: String(f.price || ''), foto })
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
