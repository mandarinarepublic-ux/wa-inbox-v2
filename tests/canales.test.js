// Cada número vive en una WABA distinta, y la Conversions API rechaza el evento
// si le mandamos la que no es. El mapa está en lib/canales.js y NO tiene forma de
// avisar cuando queda desactualizado: si mañana se migra un número (ya pasó el
// 28-jul con el 3326 de IND) el inbox sigue funcionando igual y lo único que se
// rompe es la atribución de la pauta, en silencio y semanas después.
//
// Los valores esperados salieron del tráfico real: entry[0].id de
// inbox.webhook_eventos, cruzado contra el phone_number_id de cada evento.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANALES, CANAL_GENERAL, phoneIdDeCanal, canalDePhoneId, wabaIdDePhoneId } from '../lib/canales.js'

test('cada canal declara su WABA', () => {
  for (const c of CANALES) {
    assert.ok(c.wabaId, `el canal ${c.id} no tiene wabaId`)
    assert.ok(c.phoneId, `el canal ${c.id} no tiene phoneId`)
  }
})

test('dos canales distintos no comparten WABA', () => {
  const wabas = CANALES.map(c => String(c.wabaId))
  assert.equal(new Set(wabas).size, wabas.length, 'hay canales apuntando a la misma WABA')
})

test('wabaIdDePhoneId resuelve el número de MANDI', () => {
  assert.equal(wabaIdDePhoneId('1024077200794372'), '1250794910496982')
})

test('wabaIdDePhoneId resuelve el número de REPUBLIC', () => {
  assert.equal(wabaIdDePhoneId('118582961194601'), '110133805380815')
})

test('wabaIdDePhoneId devuelve null si el número no es nuestro', () => {
  // Devolver el canal principal por defecto (como hace phoneIdDeCanal) sería
  // peor que no mandar nada: el evento saldría atribuido a la WABA equivocada.
  assert.equal(wabaIdDePhoneId('999999999999999'), null)
  assert.equal(wabaIdDePhoneId(''), null)
  assert.equal(wabaIdDePhoneId(undefined), null)
})

test('el canal GENERAL no tiene phone_id: significa TODOS los numeros', () => {
  assert.equal(phoneIdDeCanal(CANAL_GENERAL), null)
})

test('un id desconocido sigue cayendo en el canal principal, no en GENERAL', () => {
  // Protege el comportamiento viejo: una pestaña en cache con un id que ya no
  // existe debe ver MANDI, nunca la lista acumulada de los dos numeros.
  assert.equal(phoneIdDeCanal('NO_EXISTE'), CANALES[0].phoneId)
  assert.notEqual(phoneIdDeCanal('NO_EXISTE'), null)
})
