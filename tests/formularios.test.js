import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowJsonDatosPedido, payloadFormulario, celularLocal, textoRespuestaFormulario, formularioValido, FORMULARIOS } from '../lib/formularios.js'
import { extraer } from '../lib/wa-mensaje.js'

test('el Flow JSON tiene las dos pantallas y la última cierra con todos los campos', () => {
  const j = flowJsonDatosPedido()
  assert.deepEqual(j.screens.map(s => s.id), ['FACTURACION', 'ENVIO'])
  assert.equal(j.screens[1].terminal, true)
  const form = j.screens[1].layout.children[0].children
  const footer = form.find(c => c.type === 'Footer')
  assert.equal(footer['on-click-action'].name, 'complete')
  const p = footer['on-click-action'].payload
  assert.equal(p.factura_correo, '${screen.FACTURACION.form.factura_correo}')
  assert.equal(p.envio_direccion, '${form.envio_direccion}')
  assert.equal(Object.keys(p).length, 10)
})

test('payload del mensaje: flow por NOMBRE, abre en FACTURACION y el token dice qué formulario es', () => {
  const p = payloadFormulario({ to: '593991234567' }, 'Llena tus datos', 'datos_pedido', { telefono: '593991234567', ahora: 123 })
  assert.equal(p.type, 'interactive')
  assert.equal(p.interactive.type, 'flow')
  const prm = p.interactive.action.parameters
  assert.equal(prm.flow_name, FORMULARIOS.datos_pedido.flowName)
  assert.equal(prm.flow_token, 'datos_pedido:123')
  assert.deepEqual(prm.flow_action_payload, { screen: 'FACTURACION', data: { celular: '0991234567' } })
  assert.ok(prm.flow_cta.length <= 30)
})

test('formulario desconocido o sin texto no se arma', () => {
  assert.equal(formularioValido('otro'), '')
  assert.throws(() => payloadFormulario({ to: '1' }, 'hola', 'otro'))
  assert.throws(() => payloadFormulario({ to: '1' }, '  ', 'datos_pedido'))
})

const nfm = (datos) => ({
  type: 'interactive',
  interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify({ flow_token: 'datos_pedido:1', ...datos }) } },
})

test('la respuesta llega como texto legible, con la provincia con tildes y sin referencia vacía', () => {
  const m = extraer(nfm({
    factura_nombre: 'Ana Pérez', factura_cedula: '1712345678', factura_correo: 'ana@x.com', factura_celular: '0991234567',
    envio_nombre: 'Ana Pérez', envio_celular: '0991234567', envio_provincia: 'MANABI', envio_ciudad: 'Manta',
    envio_direccion: 'Av. 4 y calle 13', envio_referencia: '',
  }))
  assert.equal(m.tipo, 'texto')
  assert.match(m.contenido, /Datos de facturación y envío/)
  assert.match(m.contenido, /Cédula\/RUC: 1712345678/)
  assert.match(m.contenido, /Provincia: Manabí/)
  assert.match(m.contenido, /Dirección: Av\. 4 y calle 13/)
  assert.doesNotMatch(m.contenido, /Referencia/)
})

test('un nfm_reply sin datos igual deja constancia (nunca vacío)', () => {
  assert.equal(textoRespuestaFormulario(nfm({}).interactive), '📝 Envió un formulario (sin datos)')
  assert.ok(extraer({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: 'xx' } } }).contenido)
})

test('un botón tocado sigue leyéndose como antes', () => {
  const m = extraer({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'rc_1', title: 'Sí, quiero' } } })
  assert.equal(m.contenido, 'Sí, quiero')
})

