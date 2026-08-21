// ☠️ ESTE ARCHIVO EXISTE POR UN BUG REAL DEL 21-ago-2026.
//
// Rodrigo armó una respuesta rápida con un audio en la computadora, la guardó sin
// que apareciera ningún error, y el audio nunca llegó a la base. El editor lo
// guardaba bien y la base lo aceptaba bien: el campo moría en `writeReply`, que
// arma el cuerpo enumerando campos A MANO y no incluía `adjuntos`.
//
// Es el patrón de siempre en este proyecto: un intermediario que lista campos
// uno por uno y se queda callado cuando aparece uno nuevo. Nada falla, nada
// avisa, y el dato simplemente no existe.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cuerpoDeRespuesta } from '../lib/api-client.js'

const FOTO  = 'https://x/fotos/MANDI/a.jpg'
const AUDIO = 'https://x/audios/MANDI/b.ogg'

test('el audio VIAJA — el bug que dejó a Rodrigo sin su nota de voz', () => {
  const cuerpo = cuerpoDeRespuesta('add', {
    id: '1', text: 'Hola',
    adjuntos: [{ tipo: 'imagen', url: FOTO }, { tipo: 'audio', url: AUDIO }],
  })
  assert.ok(Array.isArray(cuerpo.adjuntos), 'sin esto el audio no sale del navegador')
  assert.equal(cuerpo.adjuntos.length, 2)
  assert.equal(cuerpo.adjuntos[1].url, AUDIO)
})

test('el ORDEN se conserva hasta el envío', () => {
  // El orden es el que ve el cliente. Si se perdiera acá, daría igual lo que haga
  // el editor: la respuesta llegaría en otro orden.
  const cuerpo = cuerpoDeRespuesta('edit', {
    id: '1', text: 'x',
    adjuntos: [{ tipo: 'audio', url: AUDIO }, { tipo: 'imagen', url: FOTO }],
  })
  assert.deepEqual(cuerpo.adjuntos.map(a => a.tipo), ['audio', 'imagen'])
})

test('las respuestas sin adjuntos siguen mandando lo de siempre', () => {
  const cuerpo = cuerpoDeRespuesta('add', { id: '1', text: 'Hola', imageUrl: FOTO })
  assert.equal(cuerpo.imagenUrl, FOTO)
  assert.deepEqual(cuerpo.adjuntos, [])
  assert.deepEqual(cuerpo.botones, [])
})

test('nunca manda undefined en los campos que la ruta espera', () => {
  // Un `undefined` desaparece al serializar a JSON, y la ruta lo recibiría como
  // "no vino" en vez de "vacío" — que es como se borra un dato sin querer.
  const cuerpo = cuerpoDeRespuesta('add', {})
  for (let i = 1; i <= 10; i++) {
    const k = i === 1 ? 'imagenUrl' : `imagenUrl${i}`
    assert.notEqual(cuerpo[k], undefined, `${k} no puede ser undefined`)
  }
  assert.notEqual(cuerpo.adjuntos, undefined)
  assert.notEqual(cuerpo.botones, undefined)
})

test('un `adjuntos` que no es lista no rompe el guardado', () => {
  assert.deepEqual(cuerpoDeRespuesta('add', { adjuntos: 'basura' }).adjuntos, [])
  assert.deepEqual(cuerpoDeRespuesta('add', { adjuntos: null }).adjuntos, [])
})
