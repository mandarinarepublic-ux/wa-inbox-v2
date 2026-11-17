import { test } from 'node:test'
import assert from 'node:assert/strict'
import { elegirParaSombra, enParalelo } from '../lib/sombra-barrido.js'

// Casos tomados de los pendientes REALES de MANDI del 17-nov-2026.
const fila = (wamid, tipo, texto, fecha) => ({ telefono: '5939' + wamid, nombre: 'x', wamid, tipo, texto, fecha })

test('toma textos que piden algo y salta gracias, fotos y audios', () => {
  const r = elegirParaSombra([
    fila('a', 'texto', 'Qué tallas tienen?', '2026-11-17T17:00:00Z'),
    fila('b', 'texto', 'Gracias y buen día', '2026-11-17T16:00:00Z'),
    fila('c', 'imagen', '', '2026-11-17T15:00:00Z'),
    fila('d', 'audio', '', '2026-11-17T14:00:00Z'),
    fila('e', 'texto', 'Produbanco', '2026-11-17T04:48:00Z'),
    fila('f', 'texto', 'Muchas gracias', '2026-11-17T03:00:00Z'),
  ])
  // "Gracias y buen día" es una despedida (esAgradecimiento): no gasta tokens.
  assert.deepEqual(r.map(x => x.wamid), ['a', 'e'])
})

test('no repite lo ya revisado con éxito, del más nuevo al más viejo, con tope', () => {
  const ult = [
    fila('v', 'texto', 'Color negro y rojo', '2026-11-17T10:00:00Z'),
    fila('n', 'texto', 'como sería la forma de retiro y pago? En Quito', '2026-11-17T12:00:00Z'),
    fila('ya', 'texto', 'Tal vez los disponen aun??', '2026-11-17T14:00:00Z'),
  ]
  assert.deepEqual(elegirParaSombra(ult, new Set(['ya'])).map(x => x.wamid), ['n', 'v'])
  assert.deepEqual(elegirParaSombra(ult, new Set(), 1).map(x => x.wamid), ['ya'])
})

test('"??" solo SÍ va: el cliente está esperando', () => {
  assert.equal(elegirParaSombra([fila('q', 'texto', '??', '2026-11-17T10:00:00Z')]).length, 1)
})

test('enParalelo respeta el orden y el tope de concurrencia', async () => {
  let vivos = 0, max = 0
  const r = await enParalelo([5, 1, 3, 2], 2, async (x) => {
    vivos++; max = Math.max(max, vivos)
    await new Promise(res => setTimeout(res, x))
    vivos--
    return x * 10
  })
  assert.deepEqual(r, [50, 10, 30, 20])
  assert.equal(max, 2)
})
