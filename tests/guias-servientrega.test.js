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
    { pedido_id: 'A', estado_pedido: 'ENTREGADO',  fecha_pedido: '2026-10-05' },
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

// ── Los 3 casos reales que fallaron en la prueba del 9-oct ──────────────────

test('celular ilegible: el nombre se encuentra encima de la DIRECCIÓN', () => {
  const ocr = 'E RODRIGO CASTILLO 1\ne QUITO\nE\nE MARILYN VALENCIA DELGADO\n5 osese17en\n+ CDLALA PAZ CALLE QUITO Y CORDOBA EN LA VETERINARIA\n9 PETCENTER'
  const o = extraerDeOcr(ocr, 'CDLA LA PAZ CALLE QUITO Y CORDOBA EN LA VETERINARIA PET CENTER')
  assert.deepEqual(o.celulares, [])
  assert.equal(o.nombre, 'MARILYN VALENCIA DELGADO')
})

test('línea vacía entre el nombre y el celular', () => {
  const o = extraerDeOcr('$ RODRIGO CASTILLO 1\ne QUITO\n\no\n\nE NAHIM ALEXANDER ORDENANA\n\n0969496462\n\n+ CIUDADELA 9 DE OCTUBRE')
  assert.deepEqual(o.celulares, ['0969496462'])
  assert.equal(o.nombre, 'NAHIM ALEXANDER ORDENANA')
})

test('nombres casi iguales: una letra de diferencia o un nombre de menos', () => {
  assert.equal(mismoNombre('Nahin Alexander Ordeñana Fajardo', 'NAHIM ALEXANDER ORDENANA'), true)
  assert.equal(mismoNombre('Marilyn Alexandra Valencia Delgado', 'MARILYN VALENCIA DELGADO'), true)
  assert.equal(mismoNombre('María Gabriela Calderón rosas ', 'MARIA GABRIELA CALDERON'), true)
  assert.equal(mismoNombre('Marilyn Pérez Delgado', 'MARILYN VALENCIA DELGADO'), false)   // solo 2 de 3
})

test('COMPLETADO reciente sí recibe guía; uno viejo no', () => {
  const ahora = Date.parse('2026-10-09T20:00:00Z')
  const reciente = [{ pedido_id: 'M', estado_pedido: 'COMPLETADO', fecha_pedido: '2026-09-14T02:19:56Z' }]
  assert.equal(elegirPedido(reciente, new Set(), ahora).pedido.pedido_id, 'M')
  const viejo = [{ pedido_id: 'V', estado_pedido: 'COMPLETADO', fecha_pedido: '2026-07-01T00:00:00Z' }]
  assert.equal(elegirPedido(viejo, new Set(), ahora).pedido, null)
  const cancelado = [{ pedido_id: 'C', estado_pedido: 'CANCELADO', fecha_pedido: '2026-10-08T00:00:00Z' }]
  assert.equal(elegirPedido(cancelado, new Set(), ahora).pedido, null)
})

// ── Fecha impresa en la guía y bitácora ─────────────────────────────────────
import { fechaDeGuia, fechaCortaEc, textoBitacora } from '../lib/guias-servientrega.js'

test('la fecha impresa en la guía, en hora de Ecuador', () => {
  assert.equal(fechaDeGuia(OCR), '2026-10-06T19:20:00-05:00')
  assert.equal(fechaDeGuia('06 - Dic - 2026 | 8:05'), '2026-12-06T08:05:00-05:00')
  assert.equal(fechaDeGuia('sin fecha'), '')
  assert.equal(extraerDeOcr(OCR).fecha, '2026-10-06T19:20:00-05:00')
  assert.equal(fechaCortaEc('2026-10-06T19:20:00-05:00'), '06-oct 19:20')
  assert.equal(fechaCortaEc('2026-10-10T03:34:27.913Z'), '09-oct 22:34')   // UTC → Ecuador
})

