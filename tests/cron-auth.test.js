import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { autorizadoCron } from '../lib/cron-auth.js'

const req = (headers = {}, url = 'https://x.com/api/cron/seguimientos') =>
  ({ url, headers: new Headers(headers) })
const env = { CRON_SECRET: 's3creto' }

test('con secreto: la cabecera x-vercel-cron sola ya NO alcanza', () => {
  assert.equal(autorizadoCron(req({ 'x-vercel-cron': '1' }), env), false)
  assert.equal(autorizadoCron(req({}), env), false)
  assert.equal(autorizadoCron(req({ authorization: 'Bearer otro' }), env), false)
})

test('con secreto: vale el Bearer que manda Vercel y el ?key= manual', () => {
  assert.equal(autorizadoCron(req({ authorization: 'Bearer s3creto' }), env), true)
  assert.equal(autorizadoCron(req({}, 'https://x.com/api/cron/flujos?key=s3creto'), env), true)
})

test('un BOM pegado desde PowerShell no rompe el secreto', () => {
  assert.equal(autorizadoCron(req({ authorization: 'Bearer s3creto' }), { CRON_SECRET: '﻿s3creto' }), true)
})

test('sin secreto: solo la cabecera de Vercel, nunca abierto a todos', () => {
  assert.equal(autorizadoCron(req({}), {}), false)
  assert.equal(autorizadoCron(req({ 'x-vercel-cron': '1' }), {}), true)
})

test('ningún cron arma su propia regla de acceso', () => {
  const dir = new URL('../app/api/cron/', import.meta.url)
  for (const ruta of readdirSync(dir)) {
    const src = readFileSync(new URL(`${ruta}/route.js`, dir), 'utf8')
    assert.ok(/autorizadoCron/.test(src), `cron ${ruta} no usa autorizadoCron`)
    // (el log de diagnóstico de pendientes puede NOMBRAR la cabecera; lo prohibido es DECIDIR con ella)
    assert.ok(!/return[^\n]*x-vercel-cron|isVercelCron/.test(src), `cron ${ruta} vuelve a decidir con x-vercel-cron`)
  }
})
