// El inbox guarda los teléfonos como 593999989663 y el CRM exige 0999989663.
// Si la conversión falla, la precarga traba el formulario en vez de ayudar.
import test from 'node:test'
import assert from 'node:assert'
import { celularEcuador, urlPedidoManual, urlVerPedido, leerAvisoPedido, textoNotaPedido, hayQueConfirmarDescarte, AVISO_DESCARTAR_PEDIDO,
  ESCALA_PEDIDO, CORTE_ESCRITORIO_CRM, ANCHO_CONTENIDO_CRM,
  anchoInternoDelFormulario, anchoPanelMinimo, anchoPanelPedido,
  pedidoIdDeNota, leerHojaPedido, bytesDeDataUrl, MAX_HOJA_BYTES } from '../lib/pedido-manual.js'

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

// ── VER PEDIDO: mirar un pedido dentro del panel ─────────────────────────────
// El "Ver →" del historial abría una pestaña nueva y te sacaba del chat. Ahora
// se ve en el panel, con el mismo armazón que el PEDIDO MANUAL.

test('la url del pedido lleva embed y va al dominio del CRM', () => {
  const url = new URL(urlVerPedido('MAN-2026-0412'))
  assert.strictEqual(url.origin, 'https://crm.apps.mandarinaec.com')
  assert.strictEqual(url.pathname, '/dashboard/pedido/MAN-2026-0412')
  assert.strictEqual(url.searchParams.get('embed'), '1')
})

test('la url se arma en el MISMO dominio que el formulario', () => {
  // Es lo que hace que el iframe entre autenticado: la cookie `mp_sesion` es de
  // `.apps.mandarinaec.com`. La `url` que devuelve /api/cliente-pedidos se arma
  // con `MANDARINACRM_URL`, que puede apuntar al dominio de Vercel — ahí la
  // cookie NO viaja y el panel mostraría un login en vez del pedido. Por eso no
  // se usa esa url y se arma de cero con el número.
  assert.strictEqual(
    new URL(urlVerPedido('MAN-2026-0412')).origin,
    new URL(urlPedidoManual('593999989663', 'Ana')).origin
  )
})

test('el número de pedido va escapado', () => {
  // Los ids son limpios hoy, pero el id sale de la base y termina en un `src`:
  // que no pueda escribir la url es gratis.
  const url = new URL(urlVerPedido('MAN 2026/0412?x=1'))
  assert.strictEqual(url.pathname, '/dashboard/pedido/MAN%202026%2F0412%3Fx%3D1')
  assert.strictEqual(url.searchParams.get('embed'), '1')
  assert.strictEqual(url.searchParams.get('x'), null, 'el id no puede meter parámetros')
})

test('sin número de pedido no hay a dónde ir', () => {
  // Quien llama usa el vacío para no pintar el botón: un "Ver" que abre un
  // iframe en blanco es peor que no mostrarlo.
  assert.strictEqual(urlVerPedido(''), '')
  assert.strictEqual(urlVerPedido('   '), '')
  assert.strictEqual(urlVerPedido(null), '')
  assert.strictEqual(urlVerPedido(undefined), '')
})

