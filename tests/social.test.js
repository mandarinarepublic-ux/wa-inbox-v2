import test from 'node:test'
import assert from 'node:assert'
import { claveConversacion, agruparConversaciones, normalizarEstado, filaAMensaje } from '../lib/social-agrupar.js'
import { cuerpoMensajeMeta, esHiloPublico } from '../lib/social-envio.js'
import { estadoVentana } from '../lib/social-ventana.js'

const base = { canal: 'IG', sender_id: '660529760420669', direccion: 'ENTRANTE', estado: 'PENDIENTE' }

test('la clave separa un comentario de un mensaje del mismo cliente', () => {
  const comentario = claveConversacion({ ...base, tipo: 'COMENTARIO' })
  const mensaje    = claveConversacion({ ...base, tipo: 'DM' })
  assert.notEqual(comentario, mensaje)
})

test('sin tipo se asume DM', () => {
  assert.equal(claveConversacion({ ...base, tipo: '' }), claveConversacion({ ...base, tipo: 'DM' }))
})

test('el comentario y el DM del mismo cliente son dos conversaciones', () => {
  const convs = agruparConversaciones([
    { ...base, id: 31, tipo: 'DM',         texto: 'Hooa amog9s', fecha: '2026-07-27T23:01:20Z' },
    { ...base, id: 36, tipo: 'COMENTARIO', texto: '😍',          fecha: '2026-07-27T23:20:00Z' },
  ])
  assert.equal(convs.length, 2)
  assert.deepEqual(convs.map(c => c.tipo).sort(), ['COMENTARIO', 'DM'])
})

test('el hilo de comentarios no arrastra los mensajes del DM', () => {
  const convs = agruparConversaciones([
    { ...base, id: 31, tipo: 'DM',         texto: 'Hooa amog9s', fecha: '2026-07-27T23:01:20Z' },
    { ...base, id: 36, tipo: 'COMENTARIO', texto: '😍',          fecha: '2026-07-27T23:20:00Z' },
  ])
  const comentarios = convs.find(c => c.tipo === 'COMENTARIO')
  assert.equal(comentarios.messages.length, 1)
  assert.equal(comentarios.messages[0].text, '😍')
})

test('una foto sin texto NO se descarta', () => {
  const convs = agruparConversaciones([
    { ...base, id: 28, tipo: 'DM', texto: '', media_url: 'https://x/f.jpg', fecha: '2026-07-27T23:00:22Z' },
  ])
  assert.equal(convs[0].messages.length, 1)
  assert.equal(convs[0].messages[0].image, 'https://x/f.jpg')
})

test('las conversaciones vienen de la mas reciente a la mas vieja', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, sender_id: 'viejo', tipo: 'DM', texto: 'a', fecha: '2026-07-01T10:00:00Z' },
    { ...base, id: 2, sender_id: 'nuevo', tipo: 'DM', texto: 'b', fecha: '2026-07-27T10:00:00Z' },
  ])
  assert.equal(convs[0].sender_id, 'nuevo')
})

test('una fila sin sender_id se ignora', () => {
  assert.equal(agruparConversaciones([{ ...base, sender_id: '', tipo: 'DM', texto: 'x' }]).length, 0)
})

test('normalizarEstado pasa a minusculas', () => {
  assert.equal(normalizarEstado('PENDIENTE'), 'pendiente')
  assert.equal(normalizarEstado('Atendido'), 'atendido')
})

test('normalizarEstado traduce el vocabulario viejo de SOCIAL', () => {
  assert.equal(normalizarEstado('VENTAPROCESO'), 'venta')
})

test('normalizarEstado cae a pendiente ante un valor desconocido o vacio', () => {
  assert.equal(normalizarEstado(''), 'pendiente')
  assert.equal(normalizarEstado(null), 'pendiente')
  assert.equal(normalizarEstado('loquesea'), 'pendiente')
})

test('filaAMensaje normaliza el estado sin importar como llegue de la base', () => {
  assert.equal(filaAMensaje({ ...base, estado: 'ATENDIDO' }).estado, 'atendido')
  assert.equal(filaAMensaje({ ...base, estado: 'VENTAPROCESO' }).estado, 'venta')
  assert.equal(filaAMensaje({ ...base, estado: null }).estado, 'pendiente')
})

test('agruparConversaciones expone el estado ya en minusculas', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, tipo: 'DM', texto: 'hola', estado: 'PENDIENTE', fecha: '2026-07-27T10:00:00Z' },
  ])
  assert.equal(convs[0].status, 'pendiente')
})

test('la temperatura es manual: una fila sin ella no borra la ya marcada', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, tipo: 'DM', texto: 'a', temperatura: 'caliente', fecha: '2026-07-27T10:00:00Z' },
    { ...base, id: 2, tipo: 'DM', texto: 'b', temperatura: '',         fecha: '2026-07-27T11:00:00Z' },
  ])
  assert.equal(convs[0].temperatura, 'caliente')
})

