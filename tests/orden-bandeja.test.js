import test from 'node:test'
import assert from 'node:assert'
import { ordenarBandeja } from '../lib/orden-bandeja.js'

const conv = (telefono, ultimoMensaje) => ({ telefono, last: { timestamp: ultimoMensaje } })

// Ana escribió hace mucho y sigue esperando; Beto acaba de escribir.
const ANA  = conv('593999000001', '2026-08-08T10:00:00Z')
const BETO = conv('593999000002', '2026-08-08T16:00:00Z')
const espera = {
  '593999000001': '2026-08-08T09:00:00Z',   // Ana lleva esperando desde las 9
  '593999000002': '2026-08-08T15:55:00Z',   // Beto, desde hace 5 minutos
}
const esperandoDesde = (tel) => espera[tel] || null

test('en Pendientes manda el que lleva mas esperando (FIFO)', () => {
  const r = ordenarBandeja([BETO, ANA], 'pendiente', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000001', '593999000002'])
})

test('en las demas bandejas sigue mandando el mas reciente', () => {
  const r = ordenarBandeja([ANA, BETO], 'atendido', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000002', '593999000001'])
})

test('FIFO usa el ultimo ENTRANTE, no el ultimo mensaje', () => {
  // A Beto le salio un mensaje NUESTRO despues (un seguimiento del cron), asi
  // que su ultimo mensaje es mas nuevo que el de Ana. Pero Beto escribio antes
  // que Ana, asi que sigue delante en la cola: lo que se ordena es cuanto lleva
  // esperando LA PERSONA, no cuando tocamos nosotros el chat.
  //
  // ⚠️ Esto es un SEGURO, no un problema observado: medido el 8-ago-2026, las
  // 18 conversaciones pendientes de MANDI tenian las dos fechas identicas
  // (diferencia maxima 0,0 h), porque contestar saca el chat de Pendientes y
  // los saludos automaticos corren segundos despues. Se cubre igual porque el
  // campo ya viene en la ficha y cuesta una linea; el dia que un seguimiento
  // caiga sobre un chat pendiente, la cola no miente.
  const beto = conv('593999000002', '2026-08-08T23:59:00Z')
  const r = ordenarBandeja([beto, ANA], 'pendiente', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000001', '593999000002'])
})

test('sin dato de espera cae al ultimo mensaje, no al fondo', () => {
  const sinDato = conv('593999000003', '2026-08-08T08:00:00Z')
  const r = ordenarBandeja([ANA, sinDato], 'pendiente', () => null)
  // Ordena por last.timestamp: el de las 08:00 va primero.
  assert.deepEqual(r.map(c => c.telefono), ['593999000003', '593999000001'])
})

test('las fechas invalidas van al final y no rompen el orden del resto', () => {
  const roto = { telefono: '593999000004', last: { timestamp: 'no-es-fecha' } }
  const r = ordenarBandeja([roto, BETO, ANA], 'pendiente', esperandoDesde)
  assert.equal(r[r.length - 1].telefono, '593999000004')
  assert.deepEqual(r.slice(0, 2).map(c => c.telefono), ['593999000001', '593999000002'])
})

test('no muta el arreglo original', () => {
  const original = [BETO, ANA]
  ordenarBandeja(original, 'pendiente', esperandoDesde)
  assert.deepEqual(original.map(c => c.telefono), ['593999000002', '593999000001'])
})

test('tolera entradas vacias o basura sin lanzar', () => {
  assert.deepEqual(ordenarBandeja(null, 'pendiente', esperandoDesde), [])
  assert.deepEqual(ordenarBandeja([], 'pendiente', esperandoDesde), [])
  assert.equal(ordenarBandeja([ANA], 'pendiente', null).length, 1)
})
