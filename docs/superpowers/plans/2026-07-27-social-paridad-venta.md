# SOCIAL con las herramientas de venta — plan de implementación

> **Para quien ejecute esto:** usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para ir marcando.

**Objetivo:** que en Facebook e Instagram se pueda vender igual que en WhatsApp —
respuestas rápidas con fotos, mandar imágenes, catálogo y link de pago— sin duplicar
código, y separando los comentarios (públicos) de los mensajes (privados).

**Arquitectura:** `RightPanel.jsx` ya es el panel único y su interfaz no sabe nada de
WhatsApp. SOCIAL lo monta y le pasa sus propias funciones de envío. Lo único que
difiere por canal es cómo sale una foto: WhatsApp sube la imagen a Meta y guarda el
`media_id`; Facebook e Instagram aceptan la URL directa. La lógica pura (agrupar
conversaciones, armar el cuerpo del mensaje) sale a archivos propios para poder
probarla sin tocar la red.

**Stack:** Next.js 14 (App Router), React 18, Supabase, Graph API v19.0.
Pruebas con `node:test` + `assert` (igual que `tests/push.test.js`).

**Spec:** `docs/superpowers/specs/2026-07-27-social-paridad-venta-design.md`

## Restricciones globales

- **No se toca `App.jsx` ni `handleQuickReply` ni la caché de `media_id`.** WhatsApp
  tiene que quedar exactamente igual. Cualquier cambio en `RightPanel.jsx` es
  **aditivo**: si una prop nueva no viene, se comporta como hoy.
- **Un comentario nunca lleva foto, ni producto, ni link de pago, ni datos de
  entrega.** Es público.
- **Dentro de la ventana de 24 h no hay turnos:** se mandan los mensajes que haga
  falta, seguidos, sin esperar respuesta del cliente.
- Meta **no admite texto y adjunto en el mismo mensaje**: texto + 3 fotos son 4
  envíos.
- La pestaña **Ventas** no se monta en SOCIAL (escribiría contactos basura en la
  tabla de WhatsApp). Entra con el bloque de CRM.
- **Nunca se pinta una hora suelta.** Un mensaje viejo tiene que verse viejo: si no,
  el vendedor cree que llegó hoy, intenta contestar y le rebota. Se usa `fmtTime`
  de `lib/utils.js`, el mismo que usa WhatsApp. Zona horaria explícita:
  `America/Guayaquil`.
- Comentarios en español, como el resto del repo.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/social-agrupar.js` *(nuevo)* | Filas de la base → conversaciones. Puro, sin Supabase. |
| `lib/social-envio.js` *(nuevo)* | Reglas de envío: qué admite cada tipo de hilo y cómo se arma el cuerpo para Meta. Puro. |
| `lib/social-ventana.js` *(nuevo)* | Estado de la ventana de 24 h. Puro. |
| `lib/social-supabase.js` | Deja de agrupar a mano y usa `social-agrupar`. |
| `app/api/social/saliente/route.js` | Acepta imagen, rechaza foto en comentario, conecta LINKPAGO. |
| `components/SocialInbox.jsx` | Hilos separados, y monta `RightPanel`. |
| `components/RightPanel.jsx` | Una prop nueva para elegir qué pestañas se muestran. |
| `tests/social.test.js` *(nuevo)* | Pruebas de las dos librerías puras. |
| `package.json` | `npm test` corre toda la carpeta `tests/`. |

---

### Tarea 1: Separar comentarios de mensajes en la agrupación

Hoy las conversaciones se agrupan por `canal + sender_id`, así que un comentario y
un DM de la misma persona caen en el mismo hilo. Verificado en producción: el
comentario "😍" de *cualvos* (23:20) aparece dentro de sus DM de las 23:01.

**Archivos:**
- Crear: `lib/social-agrupar.js`
- Crear: `tests/social.test.js`
- Modificar: `lib/social-supabase.js` (líneas 8-24 y 32-87)
- Modificar: `package.json` (script `test`)

**Interfaces:**
- Produce: `claveConversacion(fila) -> string`,
  `filaAMensaje(fila) -> objeto`,
  `agruparConversaciones(filas) -> array de conversaciones`
- Consume: nada.

- [ ] **Paso 1: Escribir la prueba que falla**

Crear `tests/social.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { claveConversacion, agruparConversaciones } from '../lib/social-agrupar.js'

const base = { canal: 'IG', sender_id: '660529760420669', direccion: 'ENTRANTE', estado: 'PENDIENTE' }

test('la clave separa un comentario de un mensaje del mismo cliente', () => {
  const comentario = claveConversacion({ ...base, tipo: 'COMENTARIO' })
  const mensaje    = claveConversacion({ ...base, tipo: 'DM' })
  assert.notEqual(comentario, mensaje)
})

test('sin tipo se asume DM', () => {
  assert.equal(claveConversacion({ ...base, tipo: '' }), claveConversacion({ ...base, tipo: 'DM' }))
})

test('el comentario y el DM del mismo cliente son dos conversaciones', () => {
  const convs = agruparConversaciones([
    { ...base, id: 31, tipo: 'DM',         texto: 'Hooa amog9s', fecha: '2026-07-27T23:01:20Z' },
    { ...base, id: 36, tipo: 'COMENTARIO', texto: '😍',          fecha: '2026-07-27T23:20:00Z' },
  ])
  assert.equal(convs.length, 2)
  assert.deepEqual(convs.map(c => c.tipo).sort(), ['COMENTARIO', 'DM'])
})

