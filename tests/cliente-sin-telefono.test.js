import test from 'node:test'
import assert from 'node:assert'
import { esBsuid, identificadorEntrante, perfilesDeContactos, etiquetaTelefono, destinoMeta } from '../lib/cliente-sin-telefono.js'
import { canonTel } from '../lib/supabase.js'

// Caso REAL del 24-sep-2026 (MANDI): sin `from`, solo `from_user_id`.
const MSG_REAL = { id: 'wamid.X', type: 'text', timestamp: '1790275523', from_user_id: 'CO.1712386937160316' }
const CONTACTS_REAL = [{ profile: { name: 'Tathan T Arias', username: 'tathan_arias29' }, user_id: 'CO.1712386937160316' }]

test('un entrante sin teléfono se identifica por su BSUID (antes quedaba vacío)', () => {
  assert.equal(identificadorEntrante(MSG_REAL), 'CO.1712386937160316')
  assert.equal(identificadorEntrante({ from: '593987498489', from_user_id: 'EC.1' }), '593987498489')
})

test('el perfil se toma aunque el contacto no traiga wa_id', () => {
  assert.deepEqual(perfilesDeContactos(CONTACTS_REAL)['CO.1712386937160316'], { nombre: 'Tathan T Arias', username: 'tathan_arias29' })
})

test('canonTel NO convierte un BSUID en dígitos (sería un teléfono inventado)', () => {
  assert.equal(canonTel('CO.1712386937160316'), 'CO.1712386937160316')
  assert.equal(canonTel('0987498489'), '593987498489')   // el camino de siempre intacto
})

test('se muestra el @usuario donde iba el número', () => {
  assert.equal(etiquetaTelefono('CO.1712386937160316', 'tathan_arias29'), '@tathan_arias29')
  assert.equal(etiquetaTelefono('CO.1712386937160316'), 'Usuario de WhatsApp (sin número)')
  assert.equal(etiquetaTelefono('593987498489', 'x'), '+593987498489')
})

test('el envío a un BSUID usa recipient y NUNCA to (si no, Meta usa los dígitos)', () => {
  assert.deepEqual(destinoMeta('CO.1712386937160316'), { recipient: 'CO.1712386937160316' })
  assert.deepEqual(destinoMeta('+593 98 749 8489'), { to: '593987498489' })
})

test('no se confunde con un teléfono', () => {
  assert.equal(esBsuid('593987498489'), false)
  assert.equal(esBsuid(''), false)
  assert.equal(esBsuid('EC.2025341914840016'), true)
})
