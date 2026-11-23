// ✗ → Un error de envío que dice QUÉ pasó y QUÉ hacer (22-nov-2026, web-design-guidelines
// tanda 3, pedido de Rodrigo).
//
// Antes, si Meta rechazaba un mensaje, el aviso decía «✗ Error al enviar — intenta de
// nuevo» y el motivo real se perdía en el camino. Con la ventana de 24 h cerrada,
// reintentar no sirve nunca: hay que mandar una plantilla.
//
// ☠️ «No hubo respuesta» NO es «no salió». Si el servidor no contestó, el mensaje
// pudo haber llegado igual: el paso es MIRAR el chat antes de reenviar, nunca
// «vuelve a enviar», que le mandaría el mismo mensaje dos veces al cliente.

/** Por código de error de Meta (viene en `codigo` desde /api/saliente). */
const POR_CODIGO = {
  131047: ['La ventana de 24 h está cerrada', 'manda una plantilla (📋)'],
  131026: ['Ese número no puede recibir WhatsApp', 'confirma el número con el cliente por otra vía'],
  131053: ['WhatsApp no aceptó el archivo', 'conviértelo a JPG o MP4, o mándalo como documento'],
  131056: ['Demasiados mensajes seguidos a este cliente', 'espera un minuto y vuelve a enviar'],
  131048: ['Meta frenó los envíos por posible spam', 'espera un rato antes de seguir enviando'],
  131049: ['Meta no entregó el mensaje para cuidar al usuario', 'prueba más tarde o con una plantilla'],
  131042: ['Meta frenó TODOS los envíos por un pago pendiente', 'paga en Meta Business → Facturación'],
  131031: ['Meta bloqueó la cuenta de WhatsApp', 'revisa el Administrador de WhatsApp'],
  190:    ['La conexión con WhatsApp venció (token)', 'avisa al administrador: hay que cargar un META_TOKEN nuevo'],
}

/** Si no vino el código, por el texto (Meta responde en inglés). */
const POR_TEXTO = [
  [/re-?engagement|24 ?h(ou)?rs?|ventana de 24/i, 131047],
  [/undeliverable|not a valid whatsapp|no tiene whatsapp/i, 131026],
  [/pair rate limit/i, 131056],
  [/spam rate limit/i, 131048],
  [/payment|pago pendiente/i, 131042],
  [/access token|session has expired/i, 190],
]

const SIN_RESPUESTA = /failed to fetch|networkerror|load failed|network request failed|^HTTP 50[034]$|timeout/i

// Mensajes nuestros que ya traen su propio paso: no se les agrega otro.
const YA_TRAE_PASO = /recarga|súbela|conviért|convertilo|paga |revisa|reintenta|vuelve a|hay que|→/i

/**
 * @param {object|null} r   lo que devolvió el envío: { ok, error, codigo } o null.
 * @param {string} que      qué se mandaba, para el texto genérico ('el mensaje', 'la foto'…).
 * @returns {{ motivo: string, paso: string, texto: string }}
 */
export function explicarError(r, que = 'el mensaje') {
  const error = String(r?.error ?? r?.msg ?? '').trim()
  const armar = (motivo, paso) => ({ motivo, paso, texto: paso ? `✗ ${motivo} → ${paso}` : `✗ ${motivo}` })

  let codigo = Number(r?.codigo) || 0
  if (!POR_CODIGO[codigo]) codigo = (POR_TEXTO.find(([re]) => re.test(error)) || [])[1] || 0
  if (POR_CODIGO[codigo]) return armar(...POR_CODIGO[codigo])

  if (!r || !error || SIN_RESPUESTA.test(error)) {
    return armar('No hubo respuesta del servidor',
      `mira el chat en unos segundos antes de reenviar: ${que} puede haber salido`)
  }
  const motivo = /^no se pud/i.test(error) ? error : `No se pudo enviar ${que}: ${error}`
  return armar(motivo,
    YA_TRAE_PASO.test(error) ? '' : 'reintenta; si se repite, avisa al administrador')
}
