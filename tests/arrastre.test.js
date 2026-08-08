// El asa del panel derecho quedaba "pegada" y el panel seguía al mouse sin que
// nadie apretara nada. Causa: el iframe del CRM es de otro origen y se come el
// `mouseup`. Esto prueba el cinturón de seguridad.
import test from 'node:test'
import assert from 'node:assert'
import { decidirArrastre } from '../lib/arrastre.js'

test('sin arrastre en curso no se hace nada', () => {
  assert.strictEqual(decidirArrastre({ arrastrando: false, botones: 1 }), 'nada')
  assert.strictEqual(decidirArrastre({ arrastrando: false, botones: 0 }), 'nada')
})

test('arrastrando con el botón apretado, se mueve', () => {
  assert.strictEqual(decidirArrastre({ arrastrando: true, botones: 1 }), 'mover')
})

test('arrastrando SIN botón apretado, se suelta', () => {
  // Acá está el arreglo: el `mouseup` se perdió (lo comió el iframe del CRM, o
  // se soltó fuera de la ventana, o hubo un alt+tab). El primer movimiento sin
  // botón corta el arrastre en vez de seguir redimensionando.
  assert.strictEqual(decidirArrastre({ arrastrando: true, botones: 0 }), 'soltar')
})

test('en táctil no hay `buttons` y se sigue moviendo', () => {
  // Los touchmove/touchend van siempre al elemento donde empezó el toque, aunque
  // el dedo pase por encima del iframe: el táctil no tiene este agujero. Si se
  // tratara `undefined` como 0, se cortaría el arrastre en el celular al primer
  // movimiento.
  assert.strictEqual(decidirArrastre({ arrastrando: true, botones: undefined }), 'mover')
  assert.strictEqual(decidirArrastre({ arrastrando: true }), 'mover')
})

test('varios botones a la vez siguen contando como apretado', () => {
  // e.buttons es una máscara de bits: 3 = izquierdo + derecho.
  assert.strictEqual(decidirArrastre({ arrastrando: true, botones: 3 }), 'mover')
})