test('los dos celulares vienen prellenados con el número del chat', () => {
  const j = flowJsonDatosPedido()
  const forms = j.screens.map(sc => sc.layout.children[0])
  assert.deepEqual(forms.map(f => f['init-values']), [{ factura_celular: '${data.celular}' }, { envio_celular: '${data.celular}' }])
  const campos = forms.flatMap(f => f.children)
  assert.ok(campos.every(c => !('init-value' in c)), 'Meta no acepta init-value en un campo de Form')
  assert.ok(j.screens.every(sc => sc.data.celular))
  const nav = campos.find(c => c.type === 'Footer' && c['on-click-action'].name === 'navigate')
  assert.deepEqual(nav['on-click-action'].payload, { celular: '${data.celular}' })
})

test('celularLocal: formato ecuatoriano y extranjero', () => {
  assert.equal(celularLocal('593991234567'), '0991234567')
  assert.equal(celularLocal('991234567'), '0991234567')
  assert.equal(celularLocal('0991234567'), '0991234567')
  assert.equal(celularLocal('525512345678'), '+525512345678')
  assert.equal(celularLocal(''), '')
})

import { datosDesdeTexto, prefillPedido } from '../lib/formularios.js'
import { urlPedidoManual } from '../lib/pedido-manual.js'

const lleno = (extra = {}) => textoRespuestaFormulario(nfm({
  factura_nombre: 'Ana Pérez', factura_cedula: '0912345678', factura_correo: 'ana@x.com', factura_celular: '0991234567',
  envio_nombre: 'Ana Pérez', envio_celular: '0991234567', envio_provincia: 'GUAYAS', envio_ciudad: 'Guayaquil',
  envio_direccion: 'Av. 9 de Octubre 100 y Malecón', envio_referencia: 'Edificio azul', ...extra,
}).interactive)

test('🧾 del texto guardado se recuperan los campos (el Celular de cada bloque por separado)', () => {
  const d = datosDesdeTexto(lleno({ envio_celular: '0987654321' }))
  assert.equal(d.factura_cedula, '0912345678')
  assert.equal(d.factura_celular, '0991234567')
  assert.equal(d.envio_celular, '0987654321')
  assert.equal(d.envio_provincia, 'Guayas')
  assert.equal(datosDesdeTexto('Hola, quiero un hoodie'), null)
  assert.equal(datosDesdeTexto(''), null)
})

test('prefill para el CRM: cédula con su 0, ciudad aparte y la dirección con referencia y provincia', () => {
  const p = prefillPedido(datosDesdeTexto(lleno()))
  assert.deepEqual(p, {
    nombre: 'Ana Pérez', cedula: '0912345678', celular: '0991234567', email: 'ana@x.com', ciudad: 'Guayaquil',
    direccion: 'Dirección: Av. 9 de Octubre 100 y Malecón\nLugar de referencia: Edificio azul\nProvincia: Guayas',
  })
})

test('si recibe OTRA persona, va en la dirección para que llegue a la guía', () => {
  const p = prefillPedido(datosDesdeTexto(lleno({ envio_nombre: 'Luis Pérez', envio_celular: '0987654321' })))
  assert.match(p.direccion, /Recibe: Luis Pérez · 0987654321$/)
  assert.equal(p.nombre, 'Ana Pérez')
})

test('la URL del PEDIDO MANUAL lleva los datos del formulario por encima del perfil', () => {
  const u = new URL(urlPedidoManual('593990000000', 'Anita 🌸', prefillPedido(datosDesdeTexto(lleno()))))
  assert.equal(u.searchParams.get('nombre'), 'Ana Pérez')
  assert.equal(u.searchParams.get('celular'), '0991234567')
  assert.equal(u.searchParams.get('cedula'), '0912345678')
  assert.equal(u.searchParams.get('ciudad'), 'Guayaquil')
  assert.match(u.searchParams.get('direccion'), /^Dirección: Av\. 9/)
  // Sin formulario, como siempre
  const v = new URL(urlPedidoManual('593990000000', 'Anita'))
  assert.equal(v.searchParams.get('celular'), '0990000000')
  assert.equal(v.searchParams.get('cedula'), null)
})
