// El inbox guarda los teléfonos como 593999989663 y el CRM exige 0999989663.
// Si la conversión falla, la precarga traba el formulario en vez de ayudar.
import test from 'node:test'
import assert from 'node:assert'
import { celularEcuador, urlPedidoManual, leerAvisoPedido, textoNotaPedido, hayQueConfirmarDescarte, AVISO_DESCARTAR_PEDIDO } from '../lib/pedido-manual.js'

test('convierte el formato de WhatsApp al del CRM', () => {
  assert.strictEqual(celularEcuador('593999989663'), '0999989663')
  assert.strictEqual(celularEcuador('593987654321'), '0987654321')
})

test('aguanta el + y los espacios', () => {
  assert.strictEqual(celularEcuador('+593 99 998 9663'), '0999989663')
})

test('si ya viene en formato local lo deja igual', () => {
  assert.strictEqual(celularEcuador('0999989663'), '0999989663')
})

test('un número que no es de Ecuador devuelve vacío', () => {
  // Vacío = "no precargues". Mejor que meter algo que el CRM va a rechazar.
  assert.strictEqual(celularEcuador('12025550143'), '')
  assert.strictEqual(celularEcuador(''), '')
  assert.strictEqual(celularEcuador(null), '')
})

test('la URL lleva embed, celular y nombre, escapados', () => {
  const url = new URL(urlPedidoManual('593999989663', 'Ana & Cía'))
  assert.strictEqual(url.origin, 'https://crm.apps.mandarinaec.com')
  assert.strictEqual(url.pathname, '/dashboard/nuevo-pedido')
  assert.strictEqual(url.searchParams.get('embed'), '1')
  assert.strictEqual(url.searchParams.get('celular'), '0999989663')
  assert.strictEqual(url.searchParams.get('nombre'), 'Ana & Cía')
})

test('si el celular no convierte, no se manda el parámetro', () => {
  const url = new URL(urlPedidoManual('12025550143', 'Bob'))
  assert.strictEqual(url.searchParams.get('celular'), null)
  assert.strictEqual(url.searchParams.get('nombre'), 'Bob')
})

test('acepta el aviso del CRM', () => {
  const aviso = leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' },
  })
  assert.deepStrictEqual(aviso, { pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' })
})

test('RECHAZA un mensaje de otro origen', () => {
  // Lo esencial: un iframe recibe mensajes de cualquiera. Sin este filtro,
  // cualquier página podría hacernos marcar ventas falsas.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://evil.com',
    data: { tipo: 'pedido-creado', pedidoId: 'FALSO', montoTotal: 1, url: 'x' },
  }), null)
})

test('RECHAZA otro tipo de mensaje', () => {
  // Las extensiones del navegador y las herramientas de React mandan mensajes
  // al mismo tiempo; hay que ignorarlos sin romperse.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'otra-cosa', pedidoId: 'X' },
  }), null)
})

test('RECHAZA un aviso sin número de pedido', () => {
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', montoTotal: 5 },
  }), null)
})

// ── La nota que queda escrita ────────────────────────────────────────────────
// La nota es registro PERMANENTE y no se puede editar desde el inbox. Como
// `leerAvisoPedido` solo exige `pedidoId`, un aviso al que le falte el monto o
// el link NO puede dejar la palabra `undefined` escrita para siempre.

// Atajo: arma el aviso como lo haría el navegador de verdad, pasando por el
// mismo `leerAvisoPedido` que usa el componente. Así la prueba demuestra el
// camino completo y no una forma inventada a mano.
const avisoDelCrm = (data) => leerAvisoPedido({
  origin: 'https://crm.apps.mandarinaec.com',
  data: { tipo: 'pedido-creado', ...data },
})

test('la nota completa lleva el monto y el link', () => {
  assert.strictEqual(
    textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm/p/1' })),
    '📦 Pedido MAN-AND-1 · $42.5\nhttps://crm/p/1'
  )
})

test('sin montoTotal NO escribe $undefined', () => {
  const nota = textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-2', url: 'https://crm/p/2' }))
  assert.ok(!nota.includes('undefined'), `la nota trae undefined: ${nota}`)
  assert.strictEqual(nota, '📦 Pedido MAN-AND-2 · sin monto\nhttps://crm/p/2')
})