test('el hilo de comentarios no arrastra los mensajes del DM', () => {
  const convs = agruparConversaciones([
    { ...base, id: 31, tipo: 'DM',         texto: 'Hooa amog9s', fecha: '2026-07-27T23:01:20Z' },
    { ...base, id: 36, tipo: 'COMENTARIO', texto: '😍',          fecha: '2026-07-27T23:20:00Z' },
  ])
  const comentarios = convs.find(c => c.tipo === 'COMENTARIO')
  assert.equal(comentarios.messages.length, 1)
  assert.equal(comentarios.messages[0].text, '😍')
})

test('una foto sin texto NO se descarta', () => {
  const convs = agruparConversaciones([
    { ...base, id: 28, tipo: 'DM', texto: '', media_url: 'https://x/f.jpg', fecha: '2026-07-27T23:00:22Z' },
  ])
  assert.equal(convs[0].messages.length, 1)
  assert.equal(convs[0].messages[0].image, 'https://x/f.jpg')
})

test('las conversaciones vienen de la mas reciente a la mas vieja', () => {
  const convs = agruparConversaciones([
    { ...base, id: 1, sender_id: 'viejo', tipo: 'DM', texto: 'a', fecha: '2026-07-01T10:00:00Z' },
    { ...base, id: 2, sender_id: 'nuevo', tipo: 'DM', texto: 'b', fecha: '2026-07-27T10:00:00Z' },
  ])
  assert.equal(convs[0].sender_id, 'nuevo')
})

test('una fila sin sender_id se ignora', () => {
  assert.equal(agruparConversaciones([{ ...base, sender_id: '', tipo: 'DM', texto: 'x' }]).length, 0)
})
```

- [ ] **Paso 2: Correr la prueba y ver que falla**

```bash
node --test tests/social.test.js
```
Esperado: FALLA — no existe `../lib/social-agrupar.js`.

- [ ] **Paso 3: Escribir `lib/social-agrupar.js`**

```js
// lib/social-agrupar.js — filas de inbox.social_mensajes → conversaciones.
// Puro a propósito: no toca Supabase ni la red, así se puede probar con objetos.
//
// La clave incluye el TIPO porque un comentario es público y un DM es privado: son
// conversaciones distintas aunque las escriba la misma persona. Si se agrupan
// juntas, el vendedor no sabe si está escribiendo a la vista de todos.

/** Clave de la conversación a la que pertenece una fila. */
export function claveConversacion(fila) {
  const tipo = String(fila.tipo || 'DM').toUpperCase() === 'COMENTARIO' ? 'COMENTARIO' : 'DM'
  return `${fila.canal || 'FB'}__${tipo}__${fila.sender_id}`
}

/** Fila de la base → mensaje plano para pintar en el hilo. */
export function filaAMensaje(r) {
  return {
    id:        r.msg_id || String(r.id),
    canal:     r.canal || 'FB',
    tipo:      String(r.tipo || 'DM').toUpperCase() === 'COMENTARIO' ? 'COMENTARIO' : 'DM',
    sender_id: String(r.sender_id || ''),
    nombre:    r.nombre || '',
    direccion: r.direccion || 'ENTRANTE',
    texto:     r.texto || '',
    media_url: r.media_url || '',
    fecha:     r.fecha || '',
    estado:    r.estado || 'PENDIENTE',
    mandi_activo: r.mandi_activo !== false,
    ad_id:     r.ad_id || '',
    pauta:     r.pauta || '',
    ref:       r.ref || '',
  }
}

/**
 * Agrupa las filas (en orden cronológico) en conversaciones, de la más reciente a
 * la más vieja.
 */
export function agruparConversaciones(filas) {
  const map = {}
  for (const cruda of filas || []) {
    const r = filaAMensaje(cruda)
    if (!r.sender_id) continue
    const key = claveConversacion(r)
    if (!map[key]) {
      map[key] = {
        sender_id: r.sender_id,
        nombre: r.nombre || r.sender_id,
        canal: r.canal,
        tipo: r.tipo,
        status: r.estado || 'PENDIENTE',
        mandi_active: r.mandi_activo,
        messages: [],
        last_time: r.fecha || '',
        unread: 0,
        pautaAdId: '', pautaTitle: '', pautaRef: '',
      }
    }
    const conv = map[key]
    // Primera pauta no vacía de la conversación.
    if (!conv.pautaAdId  && r.ad_id) conv.pautaAdId  = r.ad_id
    if (!conv.pautaTitle && r.pauta) conv.pautaTitle = r.pauta
    if (!conv.pautaRef   && r.ref)   conv.pautaRef   = r.ref
    // Ojo: una foto sin texto NO se descarta (si no, el mensaje desaparece).
    if (String(r.texto || '').trim() || r.media_url) {
      conv.messages.push({
        id: r.id,
        from: String(r.direccion).toUpperCase() === 'SALIENTE' ? 'mandi' : 'user',
        text: r.texto,
        image: r.media_url || '',
        tipo: r.tipo,
        time: r.fecha || '',
      })
    }
    conv.last_time = r.fecha || conv.last_time
    if (r.estado) conv.status = r.estado
    if (r.nombre && r.nombre.trim()) conv.nombre = r.nombre.trim()
  }
  return Object.values(map).sort((a, b) => new Date(b.last_time) - new Date(a.last_time))
}
```

- [ ] **Paso 4: Correr la prueba y ver que pasa**

```bash
node --test tests/social.test.js
```
Esperado: los 7 tests en verde.

- [ ] **Paso 5: Usar la librería desde `lib/social-supabase.js`**

Borrar de `lib/social-supabase.js` la función local `toRow` (líneas 8-24) y el
cuerpo del bucle de agrupación, y dejar `getSocialConversacionesSupabase` así:

```js
import { agruparConversaciones } from './social-agrupar.js'

