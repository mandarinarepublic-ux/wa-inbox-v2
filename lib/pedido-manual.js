// PEDIDO MANUAL: abrir la pantalla `nuevo-pedido` del CRM dentro del panel.
//
// No se reimplementa ningún formulario. El CRM ya sabe de clientes, productos,
// pagos, factura, mapa y fecha de entrega; acá solo se arma la URL y se escucha
// la respuesta.

const CRM = 'https://crm.apps.mandarinaec.com'

// ── Geometría: cuánto tiene que medir el panel con el formulario abierto ─────
//
// El formulario del CRM vive en `max-w-2xl mx-auto` + `px-4`: 672 + 16 + 16 =
// 704 px de contenido REAL, centrado. Todo lo que el panel mida de más se
// reparte a los lados como vacío — que es exactamente lo que molestaba: el panel
// se comía espacio del chat sin usarlo.
//
// ⚠️ Pero NO se puede angostar cuanto uno quiera. Ese formulario tiene estilos
// `md:` (`md:static`, `md:border-0`, `md:bg-transparent`, `md:h-auto`), o sea que
// POR DEBAJO DE 768 px se pasa solo a su diseño de celular, sin avisar. Y el CRM
// no ve el ancho del panel: ve `ancho del panel ÷ ESCALA`. Por eso el mínimo se
// DERIVA de la escala en vez de escribirse a mano — si algún día alguien toca
// `ESCALA_PEDIDO`, el mínimo se mueve con ella y el diseño no se rompe en
// silencio. Hay pruebas que vigilan la relación.

/** Cuánto se encoge el formulario para que entre entero. La única perilla. */
export const ESCALA_PEDIDO = 0.70
/** El breakpoint `md:` de Tailwind, donde el formulario cambia de diseño. */
export const CORTE_ESCRITORIO_CRM = 768
/** Lo que ocupa de verdad el formulario por dentro: max-w-2xl (672) + px-4 (32). */
export const ANCHO_CONTENIDO_CRM = 704
/** Ancho interno al que apuntamos: pasa el corte de 768 y cubre los 704, con aire. */
export const ANCHO_INTERNO_OBJETIVO = 800

/** Lo que el CRM cree que mide la ventana, que es lo que decide su diseño. */
export function anchoInternoDelFormulario(anchoPanel, escala = ESCALA_PEDIDO) {
  return anchoPanel / escala
}

/** El panel más angosto que deja al CRM en su diseño de escritorio. */
export function anchoPanelMinimo(escala = ESCALA_PEDIDO) {
  return Math.ceil(CORTE_ESCRITORIO_CRM * escala)
}

/** El ancho al que se abre el panel: el formulario casi lleno, sin vacío de más. */
export function anchoPanelPedido(escala = ESCALA_PEDIDO) {
  return Math.max(anchoPanelMinimo(escala), Math.round(ANCHO_INTERNO_OBJETIVO * escala))
}

/**
 * El teléfono de WhatsApp al formato que valida el CRM (`0987654321`).
 *
 * El inbox los guarda como `593999989663` (código de país, sin +) y el CRM exige
 * 10 dígitos empezando en 0. Si el número no es ecuatoriano se devuelve '' para
 * NO precargar: un valor inválido en ese campo traba el formulario, y es peor
 * que dejarlo vacío para que lo escriban.
 */
export function celularEcuador(telefono) {
  const d = String(telefono || '').replace(/\D/g, '')
  if (/^593\d{9}$/.test(d)) return '0' + d.slice(3)
  if (/^0\d{9}$/.test(d)) return d
  return ''
}

/** La URL del formulario del CRM, ya precargado con lo que sabemos del chat. */
export function urlPedidoManual(telefono, nombre) {
  const p = new URLSearchParams({ embed: '1' })
  const cel = celularEcuador(telefono)
  if (cel) p.set('celular', cel)
  if (nombre) p.set('nombre', String(nombre))
  return `${CRM}/dashboard/nuevo-pedido?${p.toString()}`
}

