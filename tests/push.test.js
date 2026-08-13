import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { recortar, cuerpoDeMensaje, debeSonar, VENTANA_SONIDO_MS, avisoDeEntrante } from '../lib/push.js'

test('recortar deja los textos cortos intactos', () => {
  assert.equal(recortar('hola'), 'hola')
})

test('recortar colapsa espacios y saltos de linea', () => {
  assert.equal(recortar('hola   \n  mundo'), 'hola mundo')
})

test('recortar corta y agrega puntos suspensivos', () => {
  const largo = 'a'.repeat(200)
  const r = recortar(largo, 10)
  assert.equal(r.length, 10)
  assert.ok(r.endsWith('…'))
})

test('recortar tolera null y undefined', () => {
  assert.equal(recortar(null), '')
  assert.equal(recortar(undefined), '')
})

test('cuerpoDeMensaje usa el texto cuando es un mensaje de texto', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: 'quiero el vestido' }), 'quiero el vestido')
})

test('cuerpoDeMensaje describe una foto sin caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: '' }), '📷 Foto')
})

test('cuerpoDeMensaje combina descriptor y caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: 'esta talla' }), '📷 Foto · esta talla')
})

test('cuerpoDeMensaje nunca queda vacio', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: '   ' }), 'Mensaje nuevo')
})

test('debeSonar suena la primera vez', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

test('debeSonar NO suena dentro de la ventana', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  assert.equal(debeSonar(hace10seg, ahora), false)
})

test('debeSonar vuelve a sonar pasada la ventana', () => {
  const ahora = Date.now()
  const hace2min = new Date(ahora - 2 * 60 * 1000).toISOString()
  assert.equal(debeSonar(hace2min, ahora), true)
})

test('debeSonar ignora una fecha corrupta y suena', () => {
  assert.equal(debeSonar('no-es-fecha', Date.now()), true)
})

test('la ventana de sonido es de 60 segundos, no de 5 minutos', () => {
  assert.equal(VENTANA_SONIDO_MS, 60 * 1000)
})

// Contestar borra ultimo_push_at (lo hace limpiarPush desde /api/saliente).
// Con el significado nuevo eso quiere decir: la próxima entrante suena sí o sí.
test('tras contestar, el siguiente mensaje vuelve a sonar', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

const ENTRANTE = { telefono: '593999111222', nombre: 'Karilu', tipo: 'texto', contenido: 'hola' }

// LA prueba de la garantía: dentro de la ventana el aviso EXISTE igual.
// Si alguien vuelve a usar debeSonar como guarda de envio, esto se cae.
test('avisoDeEntrante devuelve un aviso aunque NO toque sonar', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  const aviso = avisoDeEntrante(ENTRANTE, hace10seg, ahora)
  assert.ok(aviso, 'SIEMPRE tiene que haber aviso')
  assert.equal(aviso.renotify, false, 'pero callado')
  assert.equal(aviso.tel, '593999111222')
  assert.ok(aviso.cuerpo, 'con cuerpo, no vacio')
})

test('avisoDeEntrante suena cuando la ventana ya paso', () => {
  const ahora = Date.now()
  const hace2min = new Date(ahora - 2 * 60 * 1000).toISOString()
  assert.equal(avisoDeEntrante(ENTRANTE, hace2min, ahora).renotify, true)
})

test('avisoDeEntrante suena la primera vez (sin aviso previo)', () => {
  assert.equal(avisoDeEntrante(ENTRANTE, null, Date.now()).renotify, true)
})

// Lo unico que cambia entre sonar y no sonar es `renotify`. Si algun dia cambia
// algo mas, es que la ventana empezo a decidir cosas que no le tocan.
test('la ventana SOLO cambia renotify, nada mas del aviso', () => {
  const ahora = Date.now()
  const callado = avisoDeEntrante(ENTRANTE, new Date(ahora - 10 * 1000).toISOString(), ahora)
  const sonoro  = avisoDeEntrante(ENTRANTE, null, ahora)
  assert.deepEqual({ ...callado, renotify: null }, { ...sonoro, renotify: null })
})