export async function getSocialConversacionesSupabase(limite = 4000) {
  const sb = getSupabase()
  const { data, error } = await sb
    .from(TABLA)
    .select('id, canal, tipo, sender_id, nombre, direccion, texto, media_url, msg_id, fecha, estado, mandi_activo, ad_id, pauta, ref')
    .eq('cuenta', CUENTA)
    .order('fecha', { ascending: true })
    .limit(limite)
  if (error) throw error
  return agruparConversaciones(data || [])
}
```

- [ ] **Paso 6: Que `npm test` corra toda la carpeta**

En `package.json`, cambiar el script:

```json
"test": "node --test tests/"
```

- [ ] **Paso 7: Compilar y correr todo**

```bash
npm test && npm run build
```
Esperado: tests en verde y `✓ Compiled successfully`.

- [ ] **Paso 8: Commit**

```bash
git add lib/social-agrupar.js lib/social-supabase.js tests/social.test.js package.json
git commit -m "fix(social): un comentario y un DM son conversaciones distintas

Se agrupaban por canal+sender_id, asi que el comentario de un cliente caia dentro
del hilo de sus mensajes y el vendedor no sabia si escribia en publico. La clave
ahora incluye el tipo. La agrupacion sale a lib/social-agrupar.js, sin Supabase,
para poder probarla."
```

---

### Tarea 2: Reglas de envío (qué admite cada hilo y cómo se arma el mensaje)

**Archivos:**
- Crear: `lib/social-envio.js`
- Modificar: `tests/social.test.js`

**Interfaces:**
- Produce: `admiteAdjuntos(tipo) -> boolean`,
  `cuerpoMensajeMeta({ texto, imagen }) -> objeto`
- Consume: nada.

- [ ] **Paso 1: Escribir la prueba que falla**

Agregar al final de `tests/social.test.js`:

```js
import { admiteAdjuntos, cuerpoMensajeMeta } from '../lib/social-envio.js'

test('un DM admite adjuntos', () => {
  assert.equal(admiteAdjuntos('DM'), true)
})

test('un comentario NO admite adjuntos', () => {
  assert.equal(admiteAdjuntos('COMENTARIO'), false)
})

test('sin tipo se asume DM', () => {
  assert.equal(admiteAdjuntos(''), true)
  assert.equal(admiteAdjuntos(undefined), true)
})

test('el cuerpo de un mensaje de texto', () => {
  assert.deepEqual(cuerpoMensajeMeta({ texto: 'hola' }), { text: 'hola' })
})

test('el cuerpo de una imagen es un adjunto reutilizable', () => {
  assert.deepEqual(cuerpoMensajeMeta({ imagen: 'https://x/f.jpg' }), {
    attachment: { type: 'image', payload: { url: 'https://x/f.jpg', is_reusable: true } },
  })
})

test('Meta no admite texto y adjunto juntos', () => {
  assert.throws(() => cuerpoMensajeMeta({ texto: 'hola', imagen: 'https://x/f.jpg' }), /mismo mensaje/)
})

test('un mensaje vacio es un error', () => {
  assert.throws(() => cuerpoMensajeMeta({}), /vacio/)
})
```

- [ ] **Paso 2: Correr la prueba y ver que falla**

```bash
node --test tests/social.test.js
```
Esperado: FALLA — no existe `../lib/social-envio.js`.

- [ ] **Paso 3: Escribir `lib/social-envio.js`**

```js
// lib/social-envio.js — reglas de envío del Social Inbox. Puro, sin red.

/**
 * ¿Este hilo admite fotos, productos o links de pago?
 * Solo los DM. Un comentario es PÚBLICO: Instagram no admite fotos en un
 * comentario, y un link de pago o unos datos de entrega no van a la vista de todos.
 */
export function admiteAdjuntos(tipo) {
  return String(tipo || 'DM').toUpperCase() !== 'COMENTARIO'
}

/**
 * Cuerpo `message` para el Send API de Meta.
 * Meta NO admite texto y adjunto en el mismo mensaje: una respuesta rápida con
 * texto y 3 fotos son 4 envíos.
 */
export function cuerpoMensajeMeta({ texto, imagen } = {}) {
  const conImagen = Boolean(imagen)
  const conTexto  = Boolean(String(texto || '').trim())
  if (conImagen && conTexto) {
    throw new Error('Meta no admite texto y adjunto en el mismo mensaje')
  }
  if (conImagen) {
    return { attachment: { type: 'image', payload: { url: String(imagen), is_reusable: true } } }
  }
  if (conTexto) return { text: String(texto) }
  throw new Error('el mensaje viene vacio')
}
```

- [ ] **Paso 4: Correr la prueba y ver que pasa**

```bash
node --test tests/social.test.js
```
Esperado: todos en verde.

- [ ] **Paso 5: Commit**

```bash
git add lib/social-envio.js tests/social.test.js
git commit -m "feat(social): reglas de envio -adjuntos por tipo de hilo y cuerpo para Meta-

