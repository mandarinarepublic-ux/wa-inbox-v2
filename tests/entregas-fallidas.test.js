// En agosto murieron 9 mensajes sin que nadie se enterara: 3 el 19-ago y 6 el
// 16-ago, todos rechazados por Meta con 131047. El vendedor los vio salir con su
// ✓ y el cliente nunca los recibió. Se descubrieron por casualidad.
//
// El chequeo se pidió por escrito el 29-jul y no se hizo. Estas pruebas cubren lo
// que tiene que decir el aviso para que sirva de algo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparFallos, textoAvisoFallidos, motivoLegible, eventosParaTablero, esFalloDeCuenta } from '../lib/entregas-fallidas.js'

const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'
const CANALES  = [{ phoneId: MANDI, etiqueta: 'MANDI' }, { phoneId: REPUBLIC, etiqueta: 'REPUBLIC' }]

test('el 131047 se explica en español, no como un número', () => {
  assert.match(motivoLegible(131047), /24 h cerrada/i)
  assert.match(motivoLegible(131047), /ESE número/)
})

test('un código que no conocemos NO se traga el motivo', () => {
  // Si Meta inventa un código nuevo, el aviso tiene que seguir diciendo algo útil
  // en vez de callarse. "No sé qué pasó" informa; el silencio no.
  assert.match(motivoLegible(999999, 'Something broke'), /Something broke/)
  assert.match(motivoLegible(999999, 'Something broke'), /999999/)
  assert.match(motivoLegible(888888), /888888/)
  assert.match(motivoLegible(null), /desconocido/i)
})

test('una tanda al mismo cliente es UN aviso que dice cuántos (el caso del 16-ago)', () => {
  // Seis mensajes seguidos al mismo cliente por el mismo motivo. Seis avisos
  // idénticos entrenan a ignorarlos; uno que diga "6 mensajes" informa igual.
  const fallos = Array.from({ length: 6 }, (_, i) => ({
    telefono: '593995376049', nombre: 'CLIENTE', phone_id: MANDI, codigo: 131047,
    fecha: `2026-08-16T16:54:2${i}Z`,
  }))
  const g = agruparFallos(fallos)
  assert.equal(g.length, 1)
  assert.equal(g[0].cuantos, 6)
  assert.match(textoAvisoFallidos(g, { canales: CANALES }), /6 mensajes/)
})

test('fallos de canales distintos NO se mezclan', () => {
  const g = agruparFallos([
    { telefono: '593960643698', phone_id: MANDI,    codigo: 131047, fecha: '2026-08-19T16:49:29Z' },
    { telefono: '593960643698', phone_id: REPUBLIC, codigo: 131026, fecha: '2026-08-19T16:50:00Z' },
  ])
  assert.equal(g.length, 2)
})

test('cuando el otro número SÍ sirve, el aviso lo dice — es lo accionable', () => {
  // El caso del 19-ago: los tres mensajes murieron por MANDI mientras REPUBLIC
  // estaba abierto. El aviso tiene que decir "mándalo por REPUBLIC", no solo
  // "se perdió".
  const g = agruparFallos([{
    telefono: '593960643698', nombre: 'KENSHIWOLF', phone_id: MANDI, codigo: 131047,
    fecha: '2026-08-19T16:49:29Z', alternativa: REPUBLIC,
  }])
  const txt = textoAvisoFallidos(g, { canales: CANALES })
  assert.match(txt, /Sí puedes escribirle por REPUBLIC/)
})

test('el aviso nombra el canal, nunca el id de Meta', () => {
  const g = agruparFallos([{ telefono: '593960643698', phone_id: MANDI, codigo: 131047 }])
  const txt = textoAvisoFallidos(g, { canales: CANALES })
  assert.match(txt, /MANDI/)
  assert.ok(!txt.includes(MANDI), 'no puede aparecer el phone_id crudo')
})

test('sin fallos NO se manda nada', () => {
  // Un aviso periódico que llega vacío es ruido, y el ruido se acaba ignorando
  // justo el día que trae algo de verdad.
  assert.equal(textoAvisoFallidos([], { canales: CANALES }), '')
  assert.equal(textoAvisoFallidos(null), '')
})

