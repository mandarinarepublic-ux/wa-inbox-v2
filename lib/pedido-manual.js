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
 * La URL de la pantalla de UN pedido del CRM, lista para verse dentro del panel.
 *
 * ⚠️ Se arma con el NÚMERO de pedido y la constante `CRM` de este archivo, y NO
 * con la `url` que ya viene en cada pedido del historial. Esa la construye el
 * servidor en `/api/cliente-pedidos` con la variable `MANDARINACRM_URL`, que
 * puede apuntar al dominio de Vercel (`mandarina-pro-sales.vercel.app`). Ahí la
 * cookie `mp_sesion` —que es de `.apps.mandarinaec.com`— NO viaja, y el panel
 * mostraría un login en vez del pedido. Armándola acá, el iframe entra por el
 * mismo dominio que el PEDIDO MANUAL, que es el que ya sabemos que abre
 * autenticado. De paso, la url del iframe nunca depende de lo que devuelva una
 * API: no hay forma de que un dato de la base nos meta otro sitio en el panel.
 *
 * Devuelve '' si no hay número: sin eso no hay nada que mostrar y quien llama no
 * pinta el botón.
 */
export function urlVerPedido(pedidoId) {
  const id = String(pedidoId ?? '').trim()
  if (!id) return ''
  return `${CRM}/dashboard/pedido/${encodeURIComponent(id)}?embed=1`
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
 * El NÚMERO de pedido escrito en una nota del chat, o '' si esa nota no habla
 * de ningún pedido.
 *
 * ⚠️ Se devuelve el NÚMERO y no la url que trae la nota, aunque la url esté ahí
 * a la vista. La nota es texto viejo guardado en la base: su link lo armó el CRM
 * el día que se creó el pedido, con `MANDARINACRM_URL`, y eso puede ser el
 * dominio de Vercel (`mandarina-pro-sales.vercel.app`) donde la cookie de sesión
 * NO viaja — abrirlo en el panel mostraría un login en vez del pedido. Con el
 * número, `urlVerPedido` la arma de cero contra el dominio bueno. Ver el ⚠️ de
 * `urlVerPedido`, que es la misma trampa.
 *
 * Se busca primero en la url (es lo que toda nota de pedido tiene hoy) y, si no
 * está, en la cabecera `📦 Pedido X ·` — que es lo único que `textoNotaPedido`
 * garantiza cuando el CRM no mandó link.
 */
const RE_URL_PEDIDO = /https?:\/\/\S+\/dashboard\/pedido\/([^\s?#/]+)/
const RE_CABECERA_PEDIDO = /📦\s*Pedido\s+([^\s·]+)/

export function pedidoIdDeNota(texto) {
  const t = String(texto ?? '')
  const enUrl = t.match(RE_URL_PEDIDO)
  if (enUrl) {
    // El link se guardó escapado (`urlVerPedido` escapa al armarlo); acá se
    // desescapa para volver al número tal cual es. Si viniera mal escapado,
    // `decodeURIComponent` tira: nos quedamos con el crudo antes que perder el
    // botón.
    try { return decodeURIComponent(enUrl[1]) } catch { return enUrl[1] }
  }
  const enCabecera = t.match(RE_CABECERA_PEDIDO)
  return enCabecera ? enCabecera[1] : ''
}

/**
 * Lee el aviso "acá va la hoja del pedido, ya hecha foto", o null si no es de
 * fiar.
 *
 * ⚠️ DE DÓNDE SALE LA IMAGEN: la dibuja el CRM, no el inbox. La pantalla de un
 * pedido abierta en modo `embed` —o sea, dentro de nuestro iframe— tiene un
 * botón «📤 Enviar al cliente» que arma la hoja como JPG y nos la pasa por
 * `postMessage` metida en un `data:` URL. El inbox no la genera ni la pide: la
 * RECIBE y la manda al chat como una foto más.
 *
 * ⚠️ POR QUÉ SE VALIDA EL ORIGEN: ese `postMessage` cruza de un dominio a otro
 * (`crm.apps.mandarinaec.com` → `inbox.apps.mandarinaec.com`), y `window`
 * recibe `message` de CUALQUIERA: extensiones del navegador, las herramientas de
 * React, cualquier pestaña que tenga una referencia a esta ventana. Sin
 * comprobar el origen exacto y la forma exacta, una página abierta en otra
 * pestaña podría hacernos mandarle una foto suya a un cliente por nuestro
 * WhatsApp. Igual que `leerAvisoPedido`, y por lo mismo.
 *
 * ⚠️ Y quien llama tiene que comprobar ADEMÁS que `evento.source` sea SU
 * iframe: en el celular el panel de escritorio sigue montado (solo lo esconde
 * el CSS), así que puede haber dos vistas del pedido a la vez y un solo aviso lo
 * escucharían las dos — el cliente recibiría la hoja por duplicado.
 *
 * La imagen se exige `data:image/jpeg;base64,…` y nada más. Un `https://…` ahí
 * sería el inbox descargando lo que otro le diga y reenviándolo a un cliente; un
 * `image/svg+xml` es código disfrazado de imagen.
 */
const RE_JPG_BASE64 = /^data:image\/jpe?g;base64,[A-Za-z0-9+/]+={0,2}$/

export function leerHojaPedido(evento) {
  if (!evento || evento.origin !== CRM) return null
  const d = evento.data
  if (!d || typeof d !== 'object') return null
  if (d.tipo !== 'hoja-pedido') return null
  if (!d.pedidoId) return null
  if (typeof d.imagen !== 'string' || !RE_JPG_BASE64.test(d.imagen)) return null
  return { pedidoId: String(d.pedidoId), imagen: d.imagen }
}

/** Lo que WhatsApp acepta de una foto. Más que esto, Meta la rechaza. */
export const MAX_HOJA_BYTES = 5 * 1024 * 1024

/**
 * Cuánto pesa de verdad un `data:` URL, sin tener que decodificarlo.
 *
 * Sirve para avisar ANTES de mandar: si la hoja se pasa del límite de WhatsApp,
 * decirlo con el peso en la mano es mucho más útil que un "no se pudo enviar"
 * que llega de Meta tres segundos después.
 */
export function bytesDeDataUrl(dataUrl) {
  const s = String(dataUrl ?? '')
  const coma = s.indexOf(',')
  if (coma < 0) return 0
  const b64 = s.slice(coma + 1)
  const relleno = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - relleno)
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
