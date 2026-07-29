# Echoes del celular — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que lo que el dueño responde desde el celular por REPUBLIC aparezca en el inbox y quede respaldado en Supabase.

**Architecture:** Meta manda esos mensajes por el campo `smb_message_echoes`, en `value.message_echoes[]` — no en `value.messages`. Se les da un carril propio: una rama nueva en el webhook que corta con `continue`, y un módulo puro `lib/echoes.js` que traduce el payload a filas. El parser de tipos se comparte moviéndolo a `lib/wa-mensaje.js`. Un echo NO dispara saludos, IA, LINKPAGO, push ni cambios de estado — y no por acordarse de excluirlos, sino porque nunca entra a `procesar()`.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres + Storage), `node:test` + `node:assert`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-echoes-celular-design.md`. Ante duda, manda el spec.
- **Producción = `main`.** Sin ramas: Preview no sirve porque Supabase solo está en Production.
- El teléfono del cliente es **`echo.to`**. Usar `echo.from` crearía una conversación con nosotros mismos — `from` somos nosotros.
- El canal sale de **`value.metadata.phone_number_id`**, nunca de `from` (que viene como número visible, no como `phone_id`).
- Un echo se guarda con `direccion: 'SALIENTE'`.
- **No se toca el estado de conversaciones existentes.** Ni bandeja, ni temperatura, ni venta, ni `modo_ia`.
- Una conversación **creada** por un echo nace `estado='ATENDIDO'` y `modo_ia='HUMANO'`.
- Comentarios y textos en **español**; mensajes de commit en español **sin tildes**.
- `npm test` antes de cada commit. Baseline: **54 pruebas en verde**.
- **Refinamiento respecto al spec §4.5:** el spec pedía dejar `archivarFoto` como alias al renombrar a `archivarMedia`. Hay **un solo llamador** en todo el repo (`app/api/webhook/route.js:293`), y esta misma tarea lo toca. Se renombra del todo y se actualiza el llamador: un alias sin usuarios es código muerto.

---

### Task 1: Mover el parser a `lib/wa-mensaje.js`

Mueve `extraer()` y `normalizarReferral()` fuera del webhook para poder reusarlas desde el carril de echoes. Es un movimiento **puro**: mismo código, sin cambios de lógica. De paso les pone las primeras pruebas — hoy no tienen ninguna.

**Files:**
- Create: `lib/wa-mensaje.js`
- Modify: `app/api/webhook/route.js` (borrar las dos funciones, añadir el import)
- Test: `tests/wa-mensaje.test.js`

**Interfaces:**
- Produces: `extraer(msg) → { tipo, contenido, mediaId, contextoId, referral }` y `normalizarReferral(r) → object|null`

- [ ] **Step 1: Crear el módulo moviendo las funciones TAL CUAL**

Crear `lib/wa-mensaje.js`. Copia `normalizarReferral` (hoy en `app/api/webhook/route.js` líneas 131-146) y `extraer` (líneas 148-171) **sin cambiar una coma de su cuerpo ni de sus comentarios**, solo anteponiendo `export` a cada una. Encabeza el archivo con:

```js
// lib/wa-mensaje.js — Traduce un objeto de mensaje de Meta a nuestros campos.
//
// Vive acá y no dentro del webhook porque hay DOS orígenes con la misma forma:
// los mensajes entrantes (value.messages) y los echoes de lo que se manda desde
// el celular (value.message_echoes). Copiar el parser en vez de compartirlo es
// lo que produjo el bug de las fotos (206e9b0): dos caminos que hay que acordarse
// de mantener iguales.
```

- [ ] **Step 2: Enchufarlo en el webhook**

En `app/api/webhook/route.js`: borrar las dos funciones y añadir junto a los demás imports de `@/lib`:

```js
import { extraer } from '@/lib/wa-mensaje'
```

`normalizarReferral` solo se usaba dentro de `extraer`, así que **no** hace falta importarla.

- [ ] **Step 3: Comprobar que no quedó ninguna referencia suelta**

Run: `grep -n "function extraer\|function normalizarReferral\|normalizarReferral(" app/api/webhook/route.js`
Expected: **sin resultados**. Si aparece algo, quedó una copia o una llamada huérfana.

- [ ] **Step 4: Escribir las pruebas**

Crear `tests/wa-mensaje.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { extraer, normalizarReferral } from '../lib/wa-mensaje.js'

