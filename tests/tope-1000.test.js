// ☠️ PostgREST corta en 1000 filas e IGNORA un `.limit()` mayor sin avisar.
// Mordió cuatro veces (lista, contactos, bandejas, historial de la IA).
// Guardia: toda lectura con un tope por defecto mayor a 1000 tiene que paginar.
import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

const fuente = readFileSync(new URL('../lib/inbox-supabase.js', import.meta.url), 'utf8')

test('ninguna lectura pide más de 1000 filas sin paginarLimite', () => {
  const re = /export async function (\w+)\(([^)]*)\)\s*\{/g
  const malas = []
  let m
  while ((m = re.exec(fuente))) {
    const def = /limite\s*=\s*(\d+)/.exec(m[2])
    if (!def || Number(def[1]) <= 1000) continue
    const cuerpo = fuente.slice(m.index, fuente.indexOf('\n}\n', m.index))
    if (!cuerpo.includes('paginarLimite')) malas.push(`${m[1]} (limite = ${def[1]})`)
  }
  assert.deepEqual(malas, [], `Pagina estas lecturas o baja el tope: ${malas.join(', ')}`)
})

test('el historial de la IA filtra el teléfono EN LA BASE, no en memoria', () => {
  const i = fuente.indexOf('export async function getConversacionSupabase')
  const cuerpo = fuente.slice(i, fuente.indexOf('\n}\n', i))
  assert.match(cuerpo, /\.like\('telefono'/)
})
