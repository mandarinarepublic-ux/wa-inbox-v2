// Frases REALES de la revisión del 22-sep-2026 (sin datos del cliente).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectarPromesa, cumplePromesaAlToque, CUMPLE_AL_TOQUE_MS } from '../lib/promesas.js'

test('promesas reales → 📌', () => {
  const si = [
    'ya le reviso',
    'Ya le reviso el estado',
    'si claro ya solicito al diseñador',
    'muchas gracias ya te enviamos el boceto',
    'ya le ingreso su pedido',
    'Ya le procesamos así',
    'hoy sale y mañana le llega',
    'ya reviso por qué la demora',
    'Permíteme un momento, verifico esto y te confirmo enseguida 🖤',
    'apenas esté listo le envío la info para que retire',
    'ya lo reviso con mi diseñador',
    'te confirmo en la tarde',
  ]
  const fallan = si.filter(t => !detectarPromesa(t))
  // "Ya le procesamos así" es pasado: no es promesa y está bien que no salte.
  assert.deepEqual(fallan, ['Ya le procesamos así'])
})

test('mensajes normales NO prenden 📌', () => {
  const no = [
    'chevere si tienes una foto de referencia',
    'seria 28,50',
    'perfecto',
    'desde que ciudad nos escribes',
    'todos los pedidos se demoran de 2 a 3 dias laborables a partir de tu compra',
    '¡Muchas gracias por ser un INDLOVER!',
    'ya está listo tu pedido',
    '',
    null,
  ]
  assert.deepEqual(no.filter(t => detectarPromesa(t)), [])
})

test('la nota es la frase original, con tildes', () => {
  assert.equal(detectarPromesa('si claro ya solicito al diseñador').frase, 'ya solicito')
  assert.equal(detectarPromesa('Hoy sale y mañana le llega').frase, 'Hoy sale')
})

test('📌 🤖 se apaga solo si sale foto/video/documento en ≤15 min', () => {
  const t0 = Date.parse('2026-09-22T15:00:00Z')
  const deudaAt = new Date(t0).toISOString()
  assert.equal(cumplePromesaAlToque({ deudaPor: 'auto', deudaAt, tipoEnviado: 'imagen', ahoraMs: t0 + 60000 }), true)
  assert.equal(cumplePromesaAlToque({ deudaPor: 'auto', deudaAt, tipoEnviado: 'documento', ahoraMs: t0 + CUMPLE_AL_TOQUE_MS }), true)
  assert.equal(cumplePromesaAlToque({ deudaPor: 'auto', deudaAt, tipoEnviado: 'imagen', ahoraMs: t0 + CUMPLE_AL_TOQUE_MS + 1 }), false)
  assert.equal(cumplePromesaAlToque({ deudaPor: 'auto', deudaAt, tipoEnviado: 'texto', ahoraMs: t0 + 60000 }), false)
  // Los 📌 del vendedor y los de la IA nunca se apagan solos.
  assert.equal(cumplePromesaAlToque({ deudaPor: 'humano', deudaAt, tipoEnviado: 'imagen', ahoraMs: t0 + 60000 }), false)
  assert.equal(cumplePromesaAlToque({ deudaPor: 'ia', deudaAt, tipoEnviado: 'imagen', ahoraMs: t0 + 60000 }), false)
})

test('I7: formas ecuatorianas (ahorita, ya mismo, en un ratito) y "lo reviso y le aviso"', () => {
  for (const t of ['ahorita le envío', 'ya mismo le envío la foto', 'en un ratito le mando', 'ya lo reviso y le aviso', 'te comparto el boceto en un momento']) {
    assert.ok(detectarPromesa(t), t)
  }
})

test('I7: si los datos van en el mismo mensaje, no es promesa', () => {
  for (const t of ['Ya te paso la cuenta: Banco Pichincha 2200…', 'ya te envío la ubicación: Av. 6 de Diciembre y Mercurio']) {
    assert.equal(detectarPromesa(t), null, t)
  }
})
