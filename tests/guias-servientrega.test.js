// Guías de Servientrega reenviadas al inbox (lib/guias-servientrega.js).
// Los textos son los REALES del 9-oct-2026 (pie de Servientrega + OCR de la foto).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  esTextoDeGuia, extraerDelTexto, extraerDeOcr, celularEc, mismoNombre, elegirPedido,
} from '../lib/guias-servientrega.js'

const PIE = '*¡Hola RODRIGO C.!*\n\nTu envió ha sido generado correctamente.\n\n📦 *Guía:* 9036647917\n📍 *Destino:* SANTO DOMINGO\n🏠 *Dirección de entrega:* SANTO DOMINGO AV. CHONE / AV. CHONE S/N Y AV. VICTOR ALFONSO LOPEZ (DIAGONALA MICUCHITO)\n\n_Se envió una notificación por WhatsApp al destinatario sobre este envío._\n\nGracias por confiar en Servientrega 💚'

const OCR = 'e QUITO\n+ QUITO NACIONES UNIDAS\nE RODRIGO CASTILLO 1\ne QUITO\ne\nE DANNY FABIAN RODRIGUEZ RIVERA\n0986091779\n7 RETIRA EN CS - SANTO DOMINGO AV. CHONE / AV. CHONE\nA S/N Y AV. VICTOR ALFONSO LOPEZ (DIAGONALA MICUCHITO)\n> o)\no) y SANTO DOMINGO\n2.00 0.00 0.00\n06-Oct-2026 | 19:20'

test('reconoce el pie de Servientrega y no un texto cualquiera', () => {
  assert.equal(esTextoDeGuia(PIE), true)
  assert.equal(esTextoDeGuia('Hola, ¿tienen la guía de tallas?'), false)
  assert.equal(esTextoDeGuia(''), false)
})

test('saca número, destino y dirección del pie', () => {
  const g = extraerDelTexto(PIE)
  assert.equal(g.numero, '9036647917')
  assert.equal(g.destino, 'SANTO DOMINGO')
  assert.match(g.direccion, /^SANTO DOMINGO AV\. CHONE/)
})

test('saca celular y nombre del destinatario de la foto', () => {
  const o = extraerDeOcr(OCR)
  assert.deepEqual(o.celulares, ['0986091779'])
  assert.equal(o.nombre, 'DANNY FABIAN RODRIGUEZ RIVERA')
})

test('un celular nuestro impreso en la guía no cuenta como destinatario', () => {
  const o = extraerDeOcr('RODRIGO CASTILLO\n0987498489\nMARIA PEREZ LOPEZ\n+593 99 111 2233')
  assert.deepEqual(o.celulares, ['0991112233'])
  assert.equal(o.nombre, 'MARIA PEREZ LOPEZ')
})

test('celulares en cualquier formato', () => {
  assert.equal(celularEc('593986091779'), '0986091779')
  assert.equal(celularEc('986091779'), '0986091779')
  assert.equal(celularEc('022345678'), '')     // fijo: no es celular
})

test('mismo nombre: todas las palabras del CRM tienen que estar en la guía', () => {
  assert.equal(mismoNombre('Danny Fabian Rodriguez Rivera ', 'DANNY FABIAN RODRIGUEZ RIVERA'), true)
  assert.equal(mismoNombre('Danny Rodríguez', 'DANNY FABIAN RODRIGUEZ RIVERA'), true)
  assert.equal(mismoNombre('Danny Pérez', 'DANNY FABIAN RODRIGUEZ RIVERA'), false)
  assert.equal(mismoNombre('Danny', 'DANNY FABIAN RODRIGUEZ RIVERA'), false)   // una sola palabra no alcanza
})

test('elige el pedido abierto más reciente sin guía', () => {
  const pedidos = [
    { pedido_id: 'A', estado_pedido: 'COMPLETADO', fecha_pedido: '2026-10-05' },
    { pedido_id: 'B', estado_pedido: 'EN_FABRICA', fecha_pedido: '2026-09-28' },
    { pedido_id: 'C', estado_pedido: 'DESPACHO',   fecha_pedido: '2026-10-01' },
  ]
  assert.equal(elegirPedido(pedidos).pedido.pedido_id, 'C')
  assert.equal(elegirPedido(pedidos, new Set(['C'])).pedido.pedido_id, 'B')
  const r = elegirPedido(pedidos, new Set(['B', 'C']))
  assert.equal(r.pedido, null)
  assert.match(r.motivo, /ya tiene guía/)
  assert.match(elegirPedido([]).motivo, /no tiene pedidos/)
})
