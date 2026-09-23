// Los crons se llaman a sí mismos por el dominio de producción, NUNCA por la
// dirección interna del despliegue (protegida por Vercel → 401 en silencio).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { urlPropia, URL_PRODUCCION } from '../lib/url-propia.js'

test('sin INBOX_URL usa el dominio de producción de MANDI', () => {
  assert.equal(urlPropia({}), URL_PRODUCCION)
  assert.equal(URL_PRODUCCION, 'https://inbox.apps.mandarinaec.com')
})

test('INBOX_URL manda, sin barra final ni BOM', () => {
  assert.equal(urlPropia({ INBOX_URL: '﻿https://otro.ejemplo.com/' }), 'https://otro.ejemplo.com')
})

test('ningún cron arma la dirección con req.url (la del despliegue protegido)', () => {
  for (const ruta of ['seguimientos', 'flujos']) {
    const fuente = readFileSync(new URL(`../app/api/cron/${ruta}/route.js`, import.meta.url), 'utf8')
    assert.ok(!/new URL\(req\.url\)\.origin/.test(fuente), `cron ${ruta} vuelve a usar req.url`)
    assert.ok(/urlPropia\(\)/.test(fuente), `cron ${ruta} no usa urlPropia()`)
  }
})
