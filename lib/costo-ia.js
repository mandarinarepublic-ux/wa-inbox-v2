// lib/costo-ia.js — Cuánto cuesta una respuesta del agente de IA (17-nov-2026).
//
// Se guarda por llamada en inbox.ia_consumo y se muestra por chat en la pestaña
// VENTAS. Es una ESTIMACIÓN: la factura real está en la consola de Anthropic.
//
// Precios en dólares por MILLÓN de tokens. Haiku 5.5: $0,10 entrada / $0,50 salida
// (prompt de hasta 100K tokens). Los de caché son los multiplicadores habituales
// sobre la entrada (lectura 0,1×, escritura 1,25×): si Anthropic publica otros,
// se cambian SOLO acá.
export const PRECIOS = {
  'claude-haiku-5-5': { entrada: 0.10, salida: 0.50, cacheLeida: 0.01, cacheEscrita: 0.125 },
}
const PRECIO_DEFECTO = PRECIOS['claude-haiku-5-5']

/**
 * @param {{ modelo?:string, sinCache?:number, cacheLeidos?:number, cacheEscritos?:number, salida?:number }} t
 * @returns {number} costo en dólares
 */
export function costoUSD({ modelo = '', sinCache = 0, cacheLeidos = 0, cacheEscritos = 0, salida = 0 } = {}) {
  const p = PRECIOS[String(modelo || '').trim()] || PRECIO_DEFECTO
  const n = (x) => Math.max(0, Number(x) || 0)
  return (n(sinCache) * p.entrada + n(cacheLeidos) * p.cacheLeida + n(cacheEscritos) * p.cacheEscrita + n(salida) * p.salida) / 1e6
}

/**
 * Del `tokens` que devuelve mandi-agent ({ input, output, cache_leidos, cache_escritos })
 * a las columnas de inbox.ia_consumo. `input` del agente es el TOTAL de entrada
 * (incluye lo leído y escrito en caché), así que lo sin caché es la resta.
 */
export function filaConsumo(tokens = {}, modelo = '') {
  const total = Math.max(0, Number(tokens.input) || 0)
  const cacheLeidos = Math.max(0, Number(tokens.cache_leidos) || 0)
  const cacheEscritos = Math.max(0, Number(tokens.cache_escritos) || 0)
  const sinCache = Math.max(0, total - cacheLeidos - cacheEscritos)
  const salida = Math.max(0, Number(tokens.output) || 0)
  return {
    modelo: modelo || null,
    tokens_sin_cache: sinCache,
    tokens_cache_leidos: cacheLeidos,
    tokens_cache_escritos: cacheEscritos,
    tokens_salida: salida,
    costo_usd: Number(costoUSD({ modelo, sinCache, cacheLeidos, cacheEscritos, salida }).toFixed(6)),
  }
}

/** "1.234.567" → "1,2 M" ; "45.300" → "45 mil" ; "800" → "800" */
export function tokensLegibles(n) {
  const x = Math.max(0, Number(n) || 0)
  if (x >= 1e6) return `${(x / 1e6).toLocaleString('es-EC', { maximumFractionDigits: 1 })} M`
  if (x >= 1e3) return `${Math.round(x / 1e3).toLocaleString('es-EC')} mil`
  return String(Math.round(x))
}

/** Dólares con los decimales que hagan falta para no mostrar "$0,00" cuando hay gasto. */
export function dolaresLegibles(usd) {
  const x = Math.max(0, Number(usd) || 0)
  const dec = x === 0 ? 2 : x < 0.01 ? 4 : x < 1 ? 3 : 2
  return `$${x.toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
}
