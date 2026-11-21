// Reaccionar con emoji a un mensaje del cliente (lib/reacciones.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reaccionesNuestras, seMuestraComoBurbuja, puedeReaccionar, siguienteReaccion, esReaccionNuestra } from '../lib/reacciones.js'

const AHORA = Date.parse('2026-10-08T15:00:00Z')
const cliente = { id: 'wamid.CLIENTE1', direccion: 'ENTRANTE', tipo: 'texto', mensaje: 'Ando buscando camisetas de Superman', timestamp: '2026-10-08T14:00:00Z' }
const reac = (emoji, ts, destino = 'wamid.CLIENTE1') => ({ id: `wamid.R${ts}`, direccion: 'SALIENTE', tipo: 'reaction', mensaje: emoji, contextoId: destino, timestamp: ts })

test('gana la ÚLTIMA reacción nuestra por fecha, aunque lleguen desordenadas', () => {
  const m = reaccionesNuestras([reac('👍', '2026-10-08T14:05:00Z'), reac('❤️', '2026-10-08T14:01:00Z')])
  assert.equal(m.get('wamid.CLIENTE1'), '👍')
})

test('una reacción vacía la QUITA', () => {
  const m = reaccionesNuestras([reac('❤️', '2026-10-08T14:01:00Z'), reac('', '2026-10-08T14:02:00Z')])
  assert.equal(m.get('wamid.CLIENTE1'), '')
})

test('las reacciones del CLIENTE no cuentan como nuestras', () => {
  const suya = { ...reac('😂', '2026-10-08T14:01:00Z'), direccion: 'ENTRANTE' }
  assert.equal(esReaccionNuestra(suya), false)
  assert.equal(reaccionesNuestras([suya]).size, 0)
})

test('nuestra reacción se esconde como burbuja SOLO si su mensaje está en pantalla', () => {
  const r = reac('❤️', '2026-10-08T14:01:00Z')
  assert.equal(seMuestraComoBurbuja(r, new Set(['wamid.CLIENTE1'])), false)
  // Sin el destino cargado se pinta igual: esconderla sería perder algo que pasó.
  assert.equal(seMuestraComoBurbuja(r, new Set(['wamid.OTRO'])), true)
  assert.equal(seMuestraComoBurbuja(cliente, new Set(['wamid.CLIENTE1'])), true)
})

test('se reacciona solo a mensajes del cliente, con wamid real y de menos de 30 días', () => {
  assert.equal(puedeReaccionar(cliente, AHORA), true)
  assert.equal(puedeReaccionar({ ...cliente, direccion: 'SALIENTE' }, AHORA), false)
  assert.equal(puedeReaccionar({ ...cliente, id: 'opt-123' }, AHORA), false)            // burbuja optimista
  assert.equal(puedeReaccionar({ ...cliente, tipo: 'reaction' }, AHORA), false)         // no se reacciona a una reacción
  assert.equal(puedeReaccionar({ ...cliente, timestamp: '2026-09-01T00:00:00Z' }, AHORA), false)
  assert.equal(puedeReaccionar({ ...cliente, timestamp: 'basura' }, AHORA), false)
})

test('tocar el mismo emoji lo quita; otro lo reemplaza', () => {
  assert.equal(siguienteReaccion('❤️', '❤️'), '')
  assert.equal(siguienteReaccion('❤️', '👍'), '👍')
  assert.equal(siguienteReaccion('', '❤️'), '❤️')
})

test('quitar se lee como "Reaccionó a un mensaje" al volver de la base: cuenta como quitada', () => {
  const m = reaccionesNuestras([reac('❤️', '2026-10-08T14:01:00Z'), reac('Reaccionó a un mensaje', '2026-10-08T14:02:00Z')])
  assert.equal(m.get('wamid.CLIENTE1'), '')
  assert.equal(reaccionesNuestras([reac('🙏', '2026-10-08T14:01:00Z')]).get('wamid.CLIENTE1'), '🙏')
})

// ── Reacciones del CLIENTE a mensajes nuestros (20-nov-2026) ──────────────
import { reaccionesDelCliente, esReaccionDelCliente, emojiDeReaccion } from '../lib/reacciones.js'

const nuestro = { id: 'wamid.NUESTRO1', direccion: 'SALIENTE', tipo: 'texto', mensaje: 'Te paso el catálogo', timestamp: '2026-11-20T14:00:00Z' }
const suya = (texto, ts, destino = 'wamid.NUESTRO1') => ({ id: `wamid.S${ts}`, direccion: 'ENTRANTE', tipo: 'reaction', mensaje: texto, contextoId: destino, timestamp: ts })

test('la reacción del cliente se lee SIN la etiqueta: "❤️ Reaccionó a un mensaje" → ❤️', () => {
  assert.equal(emojiDeReaccion(suya('❤️ Reaccionó a un mensaje', '2026-11-20T14:01:00Z')), '❤️')
  assert.equal(emojiDeReaccion(suya('👍🏻 Reaccionó a un mensaje', '2026-11-20T14:01:00Z')), '👍🏻')
  // Quitarla llega sin emoji: queda la etiqueta pelada → cuenta como quitada.
  assert.equal(emojiDeReaccion(suya('Reaccionó a un mensaje', '2026-11-20T14:01:00Z')), '')
})

test('gana la ÚLTIMA reacción del cliente, y quitarla la borra', () => {
  const m = reaccionesDelCliente([suya('👍 Reaccionó a un mensaje', '2026-11-20T14:05:00Z'), suya('❤️ Reaccionó a un mensaje', '2026-11-20T14:01:00Z')])
  assert.equal(m.get('wamid.NUESTRO1'), '👍')
  const q = reaccionesDelCliente([suya('❤️ Reaccionó a un mensaje', '2026-11-20T14:01:00Z'), suya('Reaccionó a un mensaje', '2026-11-20T14:02:00Z')])
  assert.equal(q.get('wamid.NUESTRO1'), '')
})

test('las nuestras y las del cliente no se mezclan', () => {
  assert.equal(esReaccionDelCliente(reac('❤️', '2026-10-08T14:01:00Z')), false)
  assert.equal(reaccionesNuestras([suya('❤️ Reaccionó a un mensaje', '2026-11-20T14:01:00Z')]).size, 0)
})

test('☠️ la del cliente NO sale como línea suelta si nuestro mensaje está en pantalla; si no está, SÍ', () => {
  const r = suya('❤️ Reaccionó a un mensaje', '2026-11-20T14:01:00Z')
  assert.equal(seMuestraComoBurbuja(r, new Set(['wamid.NUESTRO1'])), false)
  // Sin el destino cargado se pinta igual: esconderla sería perder algo que pasó.
  assert.equal(seMuestraComoBurbuja(r, new Set(['wamid.OTRO'])), true)
  // Un mensaje normal siempre se pinta.
  assert.equal(seMuestraComoBurbuja(nuestro, new Set(['wamid.NUESTRO1'])), true)
  // Una reacción sin destino (fila rara) se pinta suelta, nunca desaparece.
  assert.equal(seMuestraComoBurbuja({ ...r, contextoId: '' }, new Set(['wamid.NUESTRO1'])), true)
})