Un comentario es publico: no admite fotos ni link de pago. Y Meta no acepta texto
y adjunto en el mismo mensaje, asi que texto + 3 fotos son 4 envios."
```

---

### Tarea 3: El servidor acepta fotos y LINKPAGO

**Archivos:**
- Modificar: `app/api/social/saliente/route.js`

**Interfaces:**
- Consume: `admiteAdjuntos`, `cuerpoMensajeMeta` (Tarea 2);
  `parseLinkpago(texto)`, `crearLinkPago(monto, orderId)`, `mensajeLinkPago(monto, link)`
  de `lib/dlocal.js`.
- Produce: el endpoint acepta `{ sender_id, message, canal, tipo, comment_id, modo, imagen }`.

- [ ] **Paso 1: Aceptar `imagen` y usar el cuerpo de la Tarea 2**

En `app/api/social/saliente/route.js`:

1. Agregar al import: `import { admiteAdjuntos, cuerpoMensajeMeta } from '@/lib/social-envio'`
2. Sacar `imagen` del cuerpo del request:
   `const { sender_id, message, canal, comment_id, tipo, modo, imagen } = await req.json()`
3. Cambiar la validación de entrada — ahora vale mandar solo imagen:

```js
    if (!sender_id || (!message && !imagen)) {
      return NextResponse.json({ error: 'Faltan sender_id y contenido (message o imagen)' }, { status: 400 })
    }
```

4. Rechazar la foto en un comentario, con un mensaje que se entienda en pantalla:

```js
    if (imagen && !admiteAdjuntos(tipo)) {
      return NextResponse.json(
        { error: 'Instagram no admite fotos en un comentario. Responde en privado y mándala por el chat.' },
        { status: 400 }
      )
    }
```

5. En las tres ramas que hoy mandan `{ text: texto }`, usar el cuerpo armado.
   Antes del `let r`, añadir:

```js
    const cuerpo = cuerpoMensajeMeta({ texto: imagen ? '' : texto, imagen })
```

   y reemplazar en las ramas de DM y de respuesta privada de IG
   `message: { text: texto }` por `message: cuerpo`.

- [ ] **Paso 2: Guardar la foto enviada en el hilo**

En el bloque que registra en Supabase, pasar la URL para que la burbuja la pinte:

```js
        texto: publico ? `↩️ (público) ${texto}` : texto,
        media_url: imagen || '',
```

- [ ] **Paso 3: Conectar LINKPAGO**

Después de sacar el cuerpo del request y antes de armar `cuerpo`, traducir el
comando a un link real:

```js
    // LINKPAGO35 → link de cobro de dLocal. Mismo comando que en WhatsApp.
    // Solo en DM: un link de pago no va en un comentario público.
    let texto = String(message || '')
    const monto = parseLinkpago(texto)
    if (monto && admiteAdjuntos(tipo)) {
      const link = await crearLinkPago(monto, `SOCIAL-${Date.now()}`)
      texto = mensajeLinkPago(monto, link)
    }
```

Añadir al import: `import { parseLinkpago, crearLinkPago, mensajeLinkPago } from '@/lib/dlocal'`
y borrar la línea `const texto = String(message)` que existe hoy, para no declararlo dos veces.

- [ ] **Paso 4: Compilar**

```bash
npm run build
```
Esperado: `✓ Compiled successfully`.

- [ ] **Paso 5: Probar contra producción tras desplegar**

```bash
git add app/api/social/saliente/route.js
git commit -m "feat(social): enviar fotos y generar links de pago

El Send API de FB/IG acepta la URL de la imagen -no hay que subirla a Meta como en
WhatsApp-, asi que las fotos de las respuestas rapidas y del catalogo salen tal
cual. La foto en un comentario se rechaza con un mensaje entendible, y LINKPAGO
solo funciona en DM."
git push origin main
```

Esperar el despliegue y comprobar que la foto en comentario se rechaza bien:

```bash
curl -s -X POST https://wa-inbox-v2.vercel.app/api/social/saliente \
  -H "Content-Type: application/json" \
  -d '{"sender_id":"0","canal":"IG","tipo":"COMENTARIO","comment_id":"1","imagen":"https://x/f.jpg"}'
```
Esperado: HTTP 400 con el texto "Instagram no admite fotos en un comentario…".

---

### Tarea 4: Hilos separados en la lista de SOCIAL

**Archivos:**
- Modificar: `components/SocialInbox.jsx`

**Interfaces:**
- Consume: `conv.tipo` que ya trae `/api/social/lista` (Tarea 1).

- [ ] **Paso 1: La clave del hilo incluye el tipo**

Cambiar `convKey`:

```js
  const convKey = (c) => `${c.canal}__${c.tipo || 'DM'}__${c.sender_id}`
```

- [ ] **Paso 2: Distinguir el hilo a simple vista**

Agregar junto a `ChannelBadge` un distintivo de tipo, y usarlo en `ConvRow` y en la
cabecera del chat:

```jsx
function TipoBadge({ tipo }) {
  const esComentario = tipo === 'COMENTARIO'
  return (
    <span style={{
      padding:'1px 6px', borderRadius:5, fontSize:9, fontWeight:800,
      background: esComentario ? 'rgba(245,158,11,.15)' : 'rgba(37,211,102,.12)',
      color: esComentario ? '#f59e0b' : '#25d366',
    }}>
      {esComentario ? '💬 PÚBLICO' : '✉️ PRIVADO'}
    </span>
  )
}
```

En `ConvRow`, dentro del `div` que ya tiene `<ChannelBadge>` y `<StatusBadge>`,
añadir `<TipoBadge tipo={conv.tipo} />`.

- [ ] **Paso 3: Filtros por tipo**

Cambiar la lista de filtros y su lógica:

```js
  const FILTERS = ['Todas', 'FB', 'IG', '💬 Comentarios', '✉️ Mensajes', 'PENDIENTE']
