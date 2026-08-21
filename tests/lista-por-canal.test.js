// GENERAL tiene que mostrar UNA fila por (cliente, número), no una por cliente.
//
// El 20-ago Rodrigo probó mandando "test" a MANDI y "ealñskdñal" a REPUBLIC con
// ocho segundos de diferencia. En la bandeja apareció UNA sola fila: el mensaje de
// MANDI quedó invisible porque `buildConvs` agrupa por teléfono y se queda con el
// último mensaje venga del número que venga.
//
// "Sin texto" nunca significa "no pasó nada", y "una fila" tampoco significa "una
// conversación".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConvs } from '../lib/utils.js'

const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'
const TEL      = '593987498489'

const msg = (id, phoneId, texto, timestamp) => ({
  id, telefono: TEL, nombre: 'Rodri VIP', phoneId,
  direccion: 'ENTRANTE', mensaje: texto, timestamp,
})

test('por canal: el mismo cliente en dos números da DOS filas', () => {
  const convs = buildConvs([
    msg('a', MANDI,    'test',       '2026-08-20T05:08:17Z'),
    msg('b', REPUBLIC, 'ealñskdñal', '2026-08-20T05:08:25Z'),
  ], true)
  assert.equal(convs.length, 2)
  assert.deepEqual(convs.map(c => c.phoneId).sort(), [MANDI, REPUBLIC].sort())
})

test('por canal: cada fila conserva SU último mensaje, sin robarse el del otro', () => {
  const convs = buildConvs([
    msg('a', MANDI,    'test',       '2026-08-20T05:08:17Z'),
    msg('b', REPUBLIC, 'ealñskdñal', '2026-08-20T05:08:25Z'),
  ], true)
  const porCanal = Object.fromEntries(convs.map(c => [c.phoneId, c.last.mensaje]))
  assert.equal(porCanal[MANDI],    'test')
  assert.equal(porCanal[REPUBLIC], 'ealñskdñal')
})

test('por canal: los mensajes de un número NO se cuelan en el hilo del otro', () => {
  // Esta es la mezcla que veía el vendedor: dos conversaciones distintas cosidas
  // por fecha en un solo hilo, sin marca de por dónde entró cada mensaje.
  const convs = buildConvs([
    msg('a', MANDI,    'viejo de julio', '2026-07-15T18:43:43Z'),
    msg('b', REPUBLIC, 'de hoy',         '2026-08-20T05:08:25Z'),
    msg('c', MANDI,    'otro de julio',  '2026-07-15T18:45:00Z'),
  ], true)
  const mandi = convs.find(c => c.phoneId === MANDI)
  const rep   = convs.find(c => c.phoneId === REPUBLIC)
  assert.equal(mandi.msgs.length, 2)
  assert.equal(rep.msgs.length, 1)
  assert.ok(!mandi.msgs.some(m => m.mensaje === 'de hoy'))
})

test('sin el modo por canal el comportamiento viejo NO cambia', () => {
  // Las pestañas de un solo número ya vienen filtradas desde el backend y no
  // necesitan la clave compuesta. Si esto cambiara, se movería media app.
  const convs = buildConvs([
    msg('a', MANDI,    'test',       '2026-08-20T05:08:17Z'),
    msg('b', REPUBLIC, 'ealñskdñal', '2026-08-20T05:08:25Z'),
  ])
  assert.equal(convs.length, 1)
})

test('por canal: un mensaje sin phoneId no tumba la fila ni se mezcla con otro cliente', () => {
  const convs = buildConvs([
    { id: 'x', telefono: TEL,            nombre: 'A', direccion: 'ENTRANTE', mensaje: 'sin canal', timestamp: '2026-08-20T05:00:00Z' },
    { id: 'y', telefono: '593111111111', nombre: 'B', direccion: 'ENTRANTE', mensaje: 'otro',      timestamp: '2026-08-20T05:00:01Z' },
  ], true)
  assert.equal(convs.length, 2)
})

test('por canal: el mismo mensaje repetido no se duplica', () => {
  // El poll trae el mismo mensaje por varias fuentes (lista + ventana reciente +
  // hilo cacheado). Si se duplicara, el contador de no leídos mentiría.
  const convs = buildConvs([
    msg('a', MANDI, 'test', '2026-08-20T05:08:17Z'),
    msg('a', MANDI, 'test', '2026-08-20T05:08:17Z'),
  ], true)
  assert.equal(convs.length, 1)
  assert.equal(convs[0].msgs.length, 1)
})
