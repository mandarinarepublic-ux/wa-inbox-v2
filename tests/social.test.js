import test from 'node:test'
import assert from 'node:assert'
import { claveConversacion, agruparConversaciones } from '../lib/social-agrupar.js'
import { admiteAdjuntos, cuerpoMensajeMeta } from '../lib/social-envio.js'

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

test('un DM admite adjuntos', () => {
  assert.equal(admiteAdjuntos('DM'), true)
})

test('un comentario NO admite adjuntos', () => {
  assert.equal(admiteAdjuntos('COMENTARIO'), false)
})

test('sin tipo se asume DM', () => {
  assert.equal(admiteAdjuntos(''), true)
  assert.equal(admiteAdjuntos(undefined), true)
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

test('un tipo desconocido NO admite adjuntos', () => {
  assert.equal(admiteAdjuntos('HISTORIA'), false)
})

test('null se asume DM y admite adjuntos', () => {
  assert.equal(admiteAdjuntos(null), true)
})