```

```js
  const filtered = convs.filter(c => {
    if (filter === 'FB') return c.canal === 'FB'
    if (filter === 'IG') return c.canal === 'IG'
    if (filter === '💬 Comentarios') return c.tipo === 'COMENTARIO'
    if (filter === '✉️ Mensajes') return c.tipo !== 'COMENTARIO'
    if (filter === 'PENDIENTE') return c.status === 'PENDIENTE'
    return true
  })
```

- [ ] **Paso 4: Aviso permanente en el hilo público**

En la cabecera del chat, debajo del nombre, cuando `selectedConv.tipo === 'COMENTARIO'`:

```jsx
{selectedConv.tipo === 'COMENTARIO' && (
  <div style={{ fontSize:10, color:'#f59e0b', fontWeight:700 }}>
    ⚠️ Comentario público — no pidas datos de entrega acá
  </div>
)}
```

- [ ] **Paso 5: Comprobar en el navegador**

```bash
npm run build && git add components/SocialInbox.jsx && git commit -m "feat(social): separar en la lista los comentarios de los mensajes

Mismo cliente puede tener dos hilos y deben verse distintos: uno es publico y el
otro privado. Se agrega el distintivo, los filtros y un aviso fijo en el hilo
publico para que nadie pida ahi una direccion." && git push origin main
```

Tras el despliegue, abrir SOCIAL y confirmar que **cualvos aparece dos veces** —
Comentarios y Mensajes— y que su "😍" NO está dentro del hilo de mensajes.

---

### Tarea 5: Que se vea CUÁNDO llegó y si todavía se puede contestar

Hoy la lista pinta solo hora y minuto (`SocialInbox.jsx:99` y `:146`), sin fecha.
Un mensaje del 17 de julio se ve `15:32`, idéntico a uno de hace un rato. El
vendedor cree que todo llegó hoy, intenta contestar y le rebota — que es
exactamente lo que pasó en producción.

`lib/utils.js` ya tiene `fmtTime`, que WhatsApp usa y hace lo correcto. SOCIAL no
lo usa. Y falta lo más importante: **ver de un vistazo si la ventana de 24 h sigue
abierta**.

**Archivos:**
- Crear: `lib/social-ventana.js`
- Modificar: `tests/social.test.js`
- Modificar: `components/SocialInbox.jsx` (líneas 99 y 146)

**Interfaces:**
- Produce: `estadoVentana(ultimoEntranteISO, ahoraMs) -> { abierta, horasRestantes, etiqueta }`
- Consume: `fmtTime(iso)` de `lib/utils.js`.

- [ ] **Paso 1: Escribir la prueba que falla**

Agregar a `tests/social.test.js`:

```js
import { estadoVentana } from '../lib/social-ventana.js'

const AHORA = new Date('2026-07-27T23:00:00Z').getTime()

test('recien escrito: ventana abierta con casi 24 h', () => {
  const v = estadoVentana('2026-07-27T22:30:00Z', AHORA)
  assert.equal(v.abierta, true)
  assert.equal(v.horasRestantes, 23)
})

test('a 23 h del mensaje queda 1 h', () => {
  const v = estadoVentana('2026-07-27T00:00:00Z', AHORA)
  assert.equal(v.abierta, true)
  assert.equal(v.horasRestantes, 1)
})

test('pasadas las 24 h la ventana esta cerrada', () => {
  const v = estadoVentana('2026-07-17T20:55:00Z', AHORA)
  assert.equal(v.abierta, false)
  assert.equal(v.horasRestantes, 0)
})

test('justo en el limite cuenta como cerrada', () => {
  const v = estadoVentana('2026-07-26T23:00:00Z', AHORA)
  assert.equal(v.abierta, false)
})

test('sin mensaje del cliente la ventana esta cerrada', () => {
  assert.equal(estadoVentana('', AHORA).abierta, false)
  assert.equal(estadoVentana(null, AHORA).abierta, false)
})

test('la etiqueta dice las horas que quedan, o que se cerro', () => {
  assert.equal(estadoVentana('2026-07-27T22:30:00Z', AHORA).etiqueta, '⏳ 23 h para responder')
  assert.equal(estadoVentana('2026-07-17T20:55:00Z', AHORA).etiqueta, '🔒 Cerrada')
})
```

- [ ] **Paso 2: Correr la prueba y ver que falla**

```bash
node --test tests/social.test.js
```
Esperado: FALLA — no existe `../lib/social-ventana.js`.

- [ ] **Paso 3: Escribir `lib/social-ventana.js`**

```js
// lib/social-ventana.js — la ventana de 24 h de Meta. Puro, sin red.
//
// Se cuenta desde el ÚLTIMO MENSAJE DEL CLIENTE. Mientras esté abierta se mandan
// los mensajes que haga falta, seguidos, sin esperar respuesta. Cuando se cierra,
// en Facebook e Instagram no hay plantillas para reabrirla: la conversación
// terminó.

const VENTANA_MS = 24 * 60 * 60 * 1000

/**
 * @param {string} ultimoEntranteISO fecha del último mensaje del cliente
 * @param {number} ahoraMs           Date.now(), inyectable para poder probarlo
 */
