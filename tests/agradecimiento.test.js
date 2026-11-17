import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esAgradecimiento, esMensajeSinPedido } from '../lib/ia-ahorro.js'

// Los dos primeros son mensajes REALES de MANDI que gastaron tokens (17-nov-2026).
const SI = [
  'Muchas gracias y discúlpeme por la insistencia',
  'Gracias y buen día',
  'Gracias',
  'ok gracias',
  'Mil gracias 🙏🏻',
  'Muchas gracias, muy amable',
  'Gracias igualmente, bendiciones',
  'Dios le pague',
  'Listo, muchas gracias por todo',
  'Gracias Andrés, que tenga buen día',
]
const NO = [
  'Hola buena tarde',                       // llega un cliente: no se cierra
  'Buenas tardes',
  'Gracias, cuánto es el envío?',
  'gracias ya le transferí',                // hay que confirmar el pago
  'Gracias, le mando el comprobante',
  'Muchas gracias. Talla M por favor',
  'ok',                                     // en una venta "ok" es una respuesta
  'listo',
  'Gracias??',
  'Qué tallas tienen?',
]

test('agradecimientos y despedidas puros → sí', () => {
  for (const t of SI) assert.equal(esAgradecimiento(t), true, t)
})

test('si queda algo más que cortesía, o no agradece → no', () => {
  for (const t of NO) assert.equal(esAgradecimiento(t), false, t)
})

test('el agente tampoco se llama por una despedida', () => {
  assert.equal(esMensajeSinPedido('Muchas gracias y discúlpeme por la insistencia'), true)
  assert.equal(esMensajeSinPedido('Hola buena tarde'), false)
})
