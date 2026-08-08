// PEDIDO MANUAL: abrir la pantalla `nuevo-pedido` del CRM dentro del panel.
//
// No se reimplementa ningún formulario. El CRM ya sabe de clientes, productos,
// pagos, factura, mapa y fecha de entrega; acá solo se arma la URL y se escucha
// la respuesta.

const CRM = 'https://crm.apps.mandarinaec.com'

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
 * El texto de la nota que queda en el chat cuando se crea el pedido.
 *
 * ⚠️ La nota es registro PERMANENTE y desde el inbox no se puede editar: la
 * palabra `undefined` no puede terminar ahí. `leerAvisoPedido` solo exige el
 * `pedidoId` — el monto y el link son opcionales y hay que tratarlos como tales:
 * si el monto no viene se dice "sin monto", y si no viene el link la nota se
 * queda en una sola línea en vez de agregar una que diga `undefined`.
 */
export function textoNotaPedido(aviso) {
  const monto = aviso?.montoTotal
  const hayMonto = monto !== undefined && monto !== null && monto !== ''
  const cabecera = `📦 Pedido ${aviso?.pedidoId} · ${hayMonto ? `$${monto}` : 'sin monto'}`
  const url = aviso?.url ? String(aviso.url).trim() : ''
  return url ? `${cabecera}\n${url}` : cabecera
}
