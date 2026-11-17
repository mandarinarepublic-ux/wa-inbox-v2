import test from 'node:test'
import assert from 'node:assert'
import { esMensajeSinPedido, esElUltimo } from '../lib/ia-ahorro.js'

for (const c of ['gracias', 'Muchas gracias', 'ok gracias', 'Listo, muchas gracias', 'Gracias!', '🤗', '🗿', '.', '👆🏻', '', 'muy amable', 'Perfecto gracias amigo']) {
  test(`"${c}" no pide nada → no se llama a la IA`, () => assert.equal(esMensajeSinPedido(c), true))
}
for (const c of ['ok', 'si', 'listo', 'hola', 'Buenas tardes', '??', '?', 'gracias, y el envío?', 'talla L', 'esta', 'Hola buena tarde', 'gracias pero no me llegó']) {
  test(`"${c}" SÍ puede pedir algo → se atiende`, () => assert.equal(esMensajeSinPedido(c), false))
}

test('ráfaga: solo contesta el último mensaje', () => {
  const a = { id: 'wamid.A', fecha: '2026-11-17T19:31:47Z' }
  const b = { id: 'wamid.B', fecha: '2026-11-17T19:32:04Z' }
  const c = { id: 'wamid.C', fecha: '2026-11-17T19:32:07Z' }
  assert.equal(esElUltimo(a, [a, b, c]), false)
  assert.equal(esElUltimo(b, [b, c]), false)
  assert.equal(esElUltimo(c, [c]), true)
})
test('dos mensajes en el mismo segundo: contesta exactamente uno', () => {
  const a = { id: 'wamid.A', fecha: '2026-11-17T19:32:07Z' }
  const b = { id: 'wamid.B', fecha: '2026-11-17T19:32:07Z' }
  assert.equal(esElUltimo(a, [a, b]) !== esElUltimo(b, [a, b]), true)
})
