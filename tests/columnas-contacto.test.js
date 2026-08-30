// La lista de columnas que se le pide a `conversaciones` tiene que cubrir TODO
// lo que `toContacto` lee. Si no, la pantalla pierde una función EN SILENCIO.
//
// ⚠️ POR QUÉ ESTA PRUEBA. El sync pedía `select('*')`: traía las 30 columnas de
// las 1.804 conversaciones para usar 16 — 1.585 kB por ciclo, el 65% del
// payload y el rubro más caro de la factura de Vercel. Recortarlo es la mitad
// del ahorro, pero abre una trampa nueva:
//
//   alguien agrega un campo a `toContacto`, olvida agregar la columna, y ese
//   campo llega `undefined` para SIEMPRE. No revienta nada: simplemente el
//   alias no se ve, o la temperatura no se guarda, o la ventana de 24 h se
//   pinta mal. Es exactamente la familia "la pantalla miente".
//
// Por eso la prueba no compara contra una lista escrita a mano: LEE el código
// de `toContacto` y exige que cada columna que toca esté pedida. Si mañana
// alguien agrega `c.lo_que_sea`, esta prueba se cae hasta que la agregue.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COLS_CONTACTO } from '../lib/inbox-supabase.js'

const fuente = readFileSync(new URL('../lib/inbox-supabase.js', import.meta.url), 'utf8')

function columnasQueLeeToContacto() {
  const desde = fuente.indexOf('function toContacto(c) {')
  assert.ok(desde > -1, 'no encontré toContacto: si se renombró, hay que actualizar esta prueba')
  // hasta el cierre de la función (la primera línea que es solo "}")
  const fin = fuente.indexOf('\n}', desde)
  const cuerpo = fuente.slice(desde, fin)
  return [...new Set([...cuerpo.matchAll(/\bc\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]))]
}

test('se piden TODAS las columnas que la pantalla lee', () => {
  const pedidas = COLS_CONTACTO.split(',').map((s) => s.trim())
  const faltan = columnasQueLeeToContacto().filter((col) => !pedidas.includes(col))
  assert.deepEqual(
    faltan, [],
    `toContacto lee columnas que NADIE pide: ${faltan.join(', ')}.\n` +
    `Llegarían undefined en silencio. Agrégalas a COLS_CONTACTO.`,
  )
})

test('no se piden columnas que nadie usa', () => {
  // El otro lado de la moneda: cada columna de más son ~1.800 filas de peso en
  // CADA ciclo de sondeo. Si una deja de usarse, que se note acá.
  const leidas = columnasQueLeeToContacto()
  const sobran = COLS_CONTACTO.split(',').map((s) => s.trim()).filter((c) => !leidas.includes(c))
  assert.deepEqual(sobran, [], `Se piden columnas que toContacto ya no lee: ${sobran.join(', ')}`)
})

test('la lista no está vacía ni es un comodín', () => {
  // Un `*` acá volvería a traer las 30 columnas sin que nadie lo note.
  assert.ok(COLS_CONTACTO.length > 20)
  assert.equal(COLS_CONTACTO.includes('*'), false)
})
