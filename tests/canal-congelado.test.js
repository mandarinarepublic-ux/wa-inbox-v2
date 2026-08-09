// El canal de un envío se congela cuando se ENCOLA, no cuando sale.
//
// Por qué existe esta prueba: `CANAL_ACTIVO` vive a nivel de módulo en
// lib/api-client.js y decide EL NÚMERO REAL por el que sale el WhatsApp. Las
// tandas de envío (una respuesta rápida de 5-10 fotos, un bucle de hasta 10
// archivos con pausas) tardan segundos, y mientras salen el vendedor hace lo
// normal en la pestaña GENERAL: clic en el siguiente chat. Ese clic mueve
// `CANAL_ACTIVO`, así que lo que faltaba de la tanda salía por el otro número —
// a los clientes que escribieron a los dos, por el equivocado; al resto Meta se
// lo rechaza y la tanda se corta a la mitad.
//
// El arreglo es pasar el canal EXPLÍCITO hasta el fetch. Acá se fija el
// contrato: el explícito gana, el del módulo queda de respaldo, y mover
// `CANAL_ACTIVO` a mitad de camino no toca un envío ya congelado. Es el defecto
// más fácil de que vuelva sin que nadie se entere (un parámetro que alguien
// deja de pasar no rompe nada visible: sigue enviando, solo que por el número
// que no es).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setCanalActivo, getCanalActivo,
  sendReply, sendImageUrl, sendImageFile, sendInteractiveButtons, precacheMedia,
} from '../lib/api-client.js'
import { phoneIdDeCanal } from '../lib/canales.js'

const MANDI    = phoneIdDeCanal('MANDI')
const REPUBLIC = phoneIdDeCanal('REPUBLIC')

const fetchReal = global.fetch

/**
 * Reemplaza `fetch` y devuelve el registro de lo que se mandó.
 * La subida de media contesta con un id para que `sendImageFile` siga por su
 * camino bueno (sin id se iría por el respaldo).
 */
function espiarFetch() {
  const llamadas = []
  global.fetch = async (url, opts = {}) => {
    let body = {}
    try { body = JSON.parse(opts.body) } catch { /* FormData: no es JSON */ }
    llamadas.push({ url, body })
    return { ok: true, json: async () => (url === '/api/media/upload' ? { id: 'media_1' } : {}) }
  }
  return llamadas
}

function restaurar() {
  global.fetch = fetchReal
  setCanalActivo('MANDI')   // el módulo arranca así; que una prueba no ensucie a la otra
}

test('el canal explícito gana sobre el canal activo del módulo', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('MANDI')
  await sendReply('593999111222', 'Ana', 'hola', '', REPUBLIC)
  assert.equal(llamadas.at(-1).body.Canal, REPUBLIC)
})

test('sin canal explícito manda el del módulo (respaldo de siempre)', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('REPUBLIC')
  await sendReply('593999111222', 'Ana', 'hola')
  assert.equal(llamadas.at(-1).body.Canal, REPUBLIC)
  assert.equal(getCanalActivo(), REPUBLIC)
})

test('cambiar de chat a mitad de tanda NO desvía lo que ya estaba congelado', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  // El vendedor abre un chat de REPUBLIC en GENERAL y dispara 3 fotos.
  setCanalActivo('REPUBLIC')
  const canal = getCanalActivo()          // <- lo que hace App.jsx al encolar
  await sendImageUrl('593999111222', 'Ana', 'https://x/1.jpg', 'id1', canal)
  // Clic en el siguiente chat, que es de MANDI: el módulo se mueve.
  setCanalActivo('MANDI')
  await sendImageUrl('593999111222', 'Ana', 'https://x/2.jpg', 'id2', canal)
  await sendImageUrl('593999111222', 'Ana', 'https://x/3.jpg', 'id3', canal)
  assert.deepEqual(llamadas.map(l => l.body.Canal), [REPUBLIC, REPUBLIC, REPUBLIC])
})

test('sin congelar, la misma tanda se parte en dos números (lo que se arregló)', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('REPUBLIC')
  await sendImageUrl('593999111222', 'Ana', 'https://x/1.jpg')
  setCanalActivo('MANDI')
  await sendImageUrl('593999111222', 'Ana', 'https://x/2.jpg')
  // Este es el comportamiento VIEJO, y sigue siendo el de quien no pasa canal.
  // Queda escrito para que se vea que el respaldo no se rompió y que la
  // diferencia entre pasarlo y no pasarlo es real, no cosmética.
  assert.deepEqual(llamadas.map(l => l.body.Canal), [REPUBLIC, MANDI])
})

test('los botones interactivos también llevan el canal congelado', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('MANDI')
  await sendInteractiveButtons('593999111222', 'Ana', 'elige', [{ id: 'b1', title: 'Sí' }], REPUBLIC)
  assert.equal(llamadas.at(-1).body.Canal, REPUBLIC)
})

test('la foto del computador (media id) lleva el canal congelado', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('MANDI')
  const file = new File(['xx'], 'foto.jpg', { type: 'image/jpeg' })
  await sendImageFile('593999111222', 'Ana', file, 'https://x/permanente.jpg', REPUBLIC)
  const envio = llamadas.at(-1)
  assert.equal(envio.url, '/api/saliente')
  assert.equal(envio.body.Canal, REPUBLIC)
  assert.equal(envio.body.ImagenMediaId, 'media_1')
})

test('precacheMedia pide los media id del canal congelado', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  // Un media_id de Meta vale SOLO para el phone_id que lo subió: precachear con
  // el canal de la pestaña nueva deja ids que esta tanda no puede usar.
  setCanalActivo('MANDI')
  await precacheMedia(['https://x/1.jpg', 'https://x/2.jpg'], REPUBLIC)
  assert.equal(llamadas.at(-1).body.canal, REPUBLIC)
})

test('precacheMedia sin canal explícito sigue usando el del módulo', async (t) => {
  t.after(restaurar)
  const llamadas = espiarFetch()
  setCanalActivo('REPUBLIC')
  await precacheMedia(['https://x/1.jpg'])
  assert.equal(llamadas.at(-1).body.canal, REPUBLIC)
})
