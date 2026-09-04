// lib/resumen-lista.js — qué se pinta en la segunda línea de la barra lateral.
//
// ☠️ EL PROBLEMA. En 30 días, 816 conversaciones arrancan con EXACTAMENTE el
// mismo texto —"¡Hola! Quiero más información."— porque es el que arma Meta
// cuando alguien toca un anuncio. En la lista se ven todas iguales:
//
//   Kakaroto 2000    ¡Hola! Quiero más información.
//   Ariana ✨         ¡Hola! Quiero más información.
//
// El dato de qué quiere cada quien SÍ está guardado: en el anuncio del que
// viene (`referral`), en el pedido del catálogo, o en el texto del botón de la
// web. Solo faltaba mirarlo.
//
// ⚠️ SOLO se etiqueta un ENTRANTE. En cuanto se contesta, la lista vuelve a
// mostrar lo último que se dijo: esa segunda línea es como se escanea la
// bandeja, y una etiqueta pegada la dejaría mintiendo sobre el estado real de
// la conversación.

// El botón "Me interesa este producto" de mandarinaec.com. El nombre va DESPUÉS
// de los dos puntos, y como los ~32 primeros caracteres son siempre iguales, en
// la lista el producto quedaba justo fuera del recorte.
const RE_WEB = /me interesa (?:este|el) producto\s*:\s*(.+)$/is

// Un titular que es un dominio no le dice nada a nadie ("api.whatsapp.com" es
// uno de los 3 titulares que usa MANDI). Mejor sin etiqueta que con ruido.
const ES_DOMINIO = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/|$)/i

const primeraLinea = (t) => String(t || '').split('\n').map(s => s.trim()).find(Boolean) || ''

/**
 * { icono, texto } para pintar en vez del último mensaje, o null para dejarlo
 * como está hoy. null NUNCA es un error: es "acá no hay nada mejor que decir".
 */
export function resumenDeLista(last) {
  if (!last || last.direccion !== 'ENTRANTE') return null

  // 1. De qué ANUNCIO viene. Es lo más informativo que existe para un lead nuevo.
  const ref = last.referral
  if (ref) {
    const cuerpo = primeraLinea(ref.body)
    if (cuerpo) return { icono: '🎯', texto: cuerpo }
    const titular = String(ref.headline || '').trim()
    if (titular && !ES_DOMINIO.test(titular)) return { icono: '🎯', texto: titular }
  }

  // 2. Pedido del catálogo. El texto crudo trae ids y saltos de línea: no cabe
  //    ni sirve en una línea. El detalle con foto está en la burbuja.
  if (last.tipo === 'order') return { icono: '📦', texto: 'Pedido del catálogo' }

  // 3. Botón de producto de la web.
  const m = String(last.mensaje || '').match(RE_WEB)
  if (m && m[1].trim()) return { icono: '🛍️', texto: m[1].trim() }

  return null
}
