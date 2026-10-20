// Guardia (20-oct-2026): un pedido del catálogo que llega con el chat ABIERTO
// tiene que resolverse solo (nombre y foto), sin refrescar. Ver lib/hilos.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pedidosPorResolver } from '../lib/hilos.js'

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

test('un pedido sin resolver se pide; uno resuelto o ya pedido, no', () => {
  const msgs = [
    { id: 'a', tipo: 'order' },
    { id: 'b', tipo: 'order', pedido: { items: [] } },
    { id: 'c', tipo: 'texto' },
    { id: 'd', tipo: 'order' },
  ]
  assert.deepEqual(pedidosPorResolver(msgs, new Set(['d'])), ['a'])
  assert.deepEqual(pedidosPorResolver(null, new Set()), [])
})

test('App vuelve a leer el hilo cuando aparece un pedido sin resolver', () => {
  const s = readFileSync(`${raiz}components/App.jsx`, 'utf8')
  const i = s.indexOf('pedidosPorResolver(')
  assert.ok(i > 0, 'App.jsx ya no busca pedidos sin resolver')
  assert.match(s.slice(i, i + 600), /cargarHilo\(/)
})