test('extraer lee un texto', () => {
  const r = extraer({ type: 'text', text: { body: 'hola' } })
  assert.equal(r.tipo, 'texto')
  assert.equal(r.contenido, 'hola')
  assert.equal(r.mediaId, '')
})

test('extraer lee una imagen con caption y su media id', () => {
  const r = extraer({ type: 'image', image: { id: 'MID1', caption: 'esta talla' } })
  assert.equal(r.tipo, 'imagen')
  assert.equal(r.contenido, 'esta talla')
  assert.equal(r.mediaId, 'MID1')
})

test('extraer deja el audio sin texto pero con media id', () => {
  const r = extraer({ type: 'audio', audio: { id: 'AUD1' } })
  assert.equal(r.tipo, 'audio')
  assert.equal(r.contenido, '')
  assert.equal(r.mediaId, 'AUD1')
})

test('extraer usa el nombre del archivo como texto del documento', () => {
  const r = extraer({ type: 'document', document: { id: 'DOC1', filename: 'guia.pdf' } })
  assert.equal(r.tipo, 'documento')
  assert.equal(r.contenido, 'guia.pdf')
  assert.equal(r.mediaId, 'DOC1')
})

test('extraer arrastra el id del mensaje citado', () => {
  const r = extraer({ type: 'text', text: { body: 'si' }, context: { id: 'wamid.CITA' } })
  assert.equal(r.contextoId, 'wamid.CITA')
})

test('normalizarReferral devuelve null cuando no hay pauta', () => {
  assert.equal(normalizarReferral(null), null)
  assert.equal(normalizarReferral({}), null)
})
```

- [ ] **Step 5: Correr las pruebas**

Run: `npm test`
Expected: **60 en verde** (54 previas + 6 nuevas), 0 fallos. Las 54 previas tienen que seguir pasando: si alguna se rompe, el movimiento no fue puro.

- [ ] **Step 6: Comprobar que el webhook sigue compilando**

Run: `npm run build`
Expected: compila limpio.

- [ ] **Step 7: Commit**

```bash
git add lib/wa-mensaje.js tests/wa-mensaje.test.js app/api/webhook/route.js
git commit -m "refactor(webhook): mover el parser de mensajes a lib/wa-mensaje.js

Los echoes de lo que se manda desde el celular traen la MISMA forma que un
mensaje entrante (type + <type>:{}), asi que necesitan el mismo parser. Se mueve
en vez de copiarse: copiarlo es lo que produjo el bug de las fotos (206e9b0),
dos caminos que hay que acordarse de mantener iguales.

Movimiento puro, sin cambios de logica. De paso estrena las primeras pruebas de
extraer(), que vivia dentro del route y no tenia ninguna.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/echoes.js` — traducir el payload

**Files:**
- Create: `lib/echoes.js`
- Test: `tests/echoes.test.js`

**Interfaces:**
- Consumes: `extraer(msg)` de `lib/wa-mensaje.js` (Task 1).
- Produces: `extraerEchoes(value) → Array<{ wamid, telefono, tipo, contenido, mediaId, contextoId, phoneId, raw, fecha }>`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/echoes.test.js`. El payload es el **real**, capturado de `inbox.webhook_eventos` el 29-jul a las 10:50:

