import test from 'node:test'
import assert from 'node:assert'
import { piezasDeRespuestaRapida } from '../lib/pieza-respuesta.js'

const contacto = { telefono: '593987498489', nombre: 'Ana', alias: '', phoneId: '1024077200794372' }

test('texto con botones y después sus fotos, citando al cliente', () => {
  const p = piezasDeRespuestaRapida({ id: 'a', text: 'Formas de pago', botones: ['Deuna', 'Tarjeta'],
    adjuntos: [{ tipo: 'imagen', url: 'https://x/1.jpg' }] }, contacto, 'wamid.1')
  assert.equal(p.length, 2)
  assert.equal(p[0].TipoMensaje, 'interactive_buttons')
  assert.equal(p[0].ContextoId, 'wamid.1')
  assert.equal(p[0].Canal, contacto.phoneId)
  assert.equal(p[1].ImagenURL, 'https://x/1.jpg')
})

test('una respuesta con carrusel sale como carrusel, no como texto solo', () => {
  const carrusel = [{ retailerId: '1', nombre: 'Goku' }, { retailerId: '2', nombre: 'Vegeta' }]
  const p = piezasDeRespuestaRapida({ id: 'b', text: 'Elige tu Dragon Ball', carrusel }, contacto)
  assert.equal(p[0].TipoMensaje, 'carrusel')
  assert.equal(JSON.parse(p[0].Productos).length, 2)
})

test('una respuesta con formulario sale como formulario de WhatsApp', () => {
  const p = piezasDeRespuestaRapida({ id: 'c', text: 'Ayúdanos con tus datos', formulario: 'datos_pedido' }, contacto, 'w')
  assert.equal(p[0].TipoMensaje, 'flow')
  assert.equal(p[0].Formulario, 'datos_pedido')
  assert.equal(p[0].Cuerpo, 'Ayúdanos con tus datos')
  assert.equal(p[0].Mensaje, undefined)
  assert.equal(p[0].ContextoId, 'w')
})

test('un formulario desconocido no rompe: sale el texto normal', () => {
  const p = piezasDeRespuestaRapida({ id: 'd', text: 'Hola', formulario: 'no_existe' }, contacto)
  assert.equal(p[0].Mensaje, 'Hola')
})

test('sin respuesta no hay piezas', () => assert.deepEqual(piezasDeRespuestaRapida(null, contacto), []))
