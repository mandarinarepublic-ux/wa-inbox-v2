import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costoUSD, filaConsumo, tokensLegibles, dolaresLegibles } from '../lib/costo-ia.js'

test('un millón de tokens de entrada sin caché en Haiku 5.5 = $0,10; de salida = $0,50', () => {
  assert.equal(costoUSD({ modelo: 'claude-haiku-5-5', sinCache: 1e6 }), 0.10)
  assert.equal(costoUSD({ modelo: 'claude-haiku-5-5', salida: 1e6 }), 0.50)
})

test('la caché leída cuesta la décima parte de la entrada normal', () => {
  assert.equal(costoUSD({ cacheLeidos: 1e6 }), 0.01)
})

test('del total del agente se resta la caché: no se cobra dos veces', () => {
  // Una respuesta real de la sombra: ~33k de entrada (15k en caché) y 432 de salida.
  const f = filaConsumo({ input: 33472, output: 432, cache_leidos: 15000, cache_escritos: 0 }, 'claude-haiku-5-5')
  assert.equal(f.tokens_sin_cache, 18472)
  assert.equal(f.tokens_cache_leidos, 15000)
  assert.equal(f.tokens_salida, 432)
  // 18472×0,10 + 15000×0,01 + 432×0,50 = 1847,2 + 150 + 216 = 2213,2 por millón
  assert.equal(f.costo_usd, 0.002213)
})

test('modelo desconocido usa el precio de Haiku 5.5 y datos basura no rompen', () => {
  assert.equal(costoUSD({ modelo: 'otro', sinCache: 1e6 }), 0.10)
  assert.deepEqual(filaConsumo({ input: 'x', output: -5 }).costo_usd, 0)
})

test('se lee fácil: millones, miles y centavos', () => {
  assert.equal(tokensLegibles(1234567), '1,2 M')
  assert.equal(tokensLegibles(45300), '45 mil')
  assert.equal(tokensLegibles(800), '800')
  assert.equal(dolaresLegibles(0), '$0,00')
  assert.equal(dolaresLegibles(0.0022), '$0,0022')
  assert.equal(dolaresLegibles(0.05), '$0,050')
  assert.equal(dolaresLegibles(3.6), '$3,60')
})