export function estadoVentana(ultimoEntranteISO, ahoraMs = Date.now()) {
  const cerrada = { abierta: false, horasRestantes: 0, etiqueta: '🔒 Cerrada' }
  if (!ultimoEntranteISO) return cerrada
  const t = new Date(ultimoEntranteISO).getTime()
  if (!Number.isFinite(t)) return cerrada
  const restanteMs = t + VENTANA_MS - ahoraMs
  if (restanteMs <= 0) return cerrada
  const horasRestantes = Math.floor(restanteMs / 3_600_000)
  return {
    abierta: true,
    horasRestantes,
    etiqueta: `⏳ ${horasRestantes} h para responder`,
  }
}
```

- [ ] **Paso 4: Correr la prueba y ver que pasa**

```bash
node --test tests/social.test.js
```
Esperado: todos en verde.

- [ ] **Paso 5: Fechas de verdad en la lista y en el hilo**

En `components/SocialInbox.jsx`, importar el helper que ya usa WhatsApp:

```js
import { fmtTime } from '@/lib/utils'
```

Reemplazar la línea 99 (la hora de `ConvRow`) por:

```jsx
          <span style={{ fontSize:9, color:'#334155', flexShrink:0 }}>{fmtTime(conv.last_time)}</span>
```

Y la línea 146 (la hora de la burbuja) por la hora con fecha completa al pasar el
mouse, para que nunca haya duda de cuándo se dijo algo:

```jsx
          <div style={{ fontSize:9, opacity:.5, marginTop:4, textAlign:'right' }}
               title={new Date(msg.time).toLocaleString('es-EC', { timeZone:'America/Guayaquil', dateStyle:'full', timeStyle:'short' })}>
            {fmtTime(msg.time)}
          </div>
```

- [ ] **Paso 6: El estado de la ventana, visible**

En `SocialInbox.jsx`, calcular el estado del hilo abierto (reemplaza el cálculo
suelto de `windowOpen`):

```js
import { estadoVentana } from '@/lib/social-ventana'

  const ultimoEntrante = selectedConv
    ? [...selectedConv.messages].reverse().find(m => m.from === 'user')
    : null
  const ventana = estadoVentana(ultimoEntrante?.time)
  const windowOpen = ventana.abierta
```

Pintarlo en la cabecera del chat, junto al nombre:

```jsx
<span style={{ fontSize:10, fontWeight:700, color: ventana.abierta ? '#25d366' : '#f87171' }}>
  {ventana.etiqueta}
</span>
```

- [ ] **Paso 7: Cuando está cerrada, decirlo en vez de dejar que rebote**

Reemplazar el input por un aviso cuando `!ventana.abierta && selectedConv.tipo !== 'COMENTARIO'`:

```jsx
<div style={{ padding:'12px 16px', background:'#1a1116', border:'1px solid #3a1f28',
              borderRadius:12, color:'#f87171', fontSize:12, lineHeight:1.5 }}>
  🔒 <b>Pasaron más de 24 h desde el último mensaje del cliente.</b><br />
  Meta ya no deja responder por aquí, y en Facebook e Instagram no hay plantillas
  para reabrir la conversación. Toca esperar a que el cliente escriba de nuevo.
</div>
```

- [ ] **Paso 8: Compilar, desplegar y comprobar**

```bash
npm test && npm run build
git add lib/social-ventana.js tests/social.test.js components/SocialInbox.jsx
git commit -m "fix(social): mostrar la fecha real y si todavia se puede contestar

La lista pintaba solo hora y minuto: un mensaje del 17 de julio se veia igual que
uno de hoy, el vendedor intentaba contestar y le rebotaba sin entender por que.
Ahora usa fmtTime -el mismo helper que WhatsApp- y la fecha completa al pasar el
mouse.

