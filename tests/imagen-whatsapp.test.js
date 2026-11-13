import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imagenParaWhatsapp } from '../lib/imagen-whatsapp.js'

test('una foto de Shopify sale redimensionada a 1600 px (WhatsApp corta en 5 MB)', () => {
  // La foto REAL que falló el 13-nov-2026: 5,3 MB tal cual, 2,5 MB con width=1600.
  const url = 'https://cdn.shopify.com/s/files/1/0689/5832/2781/files/4FANTASTICOS-03.png?v=1749258504'
  const out = new URL(imagenParaWhatsapp(url))
  assert.equal(out.searchParams.get('width'), '1600')
  assert.equal(out.searchParams.get('v'), '1749258504', 'no pierde la versión')
})

test('si ya viene más chica, no se agranda', () => {
  const url = 'https://cdn.shopify.com/x.png?width=800'
  assert.equal(new URL(imagenParaWhatsapp(url)).searchParams.get('width'), '800')
})

test('otras URLs y basura pasan sin tocarse', () => {
  assert.equal(imagenParaWhatsapp('https://piingkecjgoisnxccvaa.supabase.co/a.jpg'), 'https://piingkecjgoisnxccvaa.supabase.co/a.jpg')
  assert.equal(imagenParaWhatsapp(''), '')
  assert.equal(imagenParaWhatsapp(null), '')
  assert.equal(imagenParaWhatsapp('no es url'), 'no es url')
})