/**
 * Lee el aviso de "pedido creado", o null si el mensaje no es de fiar.
 *
 * ⚠️ Un iframe recibe `message` de CUALQUIERA: extensiones del navegador, las
 * herramientas de React, y quien quiera. Por eso se comprueba `origin` primero
 * y se exige la forma exacta. Sin esto, cualquier página abierta podría hacernos
 * marcar ventas que no existen.
 */
export function leerAvisoPedido(evento) {
  if (!evento || evento.origin !== CRM) return null
  const d = evento.data
  if (!d || typeof d !== 'object') return null
  if (d.tipo !== 'pedido-creado') return null
  if (!d.pedidoId) return null
  return { pedidoId: String(d.pedidoId), montoTotal: d.montoTotal, url: d.url }
}

/**
 * Lo que se le pregunta al vendedor antes de tirar un pedido a medio llenar.
 *
 * ⚠️ El formulario vive en un iframe de OTRO origen (`crm.apps…` frente a
 * `inbox.apps…`), así que no podemos leer su contenido: es imposible saber si
 * escribió algo o si el panel está abierto y vacío. Por eso el texto NO afirma
 * que haya algo escrito — dice lo único que sabemos con certeza (que está
 * abierto y que no podemos ver adentro) y deja la pérdida en condicional. Si
 * dijera "tienes un pedido a medio llenar" estaría mintiendo la mitad de las
 * veces, y un aviso que miente se aprende a ignorar.
 *
 * Los dos caminos van escritos porque los botones del navegador dicen
 * "Aceptar/Cancelar" y no explican qué hace cada uno.
 */
export const AVISO_DESCARTAR_PEDIDO =
  'Tienes abierto el PEDIDO MANUAL.\n\n' +
  'El formulario es del CRM y desde el inbox no podemos ver si ya llenaste algo. ' +
  'Si sigues, se cierra y se pierde lo que hayas escrito.\n\n' +
  '¿Lo descartas?\n\n' +
  'Aceptar = descartar y cambiar de chat\n' +
  'Cancelar = volver al pedido'

/**
 * ¿Hay que preguntar antes de soltar la conversación que está abierta?
 *
 * - `manuales`: qué paneles tienen el formulario abierto, p.ej.
 *   `{ escritorio: false, cajon: true }`. Son dos porque en el celular el panel
 *   de escritorio sigue MONTADO (solo lo esconde el CSS) — ver PedidoManual.
 * - `actual`: teléfono del chat abierto. `destino`: al que se va (`null` =
 *   cerrar el chat, que es lo que hacen cambiar de bandeja y cambiar de canal).
 *
 * Volver a tocar el chat que ya estás mirando no cambia nada y no se pregunta:
 * el formulario no se pierde, así que molestar ahí sería solo ruido.
 */
export function hayQueConfirmarDescarte(manuales, actual, destino) {
  const abierto = Object.values(manuales || {}).some(Boolean)
  if (!abierto) return false
  if (actual != null && destino != null && String(actual) === String(destino)) return false
  return true
}

/**
 * El texto de la nota que queda en el chat cuando se crea el pedido. La usan los
 * DOS caminos, el manual y el de la IA.
 *
 * ⚠️ La nota es registro PERMANENTE y desde el inbox no se puede editar: la
 * palabra `undefined` no puede terminar ahí. `leerAvisoPedido` solo exige el
 * `pedidoId` — el monto y el link son opcionales y hay que tratarlos como tales:
 * si el monto no viene se dice "sin monto", y si no viene el link la nota se
 * queda en una sola línea en vez de agregar una que diga `undefined`.
 *
 * ⚠️ Con los tres campos presentes el texto tiene que salir IDÉNTICO carácter
 * por carácter a la plantilla cruda que usaba el camino con IA, que es el que
 * funciona hoy. Hay una prueba que lo vigila: no cambies el formato a la ligera.
 */
export function textoNotaPedido(aviso) {
  const monto = aviso?.montoTotal
  const hayMonto = monto !== undefined && monto !== null && monto !== ''
  const cabecera = `📦 Pedido ${aviso?.pedidoId} · ${hayMonto ? `$${monto}` : 'sin monto'}`
  const url = aviso?.url ? String(aviso.url).trim() : ''
  return url ? `${cabecera}\n${url}` : cabecera
}