Ademas se ve el estado de la ventana de 24 h: las horas que quedan, o el aviso de
que se cerro y por que, en vez de dejar que el envio falle contra Meta."
git push origin main
```

Tras el despliegue: abrir SOCIAL y confirmar que los comentarios viejos de julio
muestran su fecha (no una hora suelta) y salen como **🔒 Cerrada**.

Nota: las filas viejas que escribió Make tienen la hora corrida 5 horas (guardaba
hora de Ecuador en una columna UTC). No se corrigen hacia atrás; las nuevas entran
con la hora real de Meta.

---

### Tarea 6: SOCIAL monta el panel único

**Archivos:**
- Modificar: `components/RightPanel.jsx` (líneas 214-216 y 221)
- Modificar: `components/SocialInbox.jsx`

**Interfaces:**
- Consume: `RightPanel` con las props que ya usa `App.jsx`.
- Produce: `RightPanel` acepta la prop nueva `pestanas` (array de ids).

- [ ] **Paso 1: `RightPanel` acepta qué pestañas mostrar**

En `components/RightPanel.jsx`, cambiar la firma (línea 221) para aceptar la prop
nueva con el valor de hoy por defecto — así `App.jsx` no cambia:

```js
export default function RightPanel({ activeConv, onQuickReply, onSendText, onSendImage, onSendProducto, contactInfo, onUpdateContact, windowOpen, pestanas = ['respuestas', 'ventas', 'tienda'] }) {
```

Donde se pintan las pestañas (el `.map` sobre `TABS`, cerca de la línea 496),
filtrar primero:

```jsx
        {TABS.filter(t => pestanas.includes(t.id)).map(t => {
```

Y que la pestaña inicial sea la primera permitida, en vez de siempre `respuestas`:

```js
  const [tab, setTab] = useState(pestanas[0] || 'respuestas')
```

- [ ] **Paso 2: Verificar que WhatsApp no cambió**

```bash
npm run build
```
Esperado: compila. `App.jsx` no pasa `pestanas`, así que sigue viendo las tres.

- [ ] **Paso 3: El adaptador de conversación en SocialInbox**

`RightPanel` espera una conversación con forma de WhatsApp (`telefono`, `nombre`,
`msgs` con `direccion` y `timestamp` — los usa para el contador de 24 h). Añadir en
`SocialInbox.jsx`, después de `selectedConv`:

```js
  // RightPanel habla el idioma de WhatsApp. Se traduce acá para no tocarlo.
  // El prefijo del canal evita que un sender_id de IG choque con uno de FB.
  const convParaPanel = selectedConv ? {
    telefono: `${selectedConv.canal}:${selectedConv.sender_id}`,
    nombre: selectedConv.nombre,
    msgs: selectedConv.messages.map(m => ({
      direccion: m.from === 'user' ? 'ENTRANTE' : 'SALIENTE',
      timestamp: m.time,
      mensaje: m.text,
    })),
  } : null

  // Ventana de 24 h: se cuenta desde el último mensaje DEL CLIENTE.
  const ultimoEntrante = selectedConv
    ? [...selectedConv.messages].reverse().find(m => m.from === 'user')
    : null
  const windowOpen = Boolean(ultimoEntrante?.time) &&
    (Date.now() - new Date(ultimoEntrante.time).getTime()) < 24 * 3600 * 1000
```

- [ ] **Paso 4: Las funciones de envío de SOCIAL**

Añadir en `SocialInbox.jsx`:

```js
  // Un envío suelto (texto O imagen). Dentro de la ventana de 24 h se pueden
  // encadenar sin esperar respuesta del cliente.
  const enviarSocial = useCallback(async ({ texto, imagen }) => {
    if (!selectedConv) return
    const res = await fetch('/api/social/saliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender_id: selectedConv.sender_id,
        canal: selectedConv.canal,
        tipo: selectedConv.tipo,
        comment_id: selectedConv.tipo === 'COMENTARIO' ? (ultimoDelCliente?.id || '') : '',
        modo: selectedConv.tipo === 'COMENTARIO' ? modoRespuesta : 'privado',
        message: texto || '',
        imagen: imagen || '',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }, [selectedConv, ultimoDelCliente, modoRespuesta])

  // Respuesta rápida: el texto y luego cada foto, en orden. Son envíos separados
  // porque Meta no admite texto y adjunto en el mismo mensaje.
  const onQuickReply = useCallback(async (reply, onProgress) => {
    const imgs = Array.from({ length: 10 }, (_, i) =>
      i === 0 ? reply.imageUrl : reply[`imageUrl${i + 1}`]
    ).filter(Boolean)
    const soloTexto = selectedConv?.tipo === 'COMENTARIO'
    const aMandar = soloTexto ? [] : imgs
    const total = (reply.text ? 1 : 0) + aMandar.length
    let hechas = 0
    try {
      if (reply.text) { await enviarSocial({ texto: reply.text }); onProgress?.(++hechas, total) }
      for (const url of aMandar) { await enviarSocial({ imagen: url }); onProgress?.(++hechas, total) }
      if (soloTexto && imgs.length) {
        alert('Es un comentario público: se mandó solo el texto. Responde en privado para poder mandar las fotos.')
      }
    } catch (e) {
      alert('❌ No se pudo enviar: ' + e.message)
    }
    load()
  }, [selectedConv, enviarSocial, load])

  const onSendImage = useCallback(async (imageUrl) => {
    try { await enviarSocial({ imagen: imageUrl }) }
    catch (e) { alert('❌ No se pudo enviar la foto: ' + e.message) }
    load()
  }, [enviarSocial, load])

  // Producto del catálogo: primero la foto, después el texto con precio.
  const onSendProducto = useCallback(async (p) => {
    try {
      if (p.imagen) await enviarSocial({ imagen: p.imagen })
      const detalle = [p.titulo, p.precio ? `$${p.precio}` : ''].filter(Boolean).join(' — ')
      if (detalle) await enviarSocial({ texto: detalle })
    } catch (e) { alert('❌ No se pudo enviar el producto: ' + e.message) }
    load()
  }, [enviarSocial, load])

  const onSendText = useCallback(async (texto, copiarAlInput) => {
    if (copiarAlInput) { setInput(texto); return }
    try { await enviarSocial({ texto }) }
    catch (e) { alert('❌ No se pudo enviar: ' + e.message) }
    load()
  }, [enviarSocial, load])
```

- [ ] **Paso 5: Montar el panel y quitar la barra vieja**

Borrar de `SocialInbox.jsx` el estado `quickReplies`, su `useEffect` de carga
(`fetch('/api/respuestas')`), el botón `⚡` y el bloque `{showQR && …}` con sus
respuestas: eso lo hace ahora el panel.

Montar `RightPanel` a la derecha del chat, solo cuando hay conversación abierta y
solo en escritorio (en móvil taparía la pantalla):

```jsx
{!isMobile && selectedConv && (
  <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid #162030', display: 'flex' }}>
    <RightPanel
      activeConv={convParaPanel}
      contactInfo={null}
      windowOpen={windowOpen}
      pestanas={selectedConv.tipo === 'COMENTARIO' ? ['respuestas'] : ['respuestas', 'tienda']}
      onQuickReply={onQuickReply}
      onSendText={onSendText}
      onSendImage={onSendImage}
      onSendProducto={onSendProducto}
      onUpdateContact={() => {}}
    />
  </div>
)}
```

Añadir el import: `import RightPanel from '@/components/RightPanel'`

Nota: **Ventas no se monta nunca** (escribiría contactos basura), y en un hilo de
comentario tampoco Tienda: es público.

- [ ] **Paso 6: Compilar y desplegar**

```bash
npm test && npm run build
git add components/RightPanel.jsx components/SocialInbox.jsx
git commit -m "feat(social): montar el panel unico en Facebook e Instagram

RightPanel ya era el panel de las tres pestanas y su interfaz no sabe nada de
WhatsApp: SOCIAL solo no lo estaba montando. Ahora lo monta y le pasa sus propias
funciones de envio, asi que las respuestas rapidas con fotos y la Tienda funcionan
en los tres canales y lo que se agregue al panel sale en todos.

En un hilo de comentario solo se muestra Respuestas -es publico-, y Ventas no se
monta en social porque guarda notas usando el identificador como si fuera un
telefono y ensuciaria la tabla de contactos."
git push origin main
```

---

### Tarea 7: Mandar una foto desde el computador

`RightPanel` sube fotos solo al **editar** una respuesta rápida. Mandar una foto
suelta en el chat vive en `App.jsx` y no se toca, así que SOCIAL necesita su propio
botón. El endpoint ya existe y devuelve una URL pública — que es justo lo que come
el Send API de FB/IG.

**Archivos:**
- Modificar: `components/SocialInbox.jsx`

**Interfaces:**
- Consume: `POST /api/upload-foto` con `FormData{ file }` → `{ url }` (o `{ error }`);
  `enviarSocial({ imagen })` de la Tarea 6.

- [ ] **Paso 1: Subir y mandar**

Añadir en `SocialInbox.jsx`:

```js
  const fileRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)

  // Sube al bucket propio (inbox-media) y manda la URL. Meta la busca sola: en
  // FB/IG no hace falta subir la imagen a Meta como en WhatsApp.
  const onElegirFoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir la misma foto
    if (!file) return
    setSubiendo(true)
    try {
      const fd = new FormData()
      fd.append('file', file, file.name || 'imagen.jpg')
      const res = await fetch('/api/upload-foto', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!data.url) throw new Error(data.error || 'No se pudo subir la foto')
      await enviarSocial({ imagen: data.url })
      load()
    } catch (err) {
      alert('❌ ' + err.message)
    } finally {
      setSubiendo(false)
    }
  }
```

- [ ] **Paso 2: El botón, solo en los hilos privados**

En la barra del input, junto al botón de enviar (y **solo** si
`selectedConv.tipo !== 'COMENTARIO'`, porque un comentario no admite fotos):

```jsx
{selectedConv.tipo !== 'COMENTARIO' && (
  <>
    <input ref={fileRef} type="file" accept="image/*" onChange={onElegirFoto} style={{ display:'none' }} />
    <button onClick={() => fileRef.current?.click()} disabled={subiendo} title="Mandar una foto"
      style={{ width:42, height:42, flexShrink:0, borderRadius:11, background:'#111c2a',
               border:'1px solid #1e2d3d', color:'#64748b', fontSize:17, cursor:'pointer',
               display:'flex', alignItems:'center', justifyContent:'center' }}>
      {subiendo ? '⏳' : '📎'}
    </button>
  </>
)}
```

- [ ] **Paso 3: Compilar y desplegar**

```bash
npm run build
git add components/SocialInbox.jsx
git commit -m "feat(social): mandar una foto desde el computador

Sube al bucket propio y manda la URL: en FB/IG el Send API la busca solo, sin la
subida a Meta que exige WhatsApp. El boton no aparece en un hilo de comentario,
que no admite fotos."
git push origin main
```

- [ ] **Paso 4: Probarlo** — elegir una foto en un DM de Facebook y confirmar que
      llega, y que en el hilo de comentarios el botón no está.

---

### Tarea 8: Verificación en producción

Sin esto no está terminado. Cada punto se comprueba en el inbox real.

- [ ] **Paso 1: WhatsApp intacto** — en MANDI, disparar una respuesta rápida con
      fotos y confirmar que sale igual que siempre. Si esto falla, se revierte todo.

- [ ] **Paso 2: Hilos separados** — *cualvos* aparece dos veces (Comentarios y
      Mensajes) y su "😍" no está en el hilo de mensajes.

- [ ] **Paso 3: FB · DM** — respuesta rápida con texto y fotos: llegan todas, en
      orden, sin esperar respuesta del cliente.

- [ ] **Paso 4: IG · DM** — lo mismo.

- [ ] **Paso 5: Tienda** — mandar un producto del catálogo por FB y por IG; llega
      la foto y el texto con precio.

- [ ] **Paso 6: LINKPAGO** — escribir `LINKPAGO45` en un DM: sale el link de dLocal.

- [ ] **Paso 7: El comentario se defiende** — en el hilo de *cualvos* Comentarios no
      hay pestaña Tienda, y una respuesta rápida con fotos manda solo el texto y
      avisa.

- [ ] **Paso 8: En la base** — cada envío queda en `inbox.social_mensajes` con su
      `media_url`, y la foto se ve en el hilo al refrescar:

```sql
select id, canal, tipo, direccion, left(texto,40) texto, media_url, fecha
  from inbox.social_mensajes
 where fecha > now() - interval '1 hour'
 order by fecha desc;
```

- [ ] **Paso 9: La incógnita del comentario** — responder en privado al comentario
      "😍" (`comment_id 18022877492885289`, vigente hasta el 3-ago) y comprobar si el
      hilo de Mensajes acepta un envío enseguida o hay que esperar a que conteste.
      Anotar el resultado en el spec.
