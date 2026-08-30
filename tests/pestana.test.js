// Recordar en qué número quedaste al recargar.
//
// Hasta hoy la pestaña arrancaba SIEMPRE en el número principal: estaba fija en
// el código y no se guardaba en ningún lado. Rodrigo: "no entiendo por qué cada
// vez que recargo siempre regresa a MANDI y no a GENERAL".
//
// ☠️ POR QUÉ ESTO NO ES UN `localStorage.getItem` Y YA. La pestaña no solo pinta
// una lista: decide POR CUÁL NÚMERO SALEN LOS MENSAJES. Si se restaurara un
// valor que no corresponde a ningún canal real, la pantalla mostraría una cosa y
// el módulo de envíos quedaría apuntando a otra —o a ninguna—. Eso es el bug del
// número equivocado, que en estos inbox ya llegó a producción cinco veces.
//
// Por eso lo guardado se VALIDA contra la lista de canales reales antes de
// usarse, y ante cualquier duda se devuelve vacío: arrancar en el número por
// defecto es aburrido pero correcto; arrancar en uno inventado no lo es.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pestanaGuardada } from '../lib/pestana.js'

const VALIDAS = ['principal', 'secundario']

test('devuelve la pestaña guardada si es una de verdad', () => {
  assert.equal(pestanaGuardada('secundario', VALIDAS), 'secundario')
})

test('☠️ una pestaña que NO existe se descarta', () => {
  // El caso que importa: un canal viejo que se borró, un valor de otra versión,
  // basura en el navegador. Restaurarlo dejaría los envíos apuntando a la nada.
  assert.equal(pestanaGuardada('canal_que_ya_no_existe', VALIDAS), '')
  assert.equal(pestanaGuardada('GENERAL', VALIDAS), '')
})

test('sin nada guardado no se restaura nada', () => {
  assert.equal(pestanaGuardada(null, VALIDAS), '')
  assert.equal(pestanaGuardada('', VALIDAS), '')
  assert.equal(pestanaGuardada(undefined, VALIDAS), '')
})

test('los espacios de más no invalidan una pestaña buena', () => {
  assert.equal(pestanaGuardada('  principal  ', VALIDAS), 'principal')
})

test('sin lista de válidas NO se restaura, aunque venga algo', () => {
  // Ante la duda, el número por defecto. Nunca uno adivinado.
  assert.equal(pestanaGuardada('principal', []), '')
  assert.equal(pestanaGuardada('principal', null), '')
})

test('no se cuela un valor por parecerse', () => {
  // Nada de coincidencias parciales: o es exactamente un canal, o no es.
  assert.equal(pestanaGuardada('principal2', VALIDAS), '')
  assert.equal(pestanaGuardada('PRINCIPAL', VALIDAS), '')
})