test('el ultimo valor de temperatura no vacio gana, igual que el estado', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, tipo: 'DM', texto: 'a', temperatura: 'frio',     fecha: '2026-07-27T10:00:00Z' },
    { ...base, id: 2, tipo: 'DM', texto: 'b', temperatura: 'caliente', fecha: '2026-07-27T11:00:00Z' },
  ])
  assert.equal(convs[0].temperatura, 'caliente')
})

test('sin temperatura en ninguna fila, la conversacion queda sin clasificar', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, tipo: 'DM', texto: 'a', fecha: '2026-07-27T10:00:00Z' },
  ])
  assert.equal(convs[0].temperatura, '')
})

test('el cuerpo de un mensaje de texto', () => {
  assert.deepEqual(cuerpoMensajeMeta({ texto: 'hola' }), { text: 'hola' })
})

test('el cuerpo de una imagen es un adjunto reutilizable', () => {
  assert.deepEqual(cuerpoMensajeMeta({ imagen: 'https://x/f.jpg' }), {
    attachment: { type: 'image', payload: { url: 'https://x/f.jpg', is_reusable: true } },
  })
})

test('Meta no admite texto y adjunto juntos', () => {
  assert.throws(() => cuerpoMensajeMeta({ texto: 'hola', imagen: 'https://x/f.jpg' }), /mismo mensaje/)
})

test('un mensaje vacio es un error', () => {
  assert.throws(() => cuerpoMensajeMeta({}), /vacio/)
})

test('esHiloPublico: IG + comment_id sin tipo es publico (el ataque real)', () => {
  // { canal:'IG', comment_id:'999' } sin tipo: la vieja guardia miraba solo
  // `tipo` y lo daba por 'DM', pero el ruteo por comment_id mandaba al
  // comentario público — un link de pago real se colaba a la vista de todos.
  // esHiloPublico es la única fuente de verdad para las dos decisiones.
  assert.equal(esHiloPublico({ canal: 'IG', comment_id: '999' }), true)
})

test('esHiloPublico: FB + comment_id sin tipo cae a DM (no publica)', () => {
  // Fija el comportamiento real: el comment_id por sí solo NO alcanza, hace
  // falta canal IG o tipo COMENTARIO. Un FB sin tipo se trata como privado.
  assert.equal(esHiloPublico({ canal: 'FB', comment_id: '1' }), false)
})

test('esHiloPublico: comentario declarado por tipo, sin importar el canal', () => {
  assert.equal(esHiloPublico({ tipo: 'COMENTARIO', canal: 'FB' }), true)
  assert.equal(esHiloPublico({ tipo: 'comentario', canal: 'IG', comment_id: '1' }), true)
})

test('esHiloPublico: DM de FB no es publico', () => {
  assert.equal(esHiloPublico({ tipo: 'DM', canal: 'FB' }), false)
  assert.equal(esHiloPublico({ canal: 'FB' }), false)
})

test('esHiloPublico: DM de IG sin comment_id no es publico', () => {
  assert.equal(esHiloPublico({ tipo: 'DM', canal: 'IG' }), false)
  assert.equal(esHiloPublico({ canal: 'IG' }), false)
})

const AHORA = new Date('2026-07-27T23:00:00Z').getTime()

test('recien escrito: ventana abierta con casi 24 h', () => {
  const v = estadoVentana('2026-07-27T22:30:00Z', AHORA)
  assert.equal(v.abierta, true)
  assert.equal(v.horasRestantes, 23)
})

test('a 23 h del mensaje queda 1 h', () => {
  const v = estadoVentana('2026-07-27T00:00:00Z', AHORA)
  assert.equal(v.abierta, true)
  assert.equal(v.horasRestantes, 1)
})

test('pasadas las 24 h la ventana esta cerrada', () => {
  const v = estadoVentana('2026-07-17T20:55:00Z', AHORA)
  assert.equal(v.abierta, false)
  assert.equal(v.horasRestantes, 0)
})

test('justo en el limite cuenta como cerrada', () => {
  const v = estadoVentana('2026-07-26T23:00:00Z', AHORA)
  assert.equal(v.abierta, false)
})

test('sin mensaje del cliente la ventana esta cerrada', () => {
  assert.equal(estadoVentana('', AHORA).abierta, false)
  assert.equal(estadoVentana(null, AHORA).abierta, false)
})

test('la etiqueta dice las horas que quedan, o que se cerro', () => {
  assert.equal(estadoVentana('2026-07-27T22:30:00Z', AHORA).etiqueta, '⏳ 23 h para responder')
  assert.equal(estadoVentana('2026-07-17T20:55:00Z', AHORA).etiqueta, '🔒 Cerrada')
})
