/**
 * REENTREGAS DE META: cuál de las dos versiones del mismo mensaje se queda.
 *
 * ☠️ EL BUG QUE ESTO CIERRA. Meta manda el MISMO wamid dos veces: primero un
 * placeholder `unsupported` ("This message is unavailable.") y ~0,4 s después
 * el mensaje de verdad, con su texto y su referral de pauta. El insert va con
 * `ignoreDuplicates: true` —guardia de idempotencia, correcta contra
 * duplicados— así que ganaba EL QUE LLEGABA PRIMERO, que es el peor.
 *
 * Medido en producción (60 días, auditoría del 4-sep-2026): 135 mensajes
 * quedaron como "⚠️ algo que no podemos mostrar" y 128 perdieron de qué anuncio
 * venía el cliente. Uno decía "Me interesa Chaqueta Dragon Ball Z - NARANJA".
 * En MANDI el placeholder llegó primero en 10 de 10 casos; en IND, en 119 de 139.
 *
 * ⚠️ POR QUÉ NO ALCANZA CON QUITAR `ignoreDuplicates`. Eso crea el bug al revés:
 * un placeholder que llegue TARDE pisaría el mensaje bueno. Y ese camino existe
 * de verdad — en IND el real llegó primero en 20 de 139 casos. La regla no es
 * "gana el último", es "gana el que tiene contenido".
 *
 * Vive acá, como función pura y con pruebas, por la misma razón que
 * `patchesDeMensaje` en lib/bandeja.js: la lógica que decide qué se pisa no
 * puede quedar enterrada entre dos `await` donde nadie la puede ejercitar.
 */

// Lo ÚNICO que una reentrega puede mejorar: el contenido del mensaje.
//
// ☠️ `telefono`, `conversacion_id`, `fecha`, `direccion` y `cuenta` quedan FUERA
// a propósito. Una reentrega tardía que los arrastrara movería el mensaje de
// chat o de bandeja, y hacer desaparecer a un cliente es el bug más reincidente
// de este inbox. Hay una prueba que se rompe si alguien mete uno de esos campos.
const CAMPOS_DE_CONTENIDO = ['tipo', 'texto', 'media_id', 'media_url', 'contexto_id', 'referral', 'raw', 'botones']

/**
 * El wamid YA existía. Devuelve las reparaciones a aplicar sobre la fila
 * guardada: `donde` es la GUARDIA (condición sobre el estado actual, para que
 * dos webhooks a 0,4 s no se pisen) y `set` es lo que se escribe.
 *
 * Lista vacía = lo que acaba de llegar no mejora nada. Es el caso normal.
 */
export function reparacionesDeReentrega(fila) {
  const reparaciones = []

  // 1. Llegó contenido real y lo guardado es el placeholder → se repone entero.
  //    La guardia `tipo: 'unsupported'` es la que hace esto seguro: si lo
  //    guardado ya tenía contenido, no toca nada.
  if (fila.tipo !== 'unsupported') {
    const set = {}
    for (const campo of CAMPOS_DE_CONTENIDO) set[campo] = fila[campo] ?? null
    reparaciones.push({ donde: { tipo: 'unsupported' }, set })
  }

  // 2. Trae referral y lo guardado no tiene → se rellena. Cubre el caso en que
  //    la fila guardada YA tenía contenido (la reparación 1 no aplica) pero le
  //    faltaba de qué anuncio venía. Solo rellena vacíos: nunca pisa uno lleno.
  if (fila.referral) {
    reparaciones.push({ donde: { referral: null }, set: { referral: fila.referral } })
  }

  return reparaciones
}
