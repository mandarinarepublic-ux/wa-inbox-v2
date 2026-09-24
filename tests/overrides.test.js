import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sumarOverride, aplicarOverrides, TTL_OVERRIDE_MS } from '../lib/overrides.js'

const AHORA = 1_000_000

test('el poll dentro de 35 s no revierte la etapa recién marcada', () => {
  const ov = sumarOverride({}, '593', { etapa: 'falta_pedido' }, AHORA)
  const delPoll = { '593': { etapa: '', alias: 'Ana' } }
  const r = aplicarOverrides(delPoll, ov, AHORA + TTL_OVERRIDE_MS - 1)
  assert.equal(r['593'].etapa, 'falta_pedido')
  assert.equal(r['593'].alias, 'Ana')
})

test('vencido el override, manda lo que diga la base', () => {
  const ov = sumarOverride({}, '593', { etapa: 'falta_pedido' }, AHORA)
  const r = aplicarOverrides({ '593': { etapa: 'cotizando' } }, ov, AHORA + TTL_OVERRIDE_MS)
  assert.equal(r['593'].etapa, 'cotizando')
})

test('dos cambios seguidos se suman; uno vencido no revive', () => {
  let ov = sumarOverride({}, '593', { etapa: 'cotizando' }, AHORA)
  ov = sumarOverride(ov, '593', { deudaAt: 'x' }, AHORA + 1000)
  assert.deepEqual(ov['593'].campos, { etapa: 'cotizando', deudaAt: 'x' })
  const tarde = sumarOverride(ov, '593', { sinAutomaticos: true }, AHORA + 1000 + TTL_OVERRIDE_MS)
  assert.deepEqual(tarde['593'].campos, { sinAutomaticos: true })
})

test('no inventa contactos que el poll no trajo', () => {
  const ov = sumarOverride({}, '999', { etapa: 'cotizando' }, AHORA)
  assert.deepEqual(aplicarOverrides({}, ov, AHORA), {})
})
