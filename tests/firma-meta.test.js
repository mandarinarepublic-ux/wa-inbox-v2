// La firma de Meta. Hoy solo se OBSERVA, pero estas pruebas son la condición
// para que algún día se pueda activar: si el cálculo estuviera mal y algún día
// esto rechazara, el inbox dejaría de recibir mensajes de clientes.
import test from 'node:test'
import assert from 'node:assert'
import { createHmac } from 'node:crypto'
import { evaluarFirmaMeta, observarFirmaMeta } from '../lib/firma-meta.js'

const SECRETO = 'app-secret-de-prueba'
const CUERPO = '{"object":"whatsapp_business_account","entry":[{"id":"1"}]}'
const firmaDe = (cuerpo, sec = SECRETO) =>
  'sha256=' + createHmac('sha256', sec).update(cuerpo, 'utf8').digest('hex')

test('una firma bien hecha coincide', () => {
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: SECRETO, crudo: CUERPO, cabecera: firmaDe(CUERPO) }),
    'coincide',
  )
})

test('el cuerpo alterado NO coincide', () => {
  // El caso que da sentido a todo: alguien manda un mensaje inventado.
  const otro = CUERPO.replace('"1"', '"999"')
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: SECRETO, crudo: otro, cabecera: firmaDe(CUERPO) }),
    'NO-coincide',
  )
})

test('con OTRO secreto NO coincide', () => {
  // Es el caso real de tener el App Secret de otra app de Meta.
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: 'otro-secreto', crudo: CUERPO, cabecera: firmaDe(CUERPO) }),
    'NO-coincide',
  )
})

test('un cuerpo re-serializado NO coincide — por eso hace falta el crudo', () => {
  // Parsear y volver a serializar cambia espacios y orden de claves. El mensaje
  // sería legítimo y la firma fallaría igual. Es la trampa que rompería todo.
  //
  // Ojo: este cuerpo lleva espacios A PROPÓSITO. Con un JSON ya compacto,
  // volver a serializarlo devuelve la misma cadena y la prueba no probaría nada
  // — me pasó al escribirla.
  const conEspacios = '{"object": "whatsapp_business_account", "entry": [{"id": "1"}]}'
  const reserializado = JSON.stringify(JSON.parse(conEspacios))
  assert.notStrictEqual(reserializado, conEspacios)
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: SECRETO, crudo: reserializado, cabecera: firmaDe(conEspacios) }),
    'NO-coincide',
  )
})

test('el BOM del secreto no rompe la comprobación', () => {
  // Cargar variables a Vercel desde PowerShell les pega un BOM invisible, y eso
  // ya mordió en este proyecto: falla SOLO en producción.
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: '﻿' + SECRETO, crudo: CUERPO, cabecera: firmaDe(CUERPO) }),
    'coincide',
  )
})

test('sin secreto lo dice, no finge que está bien', () => {
  assert.strictEqual(
    evaluarFirmaMeta({ secreto: '', crudo: CUERPO, cabecera: firmaDe(CUERPO) }),
    'sin-secreto',
  )
})

test('sin cabecera lo dice', () => {
  assert.strictEqual(evaluarFirmaMeta({ secreto: SECRETO, crudo: CUERPO, cabecera: '' }), 'sin-cabecera')
})

test('sin cuerpo lo dice', () => {
  assert.strictEqual(evaluarFirmaMeta({ secreto: SECRETO, crudo: '', cabecera: firmaDe(CUERPO) }), 'sin-cuerpo')
})

test('una cabecera con formato raro no se confunde con un fallo de firma', () => {
  for (const raro of ['sha1=abc', 'abc123', 'sha256=', 'sha256=nohex', 'sha256=' + 'a'.repeat(63)]) {
    assert.strictEqual(
      evaluarFirmaMeta({ secreto: SECRETO, crudo: CUERPO, cabecera: raro }),
      'formato-raro',
      `${raro} debería dar formato-raro`,
    )
  }
})

test('acepta la firma en mayúsculas', () => {
  const f = firmaDe(CUERPO).toUpperCase().replace('SHA256=', 'sha256=')
  assert.strictEqual(evaluarFirmaMeta({ secreto: SECRETO, crudo: CUERPO, cabecera: f }), 'coincide')
})

test('observarFirmaMeta NUNCA lanza, pase lo que pase', () => {
  // Es lo único que importa de verdad hoy: observar no puede tumbar la
  // recepción de un mensaje de un cliente.
  for (const [cab, cru] of [[null, null], [undefined, undefined], [{}, {}], [123, 456], ['x', 'y']]) {
    assert.doesNotThrow(() => observarFirmaMeta(cab, cru))
  }
})

test('el archivo NO tiene ninguna rama que rechace', async () => {
  // Candado del acuerdo con Rodrigo: esto solo observa. Si alguien agrega un
  // rechazo acá sin discutirlo, esta prueba se cae.
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/firma-meta.js', import.meta.url), 'utf8')
  // Se miran solo las líneas de CÓDIGO: los comentarios explican justamente que
  // acá no se rechaza, así que nombran 401 y 403 y harían fallar esto de gusto.
  const codigo = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')
  for (const prohibido of ['401', '403', 'NextResponse', 'throw new']) {
    assert.ok(!codigo.includes(prohibido), `firma-meta.js no puede contener "${prohibido}" en el código`)
  }
})