test('un id numérico también sirve', () => {
  // El historial trae `pedido_id` de la base y no siempre es texto.
  assert.strictEqual(new URL(urlVerPedido(9981)).pathname, '/dashboard/pedido/9981')
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

// ── El botón "Ver pedido" de una NOTA ────────────────────────────────────────
// La nota deja el link del pedido y el inbox lo pintaba como <a target="_blank">:
// abría una pestaña nueva y te sacaba del inbox. Ahora se abre dentro del panel,
// igual que el "Ver →" del historial — y para eso hace falta el NÚMERO, no la
// url que trae la nota.

test('saca el número de pedido de la url de la nota', () => {
  const nota = textoNotaPedido(avisoDelCrm({
    pedidoId: 'MAN-2026-0412', montoTotal: 78.9,
    url: 'https://crm.apps.mandarinaec.com/dashboard/pedido/MAN-2026-0412',
  }))
  assert.strictEqual(pedidoIdDeNota(nota), 'MAN-2026-0412')
})

test('el número gana aunque la nota traiga la url del dominio VIEJO', () => {
  // Este es el motivo entero de sacar el número: las notas guardadas tienen el
  // link que armó el CRM con MANDARINACRM_URL, que puede ser el de Vercel. Ahí
  // la cookie no viaja y el panel mostraría un login. Con el número, la url se
  // arma de cero contra el dominio bueno.
  const nota = '📦 Pedido MAN-2026-0500 · $12\nhttps://mandarina-pro-sales.vercel.app/dashboard/pedido/MAN-2026-0500'
  assert.strictEqual(pedidoIdDeNota(nota), 'MAN-2026-0500')
  assert.strictEqual(
    new URL(urlVerPedido(pedidoIdDeNota(nota))).origin,
    'https://crm.apps.mandarinaec.com'
  )
})

test('sin url, el número sale de la cabecera 📦', () => {
  // `textoNotaPedido` deja la nota en una sola línea si el CRM no mandó link:
  // ahí antes no había botón, y el número igual está.
  assert.strictEqual(pedidoIdDeNota(textoNotaPedido(avisoDelCrm({ pedidoId: 'MAN-AND-4' }))), 'MAN-AND-4')
  assert.strictEqual(pedidoIdDeNota('📦 Pedido 9981 · $0'), '9981')
})

test('el número escapado en la url vuelve a su forma original', () => {
  assert.strictEqual(pedidoIdDeNota('mira https://crm.apps.mandarinaec.com/dashboard/pedido/MAN%202026'), 'MAN 2026')
})

test('una nota común no inventa un pedido', () => {
  // Sin esto, cualquier nota pintaría un botón que abre un iframe en blanco.
  assert.strictEqual(pedidoIdDeNota('Falta que envíe la foto del pago'), '')
  assert.strictEqual(pedidoIdDeNota('https://mandarinaec.com/products/algo'), '')
  assert.strictEqual(pedidoIdDeNota(''), '')
  assert.strictEqual(pedidoIdDeNota(null), '')
  assert.strictEqual(pedidoIdDeNota(undefined), '')
})

// ── La hoja del pedido que el CRM manda como foto ────────────────────────────
// El botón «📤 Enviar al cliente» vive DENTRO de la pantalla del pedido (en el
// iframe del CRM): dibuja la hoja como JPG y la manda por postMessage. Acá se
// valida ese mensaje, que cruza de un dominio a otro.

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ=='

const hojaDelCrm = (data) => leerHojaPedido({
  origin: 'https://crm.apps.mandarinaec.com',
  data: { tipo: 'hoja-pedido', ...data },
})

test('acepta la hoja que manda el CRM', () => {
  assert.deepStrictEqual(
    hojaDelCrm({ pedidoId: 'MAN-2026-0412', imagen: JPG }),
    { pedidoId: 'MAN-2026-0412', imagen: JPG }
  )
})

test('RECHAZA una hoja de otro origen', () => {
  // Lo esencial: `window` recibe `message` de cualquiera. Sin este filtro, una
  // página abierta en otra pestaña podría hacernos mandarle su foto a un cliente
  // por nuestro WhatsApp.
  assert.strictEqual(leerHojaPedido({
    origin: 'https://evil.com',
    data: { tipo: 'hoja-pedido', pedidoId: 'MAN-1', imagen: JPG },
  }), null)
  // Ni siquiera un subdominio parecido.
  assert.strictEqual(leerHojaPedido({
    origin: 'https://crm.apps.mandarinaec.com.evil.com',
    data: { tipo: 'hoja-pedido', pedidoId: 'MAN-1', imagen: JPG },
  }), null)
})

test('RECHAZA lo que no sea un JPG en base64', () => {
  // Un `https://…` sería el inbox descargando lo que otro le diga y
  // reenviándoselo a un cliente; un svg es código disfrazado de imagen.
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: 'https://evil.com/foto.jpg' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: 'data:image/svg+xml;base64,PHN2Zz4=' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: 'data:text/html;base64,PGI+' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: 'data:image/jpeg;base64,no válido!' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: '' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1' }), null)
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: { toString: () => JPG } }), null)
})

test('RECHAZA otro tipo de mensaje y uno sin pedido', () => {
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: JPG, tipo: 'otra-cosa' }), null)
  assert.strictEqual(hojaDelCrm({ imagen: JPG }), null)
  // El aviso de "pedido creado" NO es una hoja, y una hoja NO es un pedido nuevo:
  // los dos caminos comparten el iframe y no se pueden confundir.
  assert.strictEqual(hojaDelCrm({ pedidoId: 'M1', imagen: JPG, tipo: 'pedido-creado' }), null)
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'hoja-pedido', pedidoId: 'M1', imagen: JPG },
  }), null)
})

test('la hoja tampoco lanza con basura', () => {
  assert.strictEqual(leerHojaPedido({ origin: 'https://crm.apps.mandarinaec.com', data: 'hola' }), null)
  assert.strictEqual(leerHojaPedido({ origin: 'https://crm.apps.mandarinaec.com', data: null }), null)
  assert.strictEqual(leerHojaPedido({}), null)
  assert.strictEqual(leerHojaPedido(null), null)
})