```js
import test from 'node:test'
import assert from 'node:assert'
import { extraerEchoes } from '../lib/echoes.js'

// Payload REAL de Meta (inbox.webhook_eventos, 29-jul 10:50), recortado.
const REAL = {
  metadata: { phone_number_id: '118582961194601', display_phone_number: '593979104167' },
  contacts: [{ wa_id: '593987047531', user_id: 'EC.1716732149501584' }],
  message_echoes: [{
    id: 'wamid.HBgMNTkzOTg3MDQ3NTMx',
    to: '593987047531',
    from: '593979104167',
    text: { body: 'Test' },
    type: 'text',
    timestamp: '1785340249',
  }],
}

test('el telefono es el DESTINATARIO, nunca el remitente', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.telefono, '593987047531')
  assert.notEqual(e.telefono, '593979104167') // 'from' somos nosotros
})

test('el canal sale del metadata, no del from', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.phoneId, '118582961194601')
})

test('traduce el contenido y la fecha', () => {
  const [e] = extraerEchoes(REAL)
  assert.equal(e.tipo, 'texto')
  assert.equal(e.contenido, 'Test')
  assert.equal(e.wamid, 'wamid.HBgMNTkzOTg3MDQ3NTMx')
  assert.equal(e.fecha, new Date(1785340249 * 1000).toISOString())
})

test('una foto mandada desde el celular trae su media id', () => {
  const r = extraerEchoes({
    metadata: { phone_number_id: '118582961194601' },
    message_echoes: [{ id: 'W1', to: '593999', type: 'image', image: { id: 'MID9', caption: 'mira' } }],
  })
  assert.equal(r[0].tipo, 'imagen')
  assert.equal(r[0].mediaId, 'MID9')
  assert.equal(r[0].contenido, 'mira')
})

test('un echo sin destinatario o sin id se descarta, los demas siguen', () => {
  const r = extraerEchoes({
    metadata: { phone_number_id: 'P1' },
    message_echoes: [
      { id: 'W1', type: 'text', text: { body: 'sin to' } },
      { to: '593999', type: 'text', text: { body: 'sin id' } },
      { id: 'W3', to: '593888', type: 'text', text: { body: 'bueno' } },
    ],
  })
  assert.equal(r.length, 1)
  assert.equal(r[0].wamid, 'W3')
})

test('un value vacio o sin echoes devuelve lista vacia, sin lanzar', () => {
  assert.deepEqual(extraerEchoes({}), [])
  assert.deepEqual(extraerEchoes(null), [])
  assert.deepEqual(extraerEchoes({ metadata: {}, messages: [{ id: 'X' }] }), [])
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/echoes.js'`

- [ ] **Step 3: Escribir el módulo**

Crear `lib/echoes.js`:

```js
// lib/echoes.js — Lo que el dueño responde DESDE EL CELULAR.
//
// El número de REPUBLIC está en coexistencia: vive a la vez en Cloud API y en la
// app de WhatsApp Business del teléfono. Cuando se contesta desde el celular,
// Meta nos avisa por el campo `smb_message_echoes`, y ese mensaje NO existía para
// el inbox: la bandeja no se enteraba, el chat seguía pendiente y otro vendedor
// lo volvía a contestar.
//
// Dos trampas del payload, las dos comprobadas contra datos reales:
//   - `from` somos NOSOTROS y `to` es el cliente. Al revés que en un entrante.
//   - `from` viene como número visible (593979104167), NO como phone_id, así que
//     el canal hay que sacarlo de metadata.phone_number_id.
//
// Módulo PURO: traduce y nada más. No decide estados ni escribe en la base.
import { extraer } from './wa-mensaje.js'

/** Payload de un evento `smb_message_echoes` → filas listas para guardar. */
export function extraerEchoes(value) {
  const phoneId = value?.metadata?.phone_number_id || ''
  const filas = []
  for (const eco of value?.message_echoes || []) {
    const telefono = String(eco?.to || '')
    const wamid = String(eco?.id || '')
    if (!telefono || !wamid) continue // sin destinatario o sin id no se puede guardar
    const { tipo, contenido, mediaId, contextoId } = extraer(eco)
    filas.push({
      wamid, telefono, tipo, contenido, mediaId, contextoId, phoneId,
      raw: eco,
      fecha: eco.timestamp
        ? new Date(Number(eco.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    })
  }
  return filas
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: **66 en verde** (60 + 6), 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add lib/echoes.js tests/echoes.test.js
git commit -m "feat(echoes): traducir el payload de smb_message_echoes a filas

Modulo puro, probado contra el payload REAL capturado en inbox.webhook_eventos
el 29-jul, no contra la documentacion.

Las dos trampas que fija ese payload: el telefono del cliente es `to` -usar
`from` crearia una conversacion con nosotros mismos- y el canal sale de
metadata.phone_number_id, porque `from` viene como numero visible y no como
phone_id, asi que no coincide con ningun canal de lib/canales.js.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Archivar todos los tipos de medio

Hoy `archivarFoto` solo se llama para `imagen` y `sticker`, y su tabla de extensiones solo mapea imágenes. Los audios, videos y documentos **no se archivan**: cuelgan del `media_id` de Meta, que caduca a los ~30 días. Hay 28 audios y 3 documentos así, y los más viejos empiezan a morir el **11-ago**.

**Files:**
- Modify: `lib/media-archive.js`
- Test: `tests/media-archive.test.js`

**Interfaces:**
- Produces: `extensionDeMime(contentType) → string` y `archivarMedia({ mediaId, wamid, cuenta })` (antes `archivarFoto`).

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/media-archive.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { extensionDeMime } from '../lib/media-archive.js'

test('mapea los tipos de imagen de siempre', () => {
  assert.equal(extensionDeMime('image/jpeg'), 'jpg')
  assert.equal(extensionDeMime('image/png'), 'png')
})

test('mapea las notas de voz de WhatsApp', () => {
  assert.equal(extensionDeMime('audio/ogg'), 'ogg')
  assert.equal(extensionDeMime('audio/ogg; codecs=opus'), 'ogg')
  assert.equal(extensionDeMime('audio/mpeg'), 'mp3')
})

test('mapea video y documentos', () => {
  assert.equal(extensionDeMime('video/mp4'), 'mp4')
  assert.equal(extensionDeMime('video/3gpp'), '3gp')
  assert.equal(extensionDeMime('application/pdf'), 'pdf')
})

test('un tipo desconocido saca la extension del propio mime', () => {
  assert.equal(extensionDeMime('audio/x-wav'), 'wav')
  assert.equal(extensionDeMime('image/heic'), 'heic')
})

test('sin tipo devuelve bin, nunca jpg', () => {
  assert.equal(extensionDeMime(''), 'bin')
  assert.equal(extensionDeMime(null), 'bin')
  assert.equal(extensionDeMime('application/octet-stream'), 'bin')
})

test('no distingue mayusculas', () => {
  assert.equal(extensionDeMime('IMAGE/JPEG'), 'jpg')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `extensionDeMime` no está exportada.

- [ ] **Step 3: Ampliar `lib/media-archive.js`**

Reemplazar la tabla `EXT` (hoy en la línea 17) por:

```js
// Extensión de archivo según el MIME que devuelve Meta. Antes solo tenía imágenes,
// y todo lo demás caía en 'jpg': un audio quedaba archivado como si fuera una foto.
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin', // el default cuando Meta no dice el tipo
}

