// Para que WhatsApp pinte la burbuja de NOTA DE VOZ, Meta exige OGG con codec
// OPUS. Cualquier otro formato llega como archivo adjunto: suena igual pero se ve
// como un envío masivo en vez de una persona hablándote.
//
// Fish Audio exporta MP3, así que en la práctica SIEMPRE hay que convertir. Estas
// pruebas cubren la decisión —qué se convierte y qué se avisa—, que es donde se
// pierde un mensaje sin que nadie se dé cuenta. La conversión en sí necesita
// navegador (AudioContext + Worker) y se verifica en producción.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { esAudio, necesitaConversion, avisoDeFormato } from '../lib/audio-nota-voz.js'

const archivo = (name, type = '') => ({ name, type })

test('reconoce el audio por su tipo', () => {
  assert.ok(esAudio(archivo('saludo.mp3', 'audio/mpeg')))
  assert.ok(esAudio(archivo('nota.ogg', 'audio/ogg')))
  assert.ok(esAudio(archivo('voz.wav', 'audio/wav')))
})

test('reconoce el audio aunque el tipo venga vacío o MIENTA', () => {
  // Fish Audio suelta archivos `.mp3.mpeg` y Windows los marca como `video/mpeg`.
  // Si nos fiáramos solo del tipo, intentaríamos mandarlos como VIDEO y Meta los
  // rechazaría — un mensaje perdido por un nombre de archivo raro.
  assert.ok(esAudio(archivo('Goku-2026-08-21.mp3.mpeg', 'video/mpeg')))
  assert.ok(esAudio(archivo('saludo.mp3', '')))
  assert.ok(esAudio(archivo('nota.opus', '')))
})

test('no confunde una foto ni un video con audio', () => {
  assert.ok(!esAudio(archivo('foto.jpg', 'image/jpeg')))
  assert.ok(!esAudio(archivo('clip.mp4', 'video/mp4')))
  assert.ok(!esAudio(null))
})

test('un MP3 SIEMPRE se convierte — es el caso real de todos los días', () => {
  assert.ok(necesitaConversion(archivo('saludo.mp3', 'audio/mpeg')))
  assert.ok(necesitaConversion(archivo('voz.wav', 'audio/wav')))
  assert.ok(necesitaConversion(archivo('grabacion.m4a', 'audio/mp4')))
})

test('un .ogg genérico TAMBIÉN se convierte, y es a propósito', () => {
  // Un `.ogg` puede llevar Vorbis en vez de Opus, y Meta rechaza ese: su
  // documentación dice "OPUS codecs only". Dar por bueno el contenedor manda el
  // mensaje a la basura; convertir por si acaso cuesta medio segundo.
  assert.ok(necesitaConversion(archivo('algo.ogg', 'audio/ogg')))
})

test('solo el Opus declarado pasa derecho', () => {
  assert.ok(!necesitaConversion(archivo('nota.opus', 'audio/opus')))
  assert.ok(!necesitaConversion(archivo('nota.ogg', 'audio/ogg;codecs=opus')))
})

test('el aviso dice la verdad ANTES de mandar, no después', () => {
  // Sin esto se manda un MP3 creyendo que es nota de voz, sale como adjunto, y uno
  // se entera cuando el cliente ya lo recibió. La pantalla mintiendo otra vez.
  assert.match(avisoDeFormato(archivo('saludo.mp3', 'audio/mpeg')), /convertirá/i)
  assert.match(avisoDeFormato(archivo('nota.opus', 'audio/opus')), /Ya está/i)
  assert.equal(avisoDeFormato(archivo('foto.jpg', 'image/jpeg')), '')
  assert.equal(avisoDeFormato(null), '')
})
