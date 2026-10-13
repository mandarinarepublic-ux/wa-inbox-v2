// lib/carrusel.js — 🛍️ Carrusel de productos (diseño 13-oct-2026). Módulo PURO.
//
// De 2 a 10 tarjetas deslizables con foto, nombre y precio, sacadas del catálogo
// de Meta conectado a la WABA. Dos formas de mandarlo (verificado contra la doc
// oficial el 13-oct-2026):
//
//   · VENTANA ABIERTA (24 h o pauta): mensaje interactivo `carousel`, sin plantilla.
//     `body.text` obligatorio (≤1024); SIN header, footer ni botones; todas las
//     tarjetas del MISMO catálogo; `card_index` 0..9 único.
//   · VENTANA CERRADA: plantilla de MARKETING "product card carousel" aprobada por
//     Meta (env `CARRUSEL_PLANTILLA` = "nombre|idioma"). Sin ella, error claro.
//
// ☠️ El catálogo de MANDI (CatMandSF) mezcla ~70 productos viejos con id corto
// ("1", "10", "108"…) y SIN foto, con los de Shopify (id de 13 dígitos) CON foto.
// Una tarjeta sin foto se ve rota: el buscador solo ofrece productos con imagen.

export const CATALOGO_POR_DEFECTO = '748962957813465'   // CatMandSF, conectado 11-oct-2026
export const MIN_TARJETAS = 2
export const MAX_TARJETAS = 10
export const MAX_TEXTO = 1024

/** Normaliza y valida lo que llega del navegador. Devuelve { productos, texto } o lanza con un texto para el vendedor. */
export function validarCarrusel(productos, texto) {
  const lista = []
  const vistos = new Set()
  for (const p of Array.isArray(productos) ? productos : []) {
    const retailerId = String(p?.retailerId ?? '').trim()
    if (!retailerId || vistos.has(retailerId)) continue
    vistos.add(retailerId)
    lista.push({
      retailerId,
      nombre: String(p?.nombre || '').slice(0, 120),
      precio: String(p?.precio || '').slice(0, 30),
      foto: String(p?.foto || '').slice(0, 600),
    })
  }
  if (lista.length < MIN_TARJETAS) throw new Error(`Elige al menos ${MIN_TARJETAS} productos`)
  if (lista.length > MAX_TARJETAS) throw new Error(`Máximo ${MAX_TARJETAS} productos por carrusel`)
  const t = String(texto || '').trim()
  if (!t) throw new Error('El carrusel necesita un texto')
  if (t.length > MAX_TEXTO) throw new Error(`El texto pasa de ${MAX_TEXTO} letras`)
  return { productos: lista, texto: t }
}

/**
 * ¿Se le puede mandar el interactivo? Ventana de 24 h desde el último ENTRANTE de
 * ese número, o ventana de pauta vigente (7 días, ver docs/sql/2026-10-07-ventana-pauta.sql).
 * Margen de 2 min: mejor caer a plantilla que morir con 131047.
 */
export function ventanaAbiertaCarrusel({ ultimoEntranteAt, pautaVenceEn } = {}, ahoraMs = Date.now()) {
  const MARGEN = 2 * 60 * 1000
  const e = Date.parse(ultimoEntranteAt || '')
  if (Number.isFinite(e) && e + 24 * 3600 * 1000 - MARGEN > ahoraMs) return true
  const p = Date.parse(pautaVenceEn || '')
  return Number.isFinite(p) && p - MARGEN > ahoraMs
}

/** "nombre|es" → { nombre, idioma } o null. */
export function plantillaCarrusel(env = '') {
  const [nombre, idioma] = String(env || '').split('|').map(s => s.trim())
  return nombre ? { nombre, idioma: idioma || 'es' } : null
}

export function payloadInteractivo(dest, catalogId, productos, texto) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...dest,
    type: 'interactive',
    interactive: {
      type: 'carousel',
      body: { text: texto },
      action: {
        cards: productos.map((p, i) => ({
          card_index: i,
          type: 'product',
          action: { product_retailer_id: p.retailerId, catalog_id: catalogId },
        })),
      },
    },
  }
}

/** La plantilla lleva el texto como variable {{1}} del cuerpo. */
export function payloadPlantilla(dest, catalogId, productos, texto, plantilla) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...dest,
    type: 'template',
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: texto }] },
        {
          type: 'carousel',
          cards: productos.map((p, i) => ({
            card_index: i,
            components: [{
              type: 'header',
              parameters: [{ type: 'product', product: { product_retailer_id: p.retailerId, catalog_id: catalogId } }],
            }],
          })),
        },
      ],
    },
  }
}

/** Lo que se guarda en `botones` para pintar el carrusel en el hilo. */
export function guardadoCarrusel(productos, via) {
  return JSON.stringify({ carrusel: productos, via })
}

/** Lee lo guardado en `botones`. null si el mensaje no es un carrusel. */
export function leerCarrusel(botones) {
  try {
    const o = typeof botones === 'string' ? JSON.parse(botones) : botones
    return o && Array.isArray(o.carrusel) ? o : null
  } catch { return null }
}

/**
 * La plantilla de carrusel que se manda a aprobar (POST /{waba}/message_templates).
 * Forma de la doc oficial (13-oct-2026): cuerpo + `carousel` con DOS tarjetas
 * modelo (header `product` + botón `spm` "View"); aprobada, admite hasta 10.
 * ☠️ Meta rechaza un cuerpo que EMPIECE o TERMINE en variable: por eso la línea final fija.
 */
export const TEXTO_PLANTILLA_CARRUSEL = '¡Hola! 🧡 {{1}}\n\nDesliza para ver más 👉'
export function payloadCrearPlantillaCarrusel(nombre = 'carrusel_productos', idioma = 'es') {
  const tarjeta = {
    components: [
      { type: 'header', format: 'product' },
      { type: 'buttons', buttons: [{ type: 'spm', text: idioma.startsWith('es') ? 'Ver' : 'View' }] },
    ],
  }
  return {
    name: nombre,
    language: idioma,
    category: 'MARKETING',
    components: [
      { type: 'body', text: TEXTO_PLANTILLA_CARRUSEL, example: { body_text: [['mira estas chaquetas de Dragon Ball que te pueden gustar']] } },
      { type: 'carousel', cards: [tarjeta, tarjeta] },
    ],
  }
}
