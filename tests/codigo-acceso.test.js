// POST /api/codigo-acceso (15-oct-2026): el club de premios le pide al inbox que
// mande el código de acceso por WhatsApp con SU token de Meta. Así el token nunca
// sale del inbox. Lo que se prueba aquí: el candado y el mensaje que va a Meta.
import test from 'node:test'
import assert from 'node:assert'
import { llaveValida, armarCodigoAcceso } from '../lib/codigo-acceso.js'
import { esRutaPublica } from '../lib/rutas-publicas.js'

test('candado: solo la llave exacta; sin llave configurada no entra nadie', () => {
  assert.equal(llaveValida('Bearer abc123', 'abc123'), true)
  assert.equal(llaveValida('Bearer abc124', 'abc123'), false)
  assert.equal(llaveValida('Bearer ', ''), false)
  assert.equal(llaveValida(undefined, undefined), false)
  assert.equal(llaveValida('Bearer abc123', '﻿abc123'), true) // BOM de PowerShell
})

test('arma la plantilla de autenticación: código en el cuerpo Y en el botón', () => {
  const r = armarCodigoAcceso({ celular: '0991112222', codigo: '123456' })
  assert.equal(r.ok, true)
  assert.equal(r.cuerpo.to, '593991112222')
  assert.equal(r.cuerpo.type, 'template')
  assert.equal(r.cuerpo.template.name, 'codigo_acceso')
  assert.deepEqual(r.cuerpo.template.components, [
    { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
  ])
})

test('solo manda un código de 6 dígitos a un celular de Ecuador (no sirve para mandar otra cosa)', () => {
  assert.equal(armarCodigoAcceso({ celular: '0991112222', codigo: 'hola mundo' }).ok, false)
  assert.equal(armarCodigoAcceso({ celular: '0991112222', codigo: '12345' }).ok, false)
  assert.equal(armarCodigoAcceso({ celular: '+1 555 123 4567', codigo: '123456' }).ok, false)
  assert.equal(armarCodigoAcceso({ celular: '593991112222', codigo: '123456' }).cuerpo.to, '593991112222')
})

test('/api/codigo-acceso es pública (se defiende con su propia llave)', () => {
  assert.equal(esRutaPublica('/api/codigo-acceso'), true)
  assert.equal(esRutaPublica('/api/codigo-acceso-falso'), false)
})
