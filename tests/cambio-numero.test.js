import test from 'node:test'
import assert from 'node:assert'
import { cambioDeNumero } from '../lib/cambio-numero.js'

// Meta avisa por `system` cuando alguien cambia de teléfono. El historial queda
// PARTIDO: lo viejo bajo el número anterior, lo nuevo bajo el otro. 38 casos,
// 31 en el último mes. Esta función saca los dos números del aviso.
const aviso = (extra = {}) => ({
  system: { type: 'user_changed_number', wa_id: '593979191677',
            body: 'User A changed from 593963642922 to 593979191677', ...extra },
})

test('saca el numero viejo y el nuevo del aviso de Meta', () => {
  const c = cambioDeNumero(aviso())
  assert.equal(c.viejo, '593963642922')
  assert.equal(c.nuevo, '593979191677')
})

test('el numero nuevo sale de wa_id, no del texto', () => {
  // `body` es texto libre de Meta y puede cambiar de formato; `wa_id` es el campo.
  const c = cambioDeNumero(aviso({ body: 'algo que Meta reescribio' }))
  assert.equal(c.nuevo, '593979191677')
  assert.equal(c.viejo, '')
})

test('devuelve null si no es un cambio de numero', () => {
  assert.equal(cambioDeNumero({ system: { type: 'otra_cosa' } }), null)
  assert.equal(cambioDeNumero({ text: { body: 'hola' } }), null)
  assert.equal(cambioDeNumero(null), null)
})

// ☠️ Nunca se inventa un número: si Meta no manda `wa_id`, no hay a dónde apuntar
// y es mejor no decir nada que mandar a quien atiende a un chat equivocado.
test('sin wa_id no hay cambio utilizable', () => {
  assert.equal(cambioDeNumero({ system: { type: 'user_changed_number', body: 'User A changed from 1 to 2' } }), null)
})

// ── EL AVISO QUE SE DEJA EN EL NÚMERO NUEVO ──────────────────────
// Rodrigo lo pidió como MENSAJE REAL, no como aviso al leer: que caiga en
// Pendientes es la gracia, porque así se entera de que alguien cambió de número.
import { notaParaNumeroNuevo } from '../lib/cambio-numero.js'

const original = {
  id: 'wamid.AVISO', telefono: '593963642922', nombre: 'Dayan', phoneId: '118582961194601',
  timestamp: '2026-09-04T19:50:00.000Z',
  raw: { system: { type: 'user_changed_number', wa_id: '593979191677',
                   body: 'User A changed from 593963642922 to 593979191677' } },
}

test('la nota va al numero NUEVO y nombra al viejo', () => {
  const n = notaParaNumeroNuevo(original)
  assert.equal(n.telefono, '593979191677')
  assert.match(n.mensaje, /593963642922/)
  assert.equal(n.direccion, 'ENTRANTE')   // entrante = cae en Pendientes y alerta
  assert.equal(n.phoneId, '118582961194601') // por NUESTRO mismo número
})

// ☠️ Idempotente: el id sale del wamid del aviso. Meta reentrega el mismo evento
// (pasó de verdad, ver lib/reentrega.js) y no puede crear dos avisos.
test('el id de la nota es estable, no se duplica en una reentrega', () => {
  assert.equal(notaParaNumeroNuevo(original).id, notaParaNumeroNuevo(original).id)
  assert.match(notaParaNumeroNuevo(original).id, /wamid\.AVISO/)
})

// ☠️ La nota NO puede volver a disparar otra nota: su `raw` lleva un tipo
// distinto a propósito. Si no, sería un bucle infinito de avisos.
test('la nota NO es un cambio de numero y por tanto no se reproduce', () => {
  const n = notaParaNumeroNuevo(original)
  assert.equal(cambioDeNumero(n.raw), null, 'una nota no puede generar otra nota')
})

test('sin cambio utilizable no se crea nada', () => {
  assert.equal(notaParaNumeroNuevo({ ...original, raw: { text: { body: 'hola' } } }), null)
  assert.equal(notaParaNumeroNuevo(null), null)
})

// Si Meta mandara un cambio "al mismo número", no se crea una nota inútil.
test('no se avisa a si mismo', () => {
  const raw = { system: { type: 'user_changed_number', wa_id: '593963642922', body: 'from 593963642922 to 593963642922' } }
  assert.equal(notaParaNumeroNuevo({ ...original, raw }), null)
})