/**
 * MIME → extensión. Si no está en la tabla, la deduce del propio MIME
 * ('audio/x-wav' → 'wav') en vez de inventar 'jpg'.
 */
export function extensionDeMime(contentType) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT[t]) return EXT[t]
  const sub = (t.split('/')[1] || '').replace(/^x-/, '').replace(/[^a-z0-9]/g, '')
  return sub || 'bin'
}
```

Renombrar `archivarFoto` a `archivarMedia` (la firma no cambia), actualizar su comentario de cabecera para que hable de "media" y no de "foto", y dentro sustituir:

```js
const ext = EXT[contentType] || 'jpg'
```

por:

```js
const ext = extensionDeMime(contentType)
```

Cambiar también el default del `contentType` de `'image/jpeg'` a `'application/octet-stream'`: asumir que todo es una foto es justo lo que se está arreglando.

- [ ] **Step 4: Actualizar el único llamador**

En `app/api/webhook/route.js`, cambiar el import de la línea 6 y la llamada de la línea ~293 de `archivarFoto` a `archivarMedia`.

Run: `grep -rn "archivarFoto" app/ lib/ components/`
Expected: **sin resultados**.

- [ ] **Step 5: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: **72 en verde** (66 + 6) y build limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/media-archive.js tests/media-archive.test.js app/api/webhook/route.js
git commit -m "fix(media): archivar audio, video y documentos, no solo fotos

La tabla de extensiones solo tenia imagenes y todo lo demas caia en 'jpg'. Peor:
archivarFoto solo se llamaba para imagen y sticker, asi que los audios, videos y
documentos NUNCA se archivaban -cuelgan del media_id de Meta, que caduca a los
~30 dias-. Hay 28 audios y 3 documentos asi, y los mas viejos (12-jul) empiezan a
morir el 11-ago.

extensionDeMime deduce la extension del propio MIME cuando no la conoce, en vez
de inventar 'jpg'. archivarFoto pasa a llamarse archivarMedia; se renombra del
todo en lugar de dejar un alias porque tenia un unico llamador.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: El carril de echoes en el webhook

**Files:**
- Modify: `lib/inbox-supabase.js` (función nueva)
- Modify: `app/api/webhook/route.js` (import, rama nueva en el POST, `procesarEchoes`)

**Interfaces:**
- Consumes: `extraerEchoes(value)` (Task 2), `archivarMedia({mediaId, wamid})` (Task 3), `guardarMensajeSupabase`, `existeWamidSupabase`, `marcarNuevo`.
- Produces: `asegurarConversacionSalienteSupabase(telefono) → { ok, creado }`

- [ ] **Step 1: Añadir el helper de conversación en `lib/inbox-supabase.js`**

Junto a `registrarContactoEntranteSupabase` (línea ~81), añadir:

```js
/**
 * Asegura la conversación de un chat que abrimos NOSOTROS desde el celular (echo).
 * Si ya existe NO la toca: el estado es del dueño, y un echo no puede pisarlo.
 * Si no existe, nace ya atendida y con la IA apagada:
 *  - ATENDIDO porque el chat lo atendió un humano a mano; mandarlo a PENDIENTES
 *    sería pedir que alguien conteste algo que ya se contestó.
 *  - HUMANO porque el guard de "la IA arranca apagada" funciona por AUSENCIA del
 *    contacto en la agenda, y esta fila lo hace aparecer: con el default de la
 *    tabla ('IA'), MANDI AGENT respondería encima de una conversación que abrió
 *    una persona.
 */