test('avisoDeEntrante cae al telefono cuando no hay nombre', () => {
  const sinNombre = { ...ENTRANTE, nombre: '' }
  assert.ok(avisoDeEntrante(sinNombre, null, Date.now()).titulo.includes('593999111222'))
})

// ── Reja estructural del webhook ─────────────────────────────────────────────
// `avisarSiCorresponde` es un closure dentro de `procesar`: no se exporta y no hay
// forma de llamarlo desde acá. Y es JUSTO ahí donde vive la garantía de este plan:
// el aviso se manda SIEMPRE, y la ventana solo decide si suena.
//
// Sacarlo a lib/ seria mas elegante, pero obliga a operar la ruta por donde entra
// cada mensaje de cada clienta. Asi que en vez de eso leemos el archivo y afirmamos
// su FORMA. Es fragil ante un reformateo — y es a proposito: preferimos un test que
// se queje de mas a que vuelva en silencio el bug de los 12 chats sin contestar.
//
// Lo que se exige, sin vueltas: el envío es INCONDICIONAL, punto. No importa la
// forma que se use para condicionarlo — un `if` nuevo, un `if` que envuelva TODO
// desde antes del `add`, un `&&` de corto-circuito, un ternario — cualquiera de
// esas formas tiene que romper este test. No se trata de cazar la palabra
// `return`: se trata de que `enviarPush` corra siempre que la función corra.
test('el webhook manda el aviso SIN condicion (reja estructural)', () => {
  const ruta = new URL('../app/api/webhook/route.js', import.meta.url)
  const src = readFileSync(ruta, 'utf8')

  const desde = src.indexOf('async function avisarSiCorresponde')
  assert.ok(desde > 0, 'no encontre avisarSiCorresponde — si la renombraste, actualiza esta reja')
  // El cuerpo termina en el primer cierre de funcion a dos espacios de sangria.
  const hasta = src.indexOf('\n  }', desde)
  assert.ok(hasta > desde, 'no pude delimitar el cuerpo de avisarSiCorresponde')
  const cuerpo = src.slice(desde, hasta)

  assert.ok(cuerpo.includes('enviarPush('), 'el webhook tiene que mandar el aviso')

  // UN solo return: el de `avisados`, que evita dos avisos del mismo lote. Cualquier
  // otro return es una guarda de envio y eso es exactamente lo que arreglamos.
  const returns = cuerpo.match(/\breturn\b/g) || []
  assert.equal(returns.length, 1, `avisarSiCorresponde tiene ${returns.length} returns; solo puede tener el de avisados`)
  assert.ok(cuerpo.includes('if (avisados.has('), 'el unico return permitido es el de avisados')

  // Y entre el add y el envio no puede aparecer ningun `if`.
  const desdeAdd = cuerpo.indexOf('avisados.add(')
  const desdeEnvio = cuerpo.indexOf('enviarPush(')
  assert.ok(desdeAdd > 0 && desdeEnvio > desdeAdd, 'el orden esperado es: add, despues enviar')
  assert.ok(
    !cuerpo.slice(desdeAdd, desdeEnvio).includes('if '),
    'apareció un `if` entre avisados.add y enviarPush: eso es una guarda de envio',
  )

  // UN solo `if` en TODA la funcion: el de `avisados`. Esto tapa la variante que
  // las dos aserciones de arriba no ven — envolver la función ENTERA (add incluido)
  // en un `if (debeSonar(...))` puesto ANTES del `add`: ahí sigue habiendo un solo
  // `return`, sigue estando `if (avisados.has(`, y no hay ningún `if` ENTRE el add
  // y el envío porque los dos quedaron adentro del mismo bloque condicional.
  const ifs = cuerpo.match(/\bif\s*\(/g) || []
  assert.equal(ifs.length, 1, `avisarSiCorresponde tiene ${ifs.length} ifs; solo puede tener el de avisados`)

  // Y el envío va SOLO en su línea: nada de `&&` de corto-circuito ni ternario
  // delante de `enviarPush(` disfrazando una condición sin `if` ni `return`.
  const lineaEnvio = cuerpo.split('\n').find((l) => l.includes('enviarPush('))
  assert.match(
    lineaEnvio.trim(),
    /^await enviarPush\(/,
    `el envio tiene que ser incondicional, y salio: ${lineaEnvio.trim()}`,
  )
})
