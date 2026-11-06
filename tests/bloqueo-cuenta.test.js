// Cuando Meta frena toda la cuenta se tiene que avisar UNA vez y al instante, y el
// banner solo puede apagarse con un envío que salió de verdad después del bloqueo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registrarBloqueo, liberarBloqueo, procesarEstadosCuenta, bloqueoVigente, diasParaVencer, revisarVencimientoToken } from '../lib/bloqueo-cuenta.js'

const DESDE = '2026-11-06T14:25:00.000Z'
const seg = (iso) => Date.parse(iso) / 1000

function falso({ avisoOk = true } = {}) {
  const s = { valor: null, avisos: [], panel: [], lecturas: 0 }
  return {
    s,
    db: {
      leer: async () => { s.lecturas++; return s.valor },
      crearSiNoExiste: async (v) => { if (s.valor) return false; s.valor = v; return true },
      borrar: async () => { const habia = Boolean(s.valor); s.valor = null; return habia },
    },
    avisar: async (t) => { s.avisos.push(t); return { ok: avisoOk, motivo: avisoOk ? undefined : 'http-403' } },
    panel: async (estado, detalle) => { s.panel.push({ estado, detalle }) },
    ahora: () => new Date(DESDE),
  }
}

test('el primer fallo de cuenta avisa, prende el panel y deja el banner', async () => {
  const d = falso()
  const r = await registrarBloqueo(131042, d)
  assert.equal(r.nuevo, true)
  assert.equal(d.s.avisos.length, 1)
  assert.match(d.s.avisos[0], /NO ESTÁ SALIENDO NINGÚN MENSAJE/)
  assert.equal(d.s.panel[0].estado, 'rojo')
  const b = await bloqueoVigente(d)
  assert.equal(b.codigo, 131042)
  assert.match(b.motivo, /PAGO PENDIENTE/)
})

test('50 fallos seguidos son UN solo aviso', async () => {
  const d = falso()
  for (let i = 0; i < 50; i++) await registrarBloqueo(131042, d)
  assert.equal(d.s.avisos.length, 1)
})

test('un fallo de UN cliente no bloquea la cuenta', async () => {
  const d = falso()
  await registrarBloqueo(131047, d)
  assert.equal(d.s.valor, null)
  assert.equal(d.s.avisos.length, 0)
})

test('el token vencido (190) también cuenta como bloqueo', async () => {
  const d = falso()
  await registrarBloqueo(190, d)
  assert.match(d.s.avisos[0], /token/i)
})

test('un sent ANTERIOR al bloqueo no lo apaga; uno posterior sí, y avisa', async () => {
  const d = falso()
  await registrarBloqueo(131042, d)
  assert.equal((await liberarBloqueo(seg(DESDE) - 5, d)).liberado, false)
  assert.ok(d.s.valor)
  assert.equal((await liberarBloqueo(seg(DESDE) + 5, d)).liberado, true)
  assert.equal(d.s.valor, null)
  assert.equal(d.s.panel.at(-1).estado, 'verde')
  assert.match(d.s.avisos.at(-1), /volvieron a salir/)
})

test('un sent sin bloqueo no avisa nada', async () => {
  const d = falso()
  assert.equal((await liberarBloqueo(seg(DESDE), d)).liberado, false)
  assert.equal(d.s.avisos.length, 0)
})

test('delivered y read no tocan la base ni apagan el bloqueo', async () => {
  const d = falso()
  await procesarEstadosCuenta([{ status: 'delivered', timestamp: '1' }, { status: 'read', timestamp: '2' }], d)
  assert.equal(d.s.lecturas, 0)
  await registrarBloqueo(131042, d)
  await procesarEstadosCuenta([{ status: 'read', timestamp: String(seg(DESDE) + 60) }], d)
  assert.ok(d.s.valor)
})

test('el status crudo real de Meta dispara el bloqueo', async () => {
  const d = falso()
  await procesarEstadosCuenta([{ id: 'wamid.x', status: 'failed', timestamp: '1793975111', errors: [{ code: 131042, title: 'Business eligibility payment issue' }] }], d)
  assert.equal(d.s.avisos.length, 1)
})

test('si Telegram rechaza el aviso, no revienta y el banner queda', async () => {
  const d = falso({ avisoOk: false })
  const r = await registrarBloqueo(131042, d)
  assert.equal(r.avisado, false)
  assert.ok(d.s.valor)
})

test('si la base falla, no lanza: no puede tumbar el webhook', async () => {
  const d = falso()
  d.db.crearSiNoExiste = async () => { throw new Error('caída') }
  assert.equal((await registrarBloqueo(131042, d)).error, 'caída')
})

test('diasParaVencer: 0 de Meta significa que no caduca', () => {
  const ahora = Date.parse('2026-11-06T00:00:00Z')
  assert.equal(diasParaVencer(0, ahora), null)
  assert.equal(diasParaVencer(seg('2026-11-09T16:00:00Z'), ahora), 3)
})

function conToken(fn) {
  process.env.META_TOKEN = 'tok'
  return fn().finally(() => { delete process.env.META_TOKEN })
}
const respuesta = (cuerpo, ok = true, status = 200) => async () => ({ ok, status, json: async () => cuerpo })

test('token: avisa si faltan pocos días', () => conToken(async () => {
  const avisos = []
  const expira = Math.floor(Date.now() / 1000) + 3 * 86400 + 60
  const r = await revisarVencimientoToken({
    fetcher: respuesta({ data: { expires_at: expira } }),
    avisar: async (t) => { avisos.push(t); return { ok: true } },
  })
  assert.equal(r.dias, 3)
  assert.match(avisos[0], /vence en 3 días/)
}))

test('token: sin caducidad no avisa', () => conToken(async () => {
  const avisos = []
  await revisarVencimientoToken({ fetcher: respuesta({ data: { expires_at: 0 } }), avisar: async (t) => { avisos.push(t); return { ok: true } } })
  assert.equal(avisos.length, 0)
}))

test('token: un error de Meta no se confunde con token por vencer', () => conToken(async () => {
  const avisos = []
  const r = await revisarVencimientoToken({ fetcher: respuesta({ error: { code: 1 } }, false, 500), avisar: async (t) => { avisos.push(t); return { ok: true } } })
  assert.equal(r.ok, false)
  assert.equal(avisos.length, 0)
}))