test('sin url NO agrega una línea con undefined', () => {
  const nota = textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-3', montoTotal: 18 }))
  assert.ok(!nota.includes('undefined'), `la nota trae undefined: ${nota}`)
  assert.strictEqual(nota, '📦 Pedido MAN-AND-3 · $18')
  assert.strictEqual(nota.split('\n').length, 1, 'no debe quedar una segunda línea vacía')
})

test('sin monto NI url la nota igual sirve', () => {
  const nota = textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-4' }))
  assert.ok(!nota.includes('undefined'), `la nota trae undefined: ${nota}`)
  assert.strictEqual(nota, '📦 Pedido MAN-AND-4 · sin monto')
})

test('un monto de 0 es un monto, no un vacío', () => {
  // Ojo con `||`: un pedido de $0 (cortesía, cambio) tiene monto y hay que
  // escribirlo, no reemplazarlo por "sin monto".
  assert.strictEqual(
    textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-5', montoTotal: 0 })),
    '📦 Pedido MAN-AND-5 · $0'
  )
})

test('no lanza con basura', () => {
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: 'hola' }), null)
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: null }), null)
  assert.strictEqual(leerAvisoPedido({}), null)
  assert.strictEqual(leerAvisoPedido(null), null)
})

// ── ¿Preguntar antes de cambiar de chat? ─────────────────────────────────────
// Decisión de Rodrigo: el asistente del CRM son 4 pasos y un clic distraído en
// el chat de al lado no puede tirar todo sin aviso. Como el formulario está en
// un iframe de otro origen, NO se puede saber si hay algo escrito: se pregunta
// siempre que esté abierto, y el texto se redacta para no mentir si está vacío.

const NADA = { escritorio: false, cajon: false }

test('sin el manual abierto NO se pregunta nada', () => {
  // Es el 99,9% de los clics: cambiar de chat tiene que seguir siendo instantáneo.
  assert.strictEqual(hayQueConfirmarDescarte(NADA, '593999989663', '593987654321'), false)
  assert.strictEqual(hayQueConfirmarDescarte({}, '593999989663', null), false)
  assert.strictEqual(hayQueConfirmarDescarte(null, '593999989663', null), false)
})

test('con el manual abierto en escritorio se pregunta', () => {
  assert.strictEqual(
    hayQueConfirmarDescarte({ escritorio: true, cajon: false }, '593999989663', '593987654321'),
    true
  )
})

test('con el manual abierto en el cajón del celular TAMBIÉN se pregunta', () => {
  // Los dos paneles cambian de conversación; olvidar el del celular es el bug
  // de siempre en este archivo.
  assert.strictEqual(
    hayQueConfirmarDescarte({ escritorio: false, cajon: true }, '593999989663', '593987654321'),
    true
  )
})

test('cerrar el chat (destino null) también pregunta', () => {
  // Cambiar de bandeja y cambiar de canal cierran el chat abierto: el formulario
  // se pierde igual que al saltar a otro cliente.
  assert.strictEqual(hayQueConfirmarDescarte({ escritorio: true }, '593999989663', null), true)
})

test('volver a tocar el MISMO chat no pregunta', () => {
  // No se pierde nada, así que preguntar sería puro ruido.
  assert.strictEqual(hayQueConfirmarDescarte({ escritorio: true }, '593999989663', '593999989663'), false)
  // Y da igual el formato con el que venga el teléfono.
  assert.strictEqual(hayQueConfirmarDescarte({ escritorio: true }, 593999989663, '593999989663'), false)
})

test('el aviso no afirma que haya algo escrito', () => {
  // No podemos leer dentro del iframe del CRM: si el aviso diera por hecho que
  // hay un pedido a medio llenar, mentiría cada vez que esté vacío.
  assert.ok(!/a medio llenar/i.test(AVISO_DESCARTAR_PEDIDO))
  assert.ok(/no podemos ver/i.test(AVISO_DESCARTAR_PEDIDO), 'debe admitir que no vemos adentro')
  assert.ok(/lo que hayas escrito/i.test(AVISO_DESCARTAR_PEDIDO), 'la pérdida va en condicional')
  // Los dos caminos, porque el navegador solo pone "Aceptar/Cancelar".
  assert.ok(/Aceptar =/.test(AVISO_DESCARTAR_PEDIDO))
  assert.ok(/Cancelar =/.test(AVISO_DESCARTAR_PEDIDO))
})
