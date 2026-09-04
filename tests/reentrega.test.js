import test from 'node:test'
import assert from 'node:assert'
import { reparacionesDeReentrega } from '../lib/reentrega.js'

// ── EL BUG ────────────────────────────────────────────────────────
// Meta manda el MISMO wamid dos veces: primero un placeholder `unsupported`
// ("This message is unavailable.") y ~0,4 s después el mensaje de verdad, con
// su texto y su referral de pauta. Como el insert va con `ignoreDuplicates`,
// ganaba el primero: 135 mensajes quedaron como "no podemos mostrar" y 128
// perdieron de qué anuncio venía el cliente.
//
// Medido en producción: en MANDI el placeholder llegó primero en 10 de 10.

const real = (extra = {}) => ({
  tipo: 'texto', texto: '¡Hola! Quiero más información', media_id: null, media_url: null,
  contexto_id: null, referral: null, raw: { type: 'text' }, botones: null,
  telefono: '593990800915', conversacion_id: 'CONV-1', direccion: 'ENTRANTE',
  fecha: '2026-08-28T00:46:16.000Z', ...extra,
})

test('un mensaje REAL repara el placeholder, y solo si lo guardado es el placeholder', () => {
  const reps = reparacionesDeReentrega(real())
  assert.equal(reps.length, 1)
  assert.deepEqual(reps[0].donde, { tipo: 'unsupported' })
  assert.equal(reps[0].set.texto, '¡Hola! Quiero más información')
  assert.equal(reps[0].set.tipo, 'texto')
})

// ☠️ El bug al revés: si se quita `ignoreDuplicates` a secas, un placeholder
// que llegue TARDE pisa un mensaje bueno. En IND el real llegó primero en 20
// de 139 casos, así que este camino existe de verdad.
test('un placeholder que llega tarde NO pisa nada', () => {
  const reps = reparacionesDeReentrega(real({ tipo: 'unsupported', texto: '⚠️ ...', referral: null }))
  assert.deepEqual(reps, [])
})

test('el mensaje real arrastra el referral al reparar el placeholder', () => {
  const ref = { headline: 'Mandarina Republic', source_id: '844355134399396' }
  const reps = reparacionesDeReentrega(real({ referral: ref }))
  assert.deepEqual(reps[0].set.referral, ref)
})

test('un referral que llega despues rellena un referral vacio, nunca pisa uno lleno', () => {
  const ref = { headline: 'X-Men' }
  const reps = reparacionesDeReentrega(real({ referral: ref }))
  const soloRef = reps.find(r => 'referral' in r.donde)
  assert.ok(soloRef, 'falta la reparación del referral')
  assert.equal(soloRef.donde.referral, null, 'la guardia tiene que exigir referral NULO')
  assert.deepEqual(soloRef.set, { referral: ref })
})

test('un placeholder CON referral igual rellena el referral vacio', () => {
  const ref = { headline: 'X-Men' }
  const reps = reparacionesDeReentrega(real({ tipo: 'unsupported', referral: ref }))
  assert.equal(reps.length, 1)
  assert.deepEqual(reps[0].donde, { referral: null })
})

// ── LA prueba que evita corromper la conversación ─────────────────
// Una reentrega solo puede mejorar el CONTENIDO. Si el parche arrastrara el
// teléfono, la conversación, la fecha o la dirección, una reentrega tardía
// movería el mensaje de chat o de bandeja — el bug más caro de este inbox.
test('el parche NUNCA toca telefono, conversacion, fecha ni direccion', () => {
  for (const rep of reparacionesDeReentrega(real({ referral: { headline: 'X' } }))) {
    for (const prohibido of ['telefono', 'conversacion_id', 'fecha', 'direccion', 'cuenta', 'wa_message_id']) {
      assert.ok(!(prohibido in rep.set), `el parche no puede traer ${prohibido}`)
    }
  }
})