export async function asegurarConversacionSalienteSupabase(telefono) {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const { data: exist } = await sb
    .from('conversaciones').select('conversacion_id')
    .eq('cuenta', CUENTA).eq('telefono', tel).maybeSingle()
  if (exist) return { ok: true, creado: false }
  const { error } = await sb.from('conversaciones').insert({
    cuenta: CUENTA, telefono: tel, estado: 'ATENDIDO', modo_ia: 'HUMANO',
  })
  if (error && !/duplicate key/i.test(error.message)) throw error
  return { ok: true, creado: true }
}
```

- [ ] **Step 2: Importar lo necesario en el webhook**

En `app/api/webhook/route.js`, añadir a los imports:

```js
import { extraerEchoes } from '@/lib/echoes'
```

y añadir `asegurarConversacionSalienteSupabase` a la lista que ya se importa de `@/lib/inbox-supabase`.

- [ ] **Step 3: Escribir `procesarEchoes`**

Añadir junto a `procesarStatuses` (línea ~354):

```js
// Echoes: lo que se responde DESDE EL CELULAR llega de vuelta por el webhook.
// Carril MÍNIMO a propósito: guardar y archivar el medio. Nada de saludos, IA,
// LINKPAGO, push ni cambios de estado — un echo no es un cliente escribiendo, es
// nuestra propia respuesta. Por eso no pasa por procesar(), que es donde vive
// todo eso: así no hay nada que acordarse de excluir.
async function procesarEchoes(echoes) {
  for (const e of echoes) {
    try {
      if (await existeWamidSupabase(e.wamid).catch(() => false)) continue
      await asegurarConversacionSalienteSupabase(e.telefono)
      await guardarMensajeSupabase({
        id: e.wamid, telefono: e.telefono, nombre: '', tipo: e.tipo,
        mensaje: e.contenido, mediaUrl: '', timestamp: e.fecha,
        direccion: 'SALIENTE', mediaId: e.mediaId, contextoId: e.contextoId,
        raw: e.raw, phoneId: e.phoneId,
      })
      if (e.mediaId) await archivarMedia({ mediaId: e.mediaId, wamid: e.wamid }).catch(() => {})
    } catch (err) {
      console.error('[/api/webhook echo]', e.wamid, err.message)
    }
  }
}
```

- [ ] **Step 4: Añadir la rama en el POST**

En `export async function POST`, declarar el acumulador junto a `const nuevos = []` (línea ~375):

```js
    const echoes = []