test('si hay más clientes de los que caben, el aviso lo DICE', () => {
  // Un recorte silencioso se lee como "esto es todo lo que pasó". Es el mismo
  // patrón que dejó pasar los 9 mensajes: lo que no se nombra, no existe.
  const fallos = Array.from({ length: 14 }, (_, i) => ({
    telefono: `59399000000${i}`, phone_id: MANDI, codigo: 131047, fecha: `2026-08-19T16:0${i}:00Z`,
  }))
  const txt = textoAvisoFallidos(agruparFallos(fallos), { canales: CANALES })
  assert.match(txt, /4 clientes más/)
})

test('el singular se lee bien', () => {
  const g = agruparFallos([{ telefono: '593960643698', phone_id: MANDI, codigo: 131047 }])
  const txt = textoAvisoFallidos(g, { canales: CANALES })
  assert.match(txt, /Un mensaje NO le llegó/)
})

test('sin nombre se muestra el teléfono, no un hueco', () => {
  const g = agruparFallos([{ telefono: '593960643698', nombre: '', phone_id: MANDI, codigo: 131047 }])
  assert.match(textoAvisoFallidos(g, { canales: CANALES }), /\+593960643698/)
})

// 17-oct-2026: IND amaneció con un pago pendiente a Meta (131042) y desde las
// 8:00 no salió NINGÚN mensaje. El aviso tiene que gritar que es la CUENTA, no
// listar clientes sueltos, y el fallo tiene que quedar en /dashboard/errores.
const BLOQUEO = [
  { telefono: '593994787733', nombre: 'Salome', phone_id: MANDI, codigo: 131042, fecha: '2026-10-17T13:30:44Z' },
  { telefono: '593994787733', nombre: 'Salome', phone_id: MANDI, codigo: 131042, fecha: '2026-10-17T13:30:43Z' },
  { telefono: '593967848110', nombre: 'Pedro',  phone_id: MANDI, codigo: 131042, fecha: '2026-10-17T13:31:16Z' },
]

test('131042 (pago pendiente) se reconoce como bloqueo de TODA la cuenta', () => {
  assert.equal(esFalloDeCuenta(131042), true)
  assert.equal(esFalloDeCuenta('131042'), true)
  assert.equal(esFalloDeCuenta(131047), false)
  assert.match(motivoLegible(131042), /PAGO PENDIENTE/)
})

test('un bloqueo de cuenta encabeza el aviso y dice que no se reenvía solo', () => {
  const t = textoAvisoFallidos(agruparFallos(BLOQUEO), { canales: CANALES })
  assert.match(t, /^🛑 <b>NO ESTÁ SALIENDO NINGÚN MENSAJE<\/b>/)
  assert.match(t, /NO se reenvían solos/)
})

test('fallos normales NO llevan la alarma de cuenta', () => {
  const t = textoAvisoFallidos(agruparFallos([{ telefono: '1', phone_id: MANDI, codigo: 131047, fecha: 'x' }]), { canales: CANALES })
  assert.doesNotMatch(t, /NINGÚN MENSAJE/)
})

test('al tablero va UNA fila por motivo, con los clientes en el detalle', () => {
  const filas = eventosParaTablero(agruparFallos([
    ...BLOQUEO, { telefono: '9', phone_id: MANDI, codigo: 131047, fecha: 'x' },
  ]), 'IND')
  assert.equal(filas.length, 2)
  const b = filas.find(f => f.detalle.codigo === 131042)
  assert.equal(b.fuente, 'whatsapp')
  assert.equal(b.nivel, 'error')
  assert.equal(b.pedido_id, null)
  assert.equal(b.detalle.de_cuenta, true)
  assert.equal(b.detalle.mensajes, 3)
  assert.equal(b.detalle.clientes.length, 2)
  assert.match(b.mensaje, /^🛑 NO SALE NINGÚN MENSAJE de IND\. 3 mensajes NO llegaron \(2 clientes\)/)
})

test('sin fallos no se escribe nada en el tablero', () => {
  assert.deepEqual(eventosParaTablero([], 'IND'), [])
})
