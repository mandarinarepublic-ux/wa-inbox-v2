import test from 'node:test'
import assert from 'node:assert'
import { partirEnlaces } from '../lib/enlaces.js'

const soloTexto = (t) => partirEnlaces(t).map(p => p.valor).join('')

test('un mensaje sin enlaces sale entero, en una sola parte', () => {
  const p = partirEnlaces('hola, quiero una talla M')
  assert.equal(p.length, 1)
  assert.equal(p[0].tipo, 'texto')
  assert.equal(p[0].valor, 'hola, quiero una talla M')
})

test('parte el texto y saca el enlace', () => {
  const p = partirEnlaces('mira esto https://mandarinaec.com/products/hoodie-x-men-ciclope y dime')
  assert.deepEqual(p.map(x => x.tipo), ['texto', 'enlace', 'texto'])
  assert.equal(p[1].valor, 'https://mandarinaec.com/products/hoodie-x-men-ciclope')
  assert.equal(p[1].href,  'https://mandarinaec.com/products/hoodie-x-men-ciclope')
})

test('reconoce varios enlaces en el mismo mensaje', () => {
  const p = partirEnlaces('uno https://a.com dos https://b.com')
  assert.equal(p.filter(x => x.tipo === 'enlace').length, 2)
})

// El saludo de la tienda termina la frase con punto pegado al enlace.
test('no se traga la puntuacion final', () => {
  const p = partirEnlaces('el mapa: https://maps.app.goo.gl/qRJjcgEuA4aRKgdX9.')
  assert.equal(p[1].valor, 'https://maps.app.goo.gl/qRJjcgEuA4aRKgdX9')
  assert.equal(p[2].valor, '.')
})

test('no se traga un parentesis de cierre', () => {
  const p = partirEnlaces('(ver https://a.com/x) listo')
  assert.equal(p[1].valor, 'https://a.com/x')
})

test('enlaza tambien un www sin protocolo, con https', () => {
  const p = partirEnlaces('entra a www.mandarinaec.com ya')
  assert.equal(p[1].tipo, 'enlace')
  assert.equal(p[1].valor, 'www.mandarinaec.com')
  assert.equal(p[1].href,  'https://www.mandarinaec.com')
})

// ── LA prueba de seguridad ───────────────────────────────────────
// El texto lo escribe el CLIENTE. Si `javascript:` o `data:` llegaran a un href,
// un cliente podría ejecutar código en la sesión de quien atiende — que tiene la
// cookie del CRM. Solo http y https, nunca una lista negra.
test('NUNCA enlaza un esquema que no sea http o https', () => {
  for (const veneno of ['javascript:alert(1)', 'data:text/html,<script>x</script>',
                        'vbscript:msgbox', 'file:///etc/passwd', 'JaVaScRiPt:alert(1)']) {
    const p = partirEnlaces(`mira ${veneno} ahora`)
    assert.equal(p.filter(x => x.tipo === 'enlace').length, 0, `NO puede enlazar: ${veneno}`)
  }
})

// ☠️ Ninguna parte del mensaje del cliente puede perderse por el camino: si el
// partidor se come un pedazo, desaparece lo que escribió una persona.
test('la suma de las partes es SIEMPRE el mensaje original', () => {
  for (const t of ['hola', '', 'https://a.com', 'ver https://a.com/x) y (https://b.com',
                   'a https://a.com b www.c.com d', 'javascript:alert(1)',
                   '📍 Estamos en Quito:\nmapa https://maps.app.goo.gl/x\n\ngracias']) {
    assert.equal(soloTexto(t), t, `se perdió texto en: ${JSON.stringify(t)}`)
  }
})