```

y dentro del bucle `for (const change of entry?.changes || [])`, **justo después** de `const value = change?.value || {}` y **antes** de `const phoneId = ...`:

```js
        // Lo que se manda desde el CELULAR viene en value.message_echoes, no en
        // value.messages, y con `to`/`from` al revés. Carril aparte: el `continue`
        // garantiza que no toque nada del camino de los entrantes.
        if (change?.field === 'smb_message_echoes') {
          for (const fila of extraerEchoes(value)) {
            if (marcarNuevo(fila.wamid)) echoes.push(fila)
          }
          continue
        }
```

Y junto a los `waitUntil` del final (línea ~410):

```js
    if (echoes.length && usaSupabaseLectura()) waitUntil(procesarEchoes(echoes))
```

- [ ] **Step 5: Comprobar que la rama corta de verdad**

Run: `grep -n "smb_message_echoes" -A 8 app/api/webhook/route.js`
Expected: el bloque termina en `continue`. Sin ese `continue`, un echo seguiría hacia el código de entrantes y se guardaría con el teléfono equivocado.

- [ ] **Step 6: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: **72 en verde** (esta tarea no añade pruebas: la lógica ya está cubierta por `tests/echoes.test.js`) y build limpio.

- [ ] **Step 7: Commit**

```bash
git add lib/inbox-supabase.js app/api/webhook/route.js
git commit -m "feat(echoes): guardar en el inbox lo que se responde desde el celular

Rama propia por change.field con continue: un echo no entra nunca al camino de
los entrantes. Guarda y archiva el medio, y nada mas -ni saludo, ni IA, ni
LINKPAGO, ni push, ni estados-. No por acordarse de excluirlos, sino porque no
pasa por procesar(), que es donde viven.

Como SALIENTE no toca ultimo_entrante_at, asi que la ventana de 24h de Meta no
se reinicia. El estado de las conversaciones existentes queda intacto.

Una conversacion CREADA por un echo nace ATENDIDO + HUMANO: el chat ya lo
atendio una persona, y con el default de la tabla ('IA') MANDI AGENT contestaria
encima de una conversacion abierta a mano -el guard de la IA apagada funciona
por ausencia del contacto, y esta fila lo hace aparecer-.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificación en producción

**Files:** ninguno.

- [ ] **Step 1: Correr todo**

Run: `npm test && npm run build`
Expected: 72 en verde, build limpio.

- [ ] **Step 2: Subir**

```bash
git push origin main
```

- [ ] **Step 3: Confirmar el deploy**

Comprobar en Vercel que el último deployment con `target: "production"` tiene el SHA recién subido y está `READY`.

- [ ] **Step 4: Prueba real (la hace el dueño)**

1. Desde el celular, en WhatsApp Business con el **4167**, mandar un texto a un chat.
2. Abrir el inbox, pestaña **REPUBLIC**, y confirmar que ese mensaje **aparece** en el hilo.
3. Mandar una **foto** desde el celular y confirmar que se ve.
4. Mandar una **nota de voz** y confirmar que se puede escuchar.

- [ ] **Step 5: Confirmar en la base**

```sql
select telefono, tipo, texto, media_url is not null as archivado,
       to_char(fecha at time zone 'America/Guayaquil','HH24:MI') as hora
from inbox.mensajes
where cuenta='MANDI' and phone_id='118582961194601' and direccion='SALIENTE'
order by fecha desc limit 10;
```

Expected: los mensajes del celular con su `telefono` correcto (el del cliente, **no** `593979104167`) y los medios con `archivado = true`.

- [ ] **Step 6: Comprobar que no se rompió lo de siempre**

Que un cliente escriba a REPUBLIC y que ese entrante siga llegando normal, con su saludo/IA según corresponda. La rama nueva no debe haber tocado ese camino.

---

## Notas para el que ejecute

- **Esto no recupera lo viejo.** Meta manda el histórico por el campo `history`, una sola vez al onboardear la coexistencia (28-jul), y el campo se suscribió el 29-jul. Solo se verá de aquí en adelante.
- Los echoes que llegaron **desde el 29-jul 10:50** están crudos en `inbox.webhook_eventos`. Se pueden rellenar después con `extraerEchoes` si se quiere; no está en este plan.
- El **duplicado está resuelto sin código nuevo**: `guardarMensajeSupabase` hace `upsert onConflict wa_message_id ignoreDuplicates`, y `/api/saliente` ya guarda el wamid de Meta.
- Solo REPUBLIC tiene el campo suscrito. MANDI es otra vuelta.
