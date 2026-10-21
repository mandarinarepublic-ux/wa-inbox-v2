import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'

// El CRM deja en inbox.mensajes un aviso con direccion 'INTERNO' cuando entra un
// pedido web SIN PAGAR (MANDARINACRM: lib/pedidoWebPendiente.js). No es del
// cliente ni nuestro: se pinta aparte y no le habla a la IA.
const comp = readFileSync(new URL('../components/Components.jsx', import.meta.url), 'utf8')
const historial = readFileSync(new URL('../lib/inbox-supabase.js', import.meta.url), 'utf8')

test('la burbuja pinta el aviso INTERNO aparte, DESPUÉS de sus hooks', () => {
  const ini = comp.indexOf('export function MessageBubble(')
  const ultimoHook = comp.indexOf('useState(false)', comp.indexOf('setHover', ini))
  const rama = comp.indexOf("msg.direccion === 'INTERNO'", ini)
  assert.ok(rama > 0, 'falta la rama del aviso interno')
  assert.ok(rama > ultimoHook, 'un return antes de los useState rompe el orden de los hooks')
})

test('☠️ la IA no lee el aviso como si lo hubiera escrito el cliente', () => {
  assert.ok(/!==\s*'INTERNO'/.test(historial))
})
