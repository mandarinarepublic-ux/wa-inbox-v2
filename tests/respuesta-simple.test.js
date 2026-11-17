import test from 'node:test'
import assert from 'node:assert'
import { clasificarSimple, decidirRespuestaSimple, TEXTOS_DEFAULT } from '../lib/respuesta-simple.js'

// Casos REALES de MANDI (30 días al 17-nov-2026), tal como los escribieron.
const SI = {
  espera: ['?', '??', '???????', '..?', '¿?'],
  contra_entrega: ['hacen pago contraentrega', '¿Tienen contra entrega?'],
  internacional: [
    'envían a españa?', 'soy de colombia , tienen envío internacional',
    'Envian a Bolivia?', 'hacen envíos a otro país?',
  ],
  envio: [
    '¿cuánto cuesta el envío?', 'hola está en $35  incluido envío?',
    'consulta y el envío a guayaquil cuál es el costo adicional',
    'envían por servientrega verdad?', 'Hacen envíos a Cuenca?',
    'perfecto! en qué precio está? y cuanto me saldría con envío a azogues por servientrega?',
  ],
  ubicacion: ['donde se encuentran ubicados 🫡', '¿Dónde están?', 'tienen tienda física?'],
  factura: ['¿Emiten factura?', 'dan factura?'],
}

// Casos REALES que NO son simples: posventa, datos, contexto de producto.
const NO = [
  'cuándo llegaría el pedido?',
  'hola buenas tardes, disculpe una consulta, el pedido que realice para q fecha podría estar llegando?',
  'buenos dias, el pedido todavía no llega y ya han pasado las 72 horas',
  'buen día, me podría decir en qué agencia de servientrega de riobamba llego mi pedido por favor',
  'está cancelado, cundo me lo envían?',
  'la dirección le podria enviar la ubicación por aqui mejor?',
  'ya me envió un mensaje los señores de servientrega',
  'me indica cuando ya estaría en servientrega',
  '*factura*\nJostyn Mera\n1315804334\n0983754077',
  'buenos días, ya sabe que paso con el envío?',
  'que valor tiene', 'talla l', 'hola', 'buenas tardes', '.', '🗿', '',
  'a cuánto quedaría con tarjeta y se puede diferirlo?',
]

for (const [intencion, casos] of Object.entries(SI)) {
  for (const c of casos) {
    test(`"${c}" → ${intencion}`, () => assert.equal(clasificarSimple(c), intencion))
  }
}
for (const c of NO) {
  test(`"${c.slice(0, 50)}" → null (lo atiende una persona)`, () => assert.equal(clasificarSimple(c), null))
}

const base = { config: { activo: true }, canal: 'MANDI', tipoCrudo: 'text', texto: 'dan factura?', iaPrendida: false, humanoAtendiendo: false }

test('apagado por defecto: sin config no sale nada', () => {
  assert.equal(decidirRespuestaSimple({ ...base, config: undefined }), null)
  assert.equal(decidirRespuestaSimple({ ...base, config: { activo: false } }), null)
})

test('prendido: devuelve el texto fijo de la intención', () => {
  assert.deepEqual(decidirRespuestaSimple(base), { intencion: 'factura', texto: TEXTOS_DEFAULT.factura })
})

test('un botón tocado (tipo texto, crudo interactive) no dispara', () => {
  assert.equal(decidirRespuestaSimple({ ...base, tipoCrudo: 'interactive' }), null)
})

test('con la IA llevando el chat, contesta la IA y no esto', () => {
  assert.equal(decidirRespuestaSimple({ ...base, iaPrendida: true }), null)
})

test('con una persona atendiendo, no se interrumpe', () => {
  assert.equal(decidirRespuestaSimple({ ...base, humanoAtendiendo: true }), null)
})

test('canal desconocido NO contesta (manda mensajes: lo seguro es callar)', () => {
  assert.equal(decidirRespuestaSimple({ ...base, canal: null }), null)
})

test('se apaga por número sin tocar el otro', () => {
  const config = { activo: true, canales: { REPUBLIC: false } }
  assert.equal(decidirRespuestaSimple({ ...base, config, canal: 'REPUBLIC' }), null)
  assert.ok(decidirRespuestaSimple({ ...base, config, canal: 'MANDI' }))
})

