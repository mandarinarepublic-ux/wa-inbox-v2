// Guardia (20-oct-2026): al crear un PEDIDO MANUAL, el historial del panel tiene
// que recargarse solo. El efecto que lo carga corre UNA vez por teléfono
// (histLoadedRef), así que si `onCreado` no lo vuelve a pedir, el pedido nuevo
// no aparece hasta refrescar la página. Si alguien saca la recarga, esto se cae.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test('onCreado del PEDIDO MANUAL recarga el historial con el pedido recién creado', () => {
  const s = readFileSync(`${raiz}components/RightPanel.jsx`, 'utf8')
  const i = s.indexOf('onCreado={(aviso) => {')
  assert.ok(i > 0, 'no encontré el onCreado del PEDIDO MANUAL')
  const cuerpo = s.slice(i, s.indexOf('}}', i))
  assert.match(cuerpo, /loadHistorial\(activeConv\.telefono,\s*aviso\.pedidoId\)/)
})