test('el peso del data URL sale sin decodificarlo', () => {
  // Es para avisar ANTES de mandar: "pesa 7,2 MB y WhatsApp acepta 5" es mucho
  // más útil que un "no se pudo enviar" que llega de Meta después.
  const bytes = (n) => bytesDeDataUrl('data:image/jpeg;base64,' + Buffer.from('x'.repeat(n)).toString('base64'))
  for (const n of [1, 2, 3, 100, 4096]) assert.strictEqual(bytes(n), n, `falló con ${n} bytes`)
  assert.strictEqual(bytesDeDataUrl(''), 0)
  assert.strictEqual(bytesDeDataUrl(null), 0)
  assert.strictEqual(bytesDeDataUrl('sin coma'), 0)
  assert.strictEqual(MAX_HOJA_BYTES, 5 * 1024 * 1024)
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

test('la nota del pedido sale IDÉNTICA al texto de antes', () => {
  // El botón "🤖 Crear con IA" ya no existe, pero sus notas SÍ están en la base
  // y el formato tiene que seguir siendo uno solo. Con los tres campos —lo
  // normal— `textoNotaPedido` tiene que salir igual carácter por carácter que la
  // plantilla cruda que armaba aquel camino. Esta prueba es el candado.
  const plantillaVieja = (res) => `📦 Pedido ${res.pedidoId} · $${res.montoTotal}\n${res.url}`
  const respuestasDelAgente = [
    { pedidoId: 'MAN-2026-0412', montoTotal: 78.9,    url: 'https://crm.apps.mandarinaec.com/dashboard/pedido/MAN-2026-0412' },
    { pedidoId: 'MAN-2026-0413', montoTotal: 120,     url: 'https://crm.apps.mandarinaec.com/dashboard/pedido/MAN-2026-0413' },
    { pedidoId: 'MAN-2026-0414', montoTotal: '45.00', url: 'https://crm.apps.mandarinaec.com/dashboard/pedido/MAN-2026-0414' },
    { pedidoId: 9981,            montoTotal: 0,       url: 'https://crm.apps.mandarinaec.com/dashboard/pedido/9981' },
  ]
  for (const res of respuestasDelAgente) {
    assert.strictEqual(textoNotaPedido(res), plantillaVieja(res), `cambió la nota de ${res.pedidoId}`)
  }
})

test('el 👋 y la ✕ del cajón también preguntan', () => {
  // Los dos descartan el formulario sin cambiar de chat: el 👋 salta a
  // AUTOMATIZACIONES y la ✕ cierra el cajón del celular. Se expresan igual que
  // cerrar el chat — `destino` en null — para que pasen por el mismo guard.
  assert.strictEqual(hayQueConfirmarDescarte({ escritorio: true, cajon: false }, '593999989663', null), true)
  assert.strictEqual(hayQueConfirmarDescarte({ escritorio: false, cajon: true }, '593999989663', null), true)
  // Y sin el formulario abierto, ninguno de los dos molesta.
  assert.strictEqual(hayQueConfirmarDescarte(NADA, '593999989663', null), false)
})

// ── El ancho del panel con el formulario abierto ─────────────────────────────
// El CRM no ve el ancho del panel: ve `ancho ÷ ESCALA`. Y por debajo de 768 px
// internos se pasa SOLO a su diseño de celular (`md:` de Tailwind), sin avisar y
// sin que se caiga nada. Estas pruebas son el único aviso que hay.

test('el panel se abre justo al ancho del formulario', () => {
  assert.strictEqual(anchoPanelPedido(), 560)
  assert.strictEqual(anchoInternoDelFormulario(560), 800)
})

test('el ancho interno queda POR ENCIMA del corte de 768', () => {
  const interno = anchoInternoDelFormulario(anchoPanelPedido())
  assert.ok(interno > CORTE_ESCRITORIO_CRM, `interno ${interno} <= corte ${CORTE_ESCRITORIO_CRM}`)
})

test('ni angostando al mínimo con el asa se cruza el corte', () => {
  // El piso del asa con el manual abierto. Si esto se cruzara, el vendedor
  // arrastraría un poco y el formulario cambiaría de diseño a mitad del pedido.
  const interno = anchoInternoDelFormulario(anchoPanelMinimo())
  assert.ok(interno >= CORTE_ESCRITORIO_CRM, `interno ${interno} < corte ${CORTE_ESCRITORIO_CRM}`)
  assert.strictEqual(anchoPanelMinimo(), 538)
})

test('la relación aguanta si alguien cambia la ESCALA', () => {
  // Este es el punto de derivar el ancho en vez de escribirlo a mano: la perilla
  // se puede mover y el diseño no se rompe en silencio.
  for (const escala of [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 1]) {
    const minimo = anchoPanelMinimo(escala)
    const abierto = anchoPanelPedido(escala)
    assert.ok(anchoInternoDelFormulario(minimo, escala) >= CORTE_ESCRITORIO_CRM,
      `con escala ${escala} el mínimo ${minimo} deja el interno bajo el corte`)
    assert.ok(anchoInternoDelFormulario(abierto, escala) >= CORTE_ESCRITORIO_CRM,
      `con escala ${escala} el ancho de apertura ${abierto} deja el interno bajo el corte`)
    assert.ok(abierto >= minimo, `con escala ${escala} el ancho de apertura quedó bajo el mínimo`)
  }
})

test('casi no queda vacío a los lados', () => {
  // La queja de Rodrigo: ~2,5 cm de vacío por lado. El formulario ocupa
  // ANCHO_CONTENIDO_CRM internos, que en pantalla son esos por la escala.
  const enPantalla = ANCHO_CONTENIDO_CRM * ESCALA_PEDIDO
  const vacioPorLado = (anchoPanelPedido() - enPantalla) / 2
  assert.ok(vacioPorLado < 40, `quedan ${vacioPorLado}px de vacío por lado`)
  assert.ok(vacioPorLado > 0, 'el formulario no puede quedar más ancho que el panel')
})
