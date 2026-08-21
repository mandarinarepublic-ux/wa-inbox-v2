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

const msg = (id, phoneId, texto, timestamp, extra = {}) => ({
  id, telefono: TEL, nombre: 'Rodri VIP', phoneId,
  direccion: 'ENTRANTE', mensaje: texto, timestamp, ...extra,
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
  const convs = buildConvs([
    msg('a', MANDI, 'test', '2026-08-20T05:08:17Z'),
    msg('a', MANDI, 'test', '2026-08-20T05:08:17Z'),
  ], true)
  assert.equal(convs.length, 1)
  assert.equal(convs[0].msgs.length, 1)
})

// ── El estado de bandeja NO puede depender de quién gane el "último mensaje" ──
//
// Este es el fallo que casi se despliega. El estado por canal viene de la vista
// `lista_bandeja`, pero el poll arma la conversación mezclando TRES fuentes:
//
//     buildConvs([...rows, ...hilos, ...lista])
//
// y se queda con el PRIMERO que ve por id. `rows` (la ventana de mensajes
// recientes) va primero y NO trae estado. O sea que para los chats RECIENTES
// —justo los que están pendientes, los que importan— el estado se habría perdido
// y la fila habría caído al estado por persona, que es el bug que veníamos a
// arreglar. Habría funcionado solo en los chats viejos: invisible al probar.
//
// Por eso el estado vive en la CONVERSACIÓN y no en su último mensaje.

test('el estado sobrevive aunque el último mensaje venga de una fuente sin estado', () => {
  const convs = buildConvs([
    // `rows`: el mismo mensaje, más completo pero SIN estado de bandeja
    msg('a', MANDI, 'hola', '2026-08-20T05:08:17Z'),
    // `lista`: el mismo id, con el estado
    msg('a', MANDI, 'hola', '2026-08-20T05:08:17Z', { estadoBandeja: 'atendido' }),
  ], true)
  assert.equal(convs.length, 1)
  assert.equal(convs[0].estadoBandeja, 'atendido')
})

test('un mensaje optimista posterior no borra el estado de la conversación', () => {
  // Al enviar se pinta una burbuja optimista que pasa a ser el último mensaje.
  // Si el estado viviera en `last`, enviar dejaría la fila sin estado.
  const convs = buildConvs([
    msg('a', MANDI, 'hola', '2026-08-20T05:08:17Z', { estadoBandeja: 'atendido' }),
    msg('z', MANDI, 'ya te respondo', '2026-08-20T05:09:00Z'), // optimista, sin estado
  ], true)
  assert.equal(convs[0].estadoBandeja, 'atendido')
  assert.equal(convs[0].last.mensaje, 'ya te respondo')
})

test('cada canal conserva SU propio estado', () => {
  const convs = buildConvs([
    msg('a', MANDI,    'sin contestar', '2026-08-20T05:08:17Z', { estadoBandeja: 'pendiente' }),
    msg('b', REPUBLIC, 'ya contestado', '2026-08-20T05:08:25Z', { estadoBandeja: 'atendido'  }),
  ], true)
  const porCanal = Object.fromEntries(convs.map(c => [c.phoneId, c.estadoBandeja]))
  assert.equal(porCanal[MANDI],    'pendiente')
  assert.equal(porCanal[REPUBLIC], 'atendido')
})

test('sin estado en ninguna fuente queda vacío, para que la pantalla use el respaldo', () => {
  const convs = buildConvs([msg('a', MANDI, 'hola', '2026-08-20T05:08:17Z')], true)
  assert.equal(convs[0].estadoBandeja, '')
})

// ── La ventana de 24 h también tiene que sobrevivir al merge ──────────────────
//
// `windowOpen` decide si se puede escribir o si solo queda plantilla, y hasta ahora
// se calculaba buscando el último ENTRANTE dentro de los mensajes que hay en
// pantalla. Eso falla en el instante ANTES de que el hilo filtrado por canal haya
// cargado: ahí `msgs` viene del poll, que en GENERAL trae los DOS números, y el
// entrante del OTRO canal haría creer que la ventana está abierta.
//
// Un falso "abierta" manda un mensaje que muere en Meta con 131047 y el vendedor
// cree que llegó — exactamente lo que pasó el 19-ago. El dato autoritativo
// (`ultimoEntranteCanal`, de la vista, ya por canal) tiene que sobrevivir igual
// que el estado.

test('ultimoEntranteCanal sobrevive aunque el último mensaje no lo traiga', () => {
  const convs = buildConvs([
    msg('a', MANDI, 'hola', '2026-08-20T05:08:17Z', { ultimoEntranteCanal: '2026-08-20T05:08:17Z' }),
    msg('z', MANDI, 'respuesta', '2026-08-20T05:09:00Z'), // optimista, sin el dato
  ], true)
  assert.equal(convs[0].ultimoEntranteCanal, '2026-08-20T05:08:17Z')
})

test('cada canal conserva SU propia ventana', () => {
  const convs = buildConvs([
    msg('a', MANDI,    'viejo', '2026-07-15T19:08:58Z', { ultimoEntranteCanal: '2026-07-15T19:08:58Z' }),
    msg('b', REPUBLIC, 'hoy',   '2026-08-19T16:20:35Z', { ultimoEntranteCanal: '2026-08-19T16:20:35Z' }),
  ], true)
  const porCanal = Object.fromEntries(convs.map(c => [c.phoneId, c.ultimoEntranteCanal]))
  assert.equal(porCanal[MANDI],    '2026-07-15T19:08:58Z')
  assert.equal(porCanal[REPUBLIC], '2026-08-19T16:20:35Z')
})