test('la bitácora lleva los datos del despacho', () => {
  const t = textoBitacora({ numero: '9036647895', foto: 'x', fechaGuia: '2026-10-06T19:20:00-05:00', destino: 'PORTOVIEJO', destinatario: 'MARILYN VALENCIA DELGADO', celular: '0988817811', direccion: 'CDLA LA PAZ', metodo: 'nombre' })
  assert.equal(t, 'SERVIENTREGA #9036647895 📷 · despachada 06-oct 19:20 · PORTOVIEJO · para MARILYN VALENCIA DELGADO (0988817811) · CDLA LA PAZ · auto por nombre')
  assert.equal(textoBitacora({ numero: '1' }), 'SERVIENTREGA #1')
})

// ── Pruebas de identidad (10-oct): "no puede descuadrar" ────────────────────
import { cedulaValida, cedulasDeOcr, celularCasiIgual, direccionParecida } from '../lib/guias-servientrega.js'

test('cédula ecuatoriana: dígito verificador; un celular no pasa por cédula', () => {
  assert.equal(cedulaValida('0944141217'), '0944141217')
  assert.equal(cedulaValida('1722759527001'), '1722759527')   // RUC persona natural
  assert.equal(cedulaValida('1313368837 '), '1313368837')
  assert.equal(cedulaValida('0986091779'), '')                // celular de Danny
  assert.equal(cedulaValida('0944141218'), '')                // verificador malo
  assert.deepEqual(cedulasDeOcr(OCR), [])                     // la guía de hoy NO trae cédula
  assert.deepEqual(cedulasDeOcr('CI: 2300005085\n0986091779'), ['2300005085'])
})

test('celular casi igual: un dígito de diferencia, no dos', () => {
  assert.equal(celularCasiIgual('0970766574', '0979766574'), true)    // Erika Guerrón
  assert.equal(celularCasiIgual('0982128270', '0982128279'), true)    // Byron Serpa
  assert.equal(celularCasiIgual('0969496462', '0969469462'), false)   // Nahim: 2 dígitos cambiados
  assert.equal(celularCasiIgual('', '0969469462'), false)
})

test('dirección parecida: 3 palabras en común sin contar CALLE, ENTRE…', () => {
  assert.equal(direccionParecida('Cdla 9 de Octubre, Ana Moreno de Safadi 308', 'CIUDADELA 9 DE OCTUBRE ANA MORENO DE SAFADI 308'), true)
  assert.equal(direccionParecida('Guayaquil: Kennedy norte Mz 302 Villa 10…', 'KENNEDY NORTE MZ 302 VILLA 10 REF CLL MIGUEL H. ALCIVAR'), true)
  assert.equal(direccionParecida('piñas centro', 'PINAS AV SUCRE Y 10 DE AGOSTO / SUCRE E/10 DE AGOSTO'), false)
  assert.equal(direccionParecida('Calle principal y entre calles', 'CALLE PRINCIPAL ENTRE CALLES'), false)
})

// ── "En caso de duda no registres" (10-oct) ─────────────────────────────────
import { nombreCompatible } from '../lib/guias-servientrega.js'

test('nombre compatible: basta una palabra en común; otro nombre = duda', () => {
  assert.equal(nombreCompatible('Gabriela Gaon', 'GAON PATINO NATHALY GABRIELA'), true)
  assert.equal(nombreCompatible('Erika Guerron', 'GUERRON OSORIO ERIKA GEOVANNA'), true)
  assert.equal(nombreCompatible('Pedro Castillo', 'DANNY FABIAN RODRIGUEZ RIVERA'), false)   // celular de otro
  assert.equal(nombreCompatible('Danny Rodriguez', ''), true)                              // sin nombre leído: no contradice
})

test('varios pedidos posibles se informa con cuántos (para no registrar solo)', () => {
  const ahora = Date.parse('2026-10-09T20:00:00Z')
  const r = elegirPedido([
    { pedido_id: 'X1', estado_pedido: 'EN_FABRICA', fecha_pedido: '2026-10-01T00:00:00Z' },
    { pedido_id: 'X2', estado_pedido: 'DESPACHO',   fecha_pedido: '2026-10-05T00:00:00Z' },
  ], new Set(), ahora)
  assert.equal(r.posibles, 2)
  assert.equal(r.pedido.pedido_id, 'X2')
})
