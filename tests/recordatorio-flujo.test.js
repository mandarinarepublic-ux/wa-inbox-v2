import test from 'node:test'
import assert from 'node:assert'
import { horaEcuador, horaPermitida, grupoDe, primerNombre, armarTexto, cuerpoSaliente, correrRecordatorioFlujo } from '../lib/recordatorio-flujo.js'

// 15:00 UTC = 10:00 en Ecuador
const DIA = new Date('2026-10-11T15:00:00Z')
const NOCHE = new Date('2026-10-11T03:00:00Z') // 22:00 del 10-oct en Ecuador

test('horario: hora de Ecuador (UTC-5) y [8, 21)', () => {
  assert.equal(horaEcuador(DIA), 10)
  assert.equal(horaEcuador(NOCHE), 22)
  assert.equal(horaPermitida(DIA), true)
  assert.equal(horaPermitida(NOCHE), false)
  assert.equal(horaPermitida(new Date('2026-10-11T13:00:00Z')), true)   // 08:00
  assert.equal(horaPermitida(new Date('2026-10-12T02:00:00Z')), false)  // 21:00
})

test('grupo: estable por el último dígito; 0 y 5 van a control', () => {
  assert.equal(grupoDe('593999000110'), 'control')
  assert.equal(grupoDe('593999000115'), 'control')
  assert.equal(grupoDe('593999000117'), 'enviado')
  assert.equal(grupoDe('593999000117'), grupoDe('593999000117'))
  assert.equal(grupoDe('593999000117', { control_digitos: '7' }), 'control')
  assert.equal(grupoDe(''), 'enviado')
})

test('primerNombre: solo si parece nombre; prefiere el alias', () => {
  assert.equal(primerNombre('', 'andrea lópez'), 'Andrea')
  assert.equal(primerNombre('NICOLÁS', 'x'), 'Nicolás')
  assert.equal(primerNombre('', '🔥🔥'), '')
  assert.equal(primerNombre('', 'J'), '')
  assert.equal(primerNombre('', 'Tienda123'), '')
  assert.equal(primerNombre('', ''), '')
})

test('armarTexto: con y sin nombre, sin espacios sueltos', () => {
  const p = 'Hola {nombre} 😊 ¿Pudiste ver los modelos?'
  assert.equal(armarTexto(p, 'Ana'), 'Hola Ana 😊 ¿Pudiste ver los modelos?')
  assert.equal(armarTexto(p, ''), 'Hola 😊 ¿Pudiste ver los modelos?')
})

test('cuerpoSaliente: botones rc_1..3 de máx 20 caracteres; sin botones va texto', () => {
  const c = cuerpoSaliente({ telefono: '5931', nombre: 'Ana', phoneId: 'P', texto: 'hola', botones: ['Ya elegí uno', 'Tengo una duda', 'Ya no, gracias', 'cuarto'] })
  assert.equal(c.TipoMensaje, 'interactive_buttons')
  assert.equal(c.Cuerpo, 'hola')
  assert.equal(c.Canal, 'P')
  const b = JSON.parse(c.Botones)
  assert.equal(b.length, 3)
  assert.deepEqual(b[0], { type: 'reply', reply: { id: 'rc_1', title: 'Ya elegí uno' } })
  assert.ok(b.every(x => x.reply.title.length <= 20))
  assert.deepEqual(cuerpoSaliente({ telefono: '5931', phoneId: 'P', texto: 'hola' }), { Telefono: '5931', Nombre: '', Canal: 'P', Mensaje: 'hola' })
})

const CFG = { activo: true, horas: 12, texto: 'Hola {nombre} 😊 ¿Pudiste verlos?', botones: ['Ya elegí uno'], control_digitos: '05' }
const cand = (telefono, extra = {}) => ({ telefono, phone_id: 'P', nombre: 'Ana Pérez', alias: '', ultimo_entrante_at: '2026-10-10T15:00:00+00:00', ultimo_humano_at: null, ...extra })

function depsFalsas(lista, { reclamar = true } = {}) {
  const reg = { reservas: [], enviados: [] }
  return {
    reg,
    deps: {
      candidatos: async () => lista,
      reclamar: async (tel, d) => { reg.reservas.push({ tel, ...d }); return typeof reclamar === 'function' ? reclamar(tel) : reclamar },
      enviar: async (cuerpo) => { reg.enviados.push(cuerpo); return { ok: true } },
      log: () => {},
    },
  }
}

test('correr: apagado, sin texto o de noche → no lee ni manda nada', async () => {
  const { deps, reg } = depsFalsas([cand('593999000117')])
  assert.equal((await correrRecordatorioFlujo(deps, { ...CFG, activo: false }, DIA)).saltado, 'apagado')
  assert.equal((await correrRecordatorioFlujo(deps, { ...CFG, texto: ' ' }, DIA)).saltado, 'sin texto')
  assert.equal((await correrRecordatorioFlujo(deps, CFG, NOCHE)).saltado, 'fuera de horario')
  assert.equal(reg.reservas.length + reg.enviados.length, 0)
})

test('correr: reserva ANTES de mandar; el control se reserva y NO recibe nada', async () => {
  const { deps, reg } = depsFalsas([cand('593999000117'), cand('593999000110')])
  const r = await correrRecordatorioFlujo(deps, CFG, DIA)
  assert.deepEqual(r.enviados, ['593999000117'])
  assert.deepEqual(r.control, ['593999000110'])
  assert.deepEqual(reg.reservas.map(x => [x.tel, x.grupo]), [['593999000117', 'enviado'], ['593999000110', 'control']])
  assert.equal(reg.enviados.length, 1)
  assert.equal(reg.enviados[0].Cuerpo, 'Hola Ana 😊 ¿Pudiste verlos?')
  assert.equal(reg.reservas[0].ultimoEntranteAt, '2026-10-10T15:00:00+00:00')
})

test('correr: si la reserva no gana (otra corrida, o escribió alguien), no manda', async () => {
  const { deps, reg } = depsFalsas([cand('593999000117')], { reclamar: false })
  const r = await correrRecordatorioFlujo(deps, CFG, DIA)
  assert.equal(r.enviados.length, 0)
  assert.equal(reg.enviados.length, 0)
})

test('correr: un envío rechazado queda en errores con su código', async () => {
  const { deps } = depsFalsas([cand('593999000117')])
  deps.enviar = async () => ({ ok: false, status: 400 })
  const r = await correrRecordatorioFlujo(deps, CFG, DIA)
  assert.deepEqual(r.errores, [{ telefono: '593999000117', status: 400 }])
})
