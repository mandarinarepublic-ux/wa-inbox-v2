import test from 'node:test'
import assert from 'node:assert'
import { extraer, contenidoTipoEspecial, parseContactos, telefonoParaChat } from '../lib/wa-mensaje.js'
import { toMensaje } from '../lib/inbox-supabase.js'

// Payload REAL de producción (inbox.mensajes.raw de un `type: "contacts"`).
// Antes el inbox mostraba solo "👤 Compartió un contacto (Jimena Ruiz)": el
// nombre sí, el número no.
const RAW = {
  type: 'contacts',
  contacts: [{
    name: { first_name: 'Jimena', last_name: 'Ruiz', formatted_name: 'Jimena Ruiz' },
    phones: [{ type: 'X-WhatsApp', phone: '+593 98 677 4094', wa_id: '593986774094' }],
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nN:Ruiz;Jimena;;;\nFN:Jimena Ruiz\nEND:VCARD',
    origin: 'other',
  }],
}

test('al RECIBIR, el texto guardado ya lleva el número (el poll no trae raw)', () => {
  const r = extraer(RAW)
  assert.equal(r.tipo, 'contacts')
  assert.equal(r.contenido, '👤 Compartió un contacto (Jimena Ruiz · +593 98 677 4094)')
})

test('del raw (hilo): nombre, teléfono, wa_id y el número listo para abrir el chat', () => {
  assert.deepEqual(parseContactos('', RAW), [{
    nombre: 'Jimena Ruiz',
    telefonos: [{ numero: '+593 98 677 4094', waId: '593986774094', tipo: 'X-WhatsApp', chat: '593986774094' }],
    correos: [],
  }])
})

test('del texto (poll en vivo, sin raw): sale el mismo número', () => {
  const texto = extraer(RAW).contenido
  const c = parseContactos(texto, null)
  assert.equal(c.length, 1)
  assert.equal(c[0].nombre, 'Jimena Ruiz')
  assert.equal(c[0].telefonos[0].numero, '+593 98 677 4094')
  assert.equal(c[0].telefonos[0].chat, '593986774094')
})

test('toMensaje arma msg.contactos con y sin raw, y el texto nunca queda vacío', () => {
  const texto = extraer(RAW).contenido
  const conRaw = toMensaje({ wa_message_id: 'w1', telefono: '593999', tipo: 'contacts', texto, raw: RAW })
  const sinRaw = toMensaje({ wa_message_id: 'w1', telefono: '593999', tipo: 'contacts', texto })
  assert.equal(conRaw.contactos[0].telefonos[0].chat, '593986774094')
  assert.equal(sinRaw.contactos[0].telefonos[0].chat, '593986774094')
  assert.equal(sinRaw.mensaje, texto)
  // Un texto común no es un contacto.
  assert.equal(toMensaje({ wa_message_id: 'w2', tipo: 'texto', texto: '👤 Compartió un contacto (x)' }).contactos, null)
})

test('mensaje VIEJO (texto solo con el nombre, sin raw): se sigue viendo con el nombre', () => {
  const viejo = '👤 Compartió un contacto (Jimena Ruiz)'
  assert.deepEqual(parseContactos(viejo, null), [{ nombre: 'Jimena Ruiz', telefonos: [], correos: [] }])
  // Con el raw (hilo) el mensaje viejo sale completo, sin backfill.
  assert.equal(toMensaje({ wa_message_id: 'w3', tipo: 'contacts', texto: viejo, raw: RAW }).contactos[0].telefonos[0].chat, '593986774094')
  // Fila vieja sin texto ni raw: la etiqueta pelada, nunca vacío (trampa #1).
  assert.equal(toMensaje({ wa_message_id: 'w4', tipo: 'contacts', texto: '' }).mensaje, '👤 Compartió un contacto')
})

test('varios contactos, varios teléfonos y correo: todo se guarda y se recupera del texto', () => {
  const raw = {
    contacts: [
      RAW.contacts[0],
      {
        name: { first_name: 'Luis', last_name: 'Taller' },
        phones: [{ phone: '098 123 4567', type: 'CELL' }, { phone: '+1 (305) 555-1234', wa_id: '13055551234', type: 'WORK' }],
        emails: [{ email: 'luis@taller.ec', type: 'WORK' }],
      },
    ],
  }
  const texto = contenidoTipoEspecial('contacts', raw)
  assert.equal(texto, '👤 Compartió 2 contactos (Jimena Ruiz · +593 98 677 4094; Luis Taller · 098 123 4567 · +1 (305) 555-1234 · luis@taller.ec)')
  const c = parseContactos(texto, null)
  assert.equal(c.length, 2)
  assert.deepEqual(c[1].telefonos.map((t) => t.chat), ['593981234567', '13055551234'])
  assert.deepEqual(c[1].correos, ['luis@taller.ec'])
  // Del raw, el wa_id manda sobre los dígitos escritos.
  assert.deepEqual(parseContactos('', raw)[1].telefonos.map((t) => t.chat), ['593981234567', '13055551234'])
})

test('telefonoParaChat: celular ecuatoriano local → 593…, basura → sin botón', () => {
  assert.equal(telefonoParaChat({ numero: '0986774094' }), '593986774094')
  assert.equal(telefonoParaChat({ numero: '986774094' }), '593986774094')
  assert.equal(telefonoParaChat({ numero: '+593 98 677 4094' }), '593986774094')
  assert.equal(telefonoParaChat({ numero: '123' }), '')
})

test('contacto sin nada que mostrar: etiqueta pelada, nunca vacío', () => {
  assert.equal(contenidoTipoEspecial('contacts', { contacts: [{}] }), '👤 Compartió un contacto')
  assert.equal(contenidoTipoEspecial('contacts', null), '👤 Compartió un contacto')
  assert.equal(parseContactos('👤 Compartió un contacto', null), null)
})