test('se apaga por intención, o dejando su texto vacío', () => {
  assert.equal(decidirRespuestaSimple({ ...base, config: { activo: true, intenciones: { factura: false } } }), null)
  assert.equal(decidirRespuestaSimple({ ...base, config: { activo: true, textos: { factura: '  ' } } }), null)
})

test('un texto editado reemplaza al de fábrica', () => {
  const r = decidirRespuestaSimple({ ...base, config: { activo: true, textos: { factura: 'Sí, factura SRI 🧡' } } })
  assert.equal(r.texto, 'Sí, factura SRI 🧡')
})

// Segunda ronda: 60 días de MANDI, frases que mencionan envío/local/factura.
const MAS_SI = {
  ubicacion: ['De dónde son', 'Dónde está ubicado?', 'Dónde se ubican??', 'Tienen local en Guayaquil?'],
  internacional: ['Olá, fazem envio para Portugal?', 'Tienen envíos fuera de ecuador', 'Hola hacen Envios á Venezuela?'],
  envio: ['El precio incluye el envio', 'Hacen envios a sangolqui?', 'Envían por Servientrega verdad?'],
  contra_entrega: ['Es pago contra entrega o hay que cancelar y enviar captura de factura'],
}
const MAS_NO = [
  'Hola! Me interesa este producto: Chaqueta Dragon Ball Z Ecuador | Envío Gratis 🐉',
  'Me interesa Chaqueta Dragon Ball Z Roja Ecuador | Envío Gratis 🐉. (Azul, XL)',
  'Por servientrega está bien', 'Me gustaría que sea por Servientrega',
  'Buenos días una pregunta cuánto tarda el envío?',
  'Buenas tardes, no me han enviado la factura aun',
  'Puedo pasar mañana por el local y me ayuda con la devolución',
  'Talla M,\nEstán en Quito?\nDonde?',
  'Es q la compra podría realizarse con un método de pago internacional',
]
for (const [intencion, casos] of Object.entries(MAS_SI)) {
  for (const c of casos) test(`(60d) "${c}" → ${intencion}`, () => assert.equal(clasificarSimple(c), intencion))
}
for (const c of MAS_NO) test(`(60d) "${c.slice(0, 50)}" → null`, () => assert.equal(clasificarSimple(c), null))

// ── Comentarios reales de IG (60 días) ──
import { clasificarComentario, decidirRespuestaComentario } from '../lib/respuesta-simple.js'

const COM_SI = {
  interes: ['precio', 'Precio?', 'info', 'Información', 'quiero uno', 'Quiero el mio', 'cuánto', 'me interesa',
    'precio por favor', 'Hola precio de la chompa de eskeletor', 'valor por favor gracias', 'que tallas tienen',
    '@mandarinarepublicec hasta q talla tienen disponible'],
  internacional: ['¿hacen envíos para venezuela? por favor, digan que si', 'envío a panamá?', 'Envíos a España?', 'hacen envios a venezuela??'],
  envio: ['Hacen envíos a Guayaquil?'],
  ubicacion: ['woooow que bacán , buen día de dónde son???'],
}
const COM_NO = [
  'me estafaron, he realizado una compra el 17 de octubre y no me dan solución',
  'hay q decirlo..bastante triste el diseño el precio un robo...o me equivoco??',
  'batman', '🔥', '🙌', 'take my money!!!', '@guidobarcia0995', 'esta espectacular',
  'las hombreras, son de tela, gamusa o cuero?', '??',
]
for (const [i, casos] of Object.entries(COM_SI)) {
  for (const c of casos) test(`comentario "${c}" → ${i}`, () => assert.equal(clasificarComentario(c), i))
}
for (const c of COM_NO) test(`comentario "${c.slice(0, 45)}" → null`, () => assert.equal(clasificarComentario(c), null))

test('comentarios: apagados aunque WhatsApp esté prendido', () => {
  assert.equal(decidirRespuestaComentario({ config: { activo: true }, texto: 'precio' }), null)
  assert.equal(decidirRespuestaComentario({ config: { activo: false, comentarios_activo: true }, texto: 'precio' }), null)
  assert.equal(decidirRespuestaComentario({ config: { activo: true, comentarios_activo: true }, texto: 'precio' }).intencion, 'interes')
})
test('comentario editado no se contesta otra vez', () => {
  assert.equal(decidirRespuestaComentario({ config: { activo: true, comentarios_activo: true }, texto: 'precio', esNuevo: false }), null)
})
