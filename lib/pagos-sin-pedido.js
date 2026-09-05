// lib/pagos-sin-pedido.js — avisar de un cliente que pagó y cuyo pedido nunca se creó.
//
// ⚠️ POR QUÉ EXISTE, con números (auditoría del 4-sep-2026): dos clientes de IND
// pagaron y su pedido nunca entró al CRM — Giovelly Achilie ($160, dio cédula y
// dirección, se le dijo "así le vamos a procesar su pedido") y Jorge Díaz ($40,
// chompa bordada, se le dijo "ya está en proceso todo"). $200 cobrados y nadie
// lo sabía. Se encontraron A MANO, revisando otra cosa.
//
// ☠️ LA REGLA ES UN INDICIO, NO UNA CERTEZA. Se dispara cuando (a) le mandamos
// los datos de pago, (b) el cliente mandó una foto después, y (c) no hay pedido
// suyo en el CRM. Esa foto puede ser un comprobante… o una talla, o un diseño.
//
// Por eso el aviso dice POSIBLE. Medido: la regla marca ~34 casos al mes (33 en
// IND, 1 en MANDI), o sea ~1 por día. Un aviso que afirme de más y falle tres
// veces se apaga en una semana, y entonces no sirve para nada.
//
// ⚠️ Detectar el comprobante por el texto NO funciona: solo 34 de 285 fotos (12%)
// traen el "Enviado desde mi Banca Móvil". El 88% son fotos peladas.

const fmtFecha = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('es-EC', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Guayaquil',
  })
}

/**
 * El texto del aviso, o '' si no hay nada que avisar.
 *
 * ☠️ Devuelve '' con la lista vacía A PROPÓSITO, y quien llama no manda nada. Un
 * aviso diario que dice "0 casos" es ruido: entrena a ignorar el canal, y el día
 * que traiga uno de verdad ya nadie lo abre.
 */
export function textoAvisoPagos(casos, { baseUrl = '' } = {}) {
  const lista = (casos || []).filter(Boolean)
  if (!lista.length) return ''

  const base = String(baseUrl || '').replace(/\/+$/, '')
  const lineas = lista.map((c) => {
    const tel = String(c.telefono || '')
    // Sin nombre se muestra el teléfono: nunca "undefined" en un aviso.
    const quien = String(c.nombre || '').trim() || tel
    const cuando = fmtFecha(c.fecha)
    const link = base ? `\n   ${base}/inbox?tel=${tel}` : ''
    return `• ${quien} — ${tel}${cuando ? ` (${cuando})` : ''}${link}`
  })

  return [
    `💸 ${lista.length} posible${lista.length === 1 ? '' : 's'} pago${lista.length === 1 ? '' : 's'} SIN PEDIDO`,
    '',
    'Les pedimos los datos de pago, mandaron una foto después, y no hay pedido suyo en el CRM.',
    '',
    ...lineas,
    '',
    '⚠️ Es un indicio: la foto puede no ser un comprobante. Vale la pena mirarlos.',
  ].join('\n')
}
