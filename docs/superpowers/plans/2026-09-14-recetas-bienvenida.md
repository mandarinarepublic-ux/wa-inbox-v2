# Recetas de bienvenida por anuncio — plan de implementación (MANDI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el inbox de MANDI mande solo, al instante y en orden, el paquete de respuestas rápidas que Rodrigo elige por anuncio, cierre con una pregunta de botones, y avise por Telegram cuando aparece un anuncio nuevo sin receta.

**Architecture:** La configuración vive en `inbox.automatizaciones.config.recetas` (JSON, sin tabla nueva). La decisión y el armado de las piezas son módulos puros probados (`lib/recetas.js`); el webhook solo los llama y envía por `/api/saliente` con la credencial de máquina. Los anuncios vistos se guardan en `inbox.anuncios` (columnas nuevas) y el tope de una receta por ventana en `conversaciones.ultima_receta_at`, marcado ANTES de enviar para que una reentrega de Meta no duplique el paquete.

**Tech Stack:** Next.js 14 (app router), Supabase (PostgREST + RPC), `node --test`, ESLint. Repo `wa-inbox-next` = proyecto Vercel `wa-inbox-v2`, deploy = `git push origin main`.

**Spec:** `docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md`

## Global Constraints

- Español ecuatoriano con tuteo en código, comentarios, commits y textos de la app. Nada de voseo.
- Trabajar SIEMPRE en `main`. Un push a main despliega; confirmar con `git status -sb` y con el deployment de Vercel (`githubCommitSha`).
- `npm test` = `node --test tests/*.test.js && eslint .`. Tiene que quedar en 0 fallos; el warning de `components/RightPanel.jsx:107` es previo y se ignora.
- Nunca `git add -A` ni `git add .`: agregar archivos por nombre.
- `inbox.mensajes.direccion` va en MAYÚSCULAS (`ENTRANTE`/`SALIENTE`).
- Toda llamada interna a `/api/saliente` lleva la credencial de máquina: usar `enviarSaliente(origin, body)` de `lib/responder-ia.js` (agrega `auto:true`, mira `res.ok`, nunca lanza; devuelve la `Response` o `undefined` si falló la red).
- `merge()` de `lib/automatizaciones.js` es de UN nivel: un arreglo dentro de `recetas` se reemplaza entero; un objeto se mezcla por clave.
- Ningún automatismo saca un chat de PENDIENTES. `/api/saliente` con `auto:true` no toca la bandeja.
- Migraciones: `mcp__claude_ai_Supabase__apply_migration` en el proyecto `piingkecjgoisnxccvaa`; se registran solas en `supabase_migrations.schema_migrations`.
- Botones de WhatsApp: máximo 3, título máximo 20 caracteres (`normalizarBotones` de `lib/seguimiento-envio.js` **no existe en MANDI**; este plan crea el equivalente en `lib/recetas.js`).

---

### Task 1: Migración — columnas de anuncios, marca de receta y resumen de anuncios

**Files:**
- Migración Supabase (por MCP), nombre `inbox_recetas_bienvenida`

**Interfaces:**
- Produces: columnas `inbox.anuncios.titular text`, `.texto text`, `.imagen_url text`, `.visto_en timestamptz`, `.avisado_at timestamptz`; columna `inbox.conversaciones.ultima_receta_at timestamptz`; función `inbox.anuncios_resumen(p_cuenta text)` que devuelve `(source_id text, etiqueta text, titular text, imagen_url text, visto_en timestamptz, avisado_at timestamptz, chats_30d int, ultimo_chat timestamptz)`.

- [ ] **Step 1: Comprobar el estado actual (control antes de tocar)**

Ejecutar con `mcp__claude_ai_Supabase__execute_sql`:
```sql
select column_name from information_schema.columns where table_schema='inbox' and table_name='anuncios' order by ordinal_position;
```
Esperado: `cuenta, source_id, etiqueta, actualizado_at` (4 columnas, sin `titular`).

- [ ] **Step 2: Aplicar la migración**

`mcp__claude_ai_Supabase__apply_migration` con `name: inbox_recetas_bienvenida` y este SQL:
```sql
-- Recetas de bienvenida por anuncio (14-sep-2026). Ver wa-inbox-next/docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md
alter table inbox.anuncios
  add column if not exists titular    text,
  add column if not exists texto      text,
  add column if not exists imagen_url text,
  add column if not exists visto_en   timestamptz,   -- 1.ª vez que el INBOX lo vio en un referral
  add column if not exists avisado_at timestamptz;   -- cuándo salió el aviso de "anuncio nuevo"

-- Tope: una receta por cliente por ventana de 24 h. Se marca ANTES de enviar.
alter table inbox.conversaciones add column if not exists ultima_receta_at timestamptz;

-- Resumen para la pantalla: anuncios vistos con chats de los últimos 30 días.
-- Cuenta teléfonos distintos cuyo referral trae ese source_id. Solo mensajes
-- ENTRANTES con referral, que son pocos (uno por clic en anuncio).
create or replace function inbox.anuncios_resumen(p_cuenta text)
returns table (source_id text, etiqueta text, titular text, imagen_url text,
               visto_en timestamptz, avisado_at timestamptz, chats_30d int, ultimo_chat timestamptz)
language sql stable as $$
  with vistos as (
    select m.referral->>'source_id' as source_id,
           count(distinct m.telefono) filter (where m.fecha >= now() - interval '30 days')::int as chats_30d,
           max(m.fecha) as ultimo_chat
    from inbox.mensajes m
    where m.cuenta = p_cuenta and m.direccion = 'ENTRANTE'
      and coalesce(m.referral->>'source_id','') <> ''
    group by 1
  )
  select a.source_id, a.etiqueta, a.titular, a.imagen_url, a.visto_en, a.avisado_at,
         coalesce(v.chats_30d, 0), v.ultimo_chat
  from inbox.anuncios a
  left join vistos v on v.source_id = a.source_id
  where a.cuenta = p_cuenta
  order by coalesce(v.chats_30d, 0) desc, v.ultimo_chat desc nulls last;
$$;
```

- [ ] **Step 3: Verificar**

```sql
select column_name from information_schema.columns where table_schema='inbox' and table_name='anuncios' and column_name in ('titular','visto_en','avisado_at');
select count(*) from inbox.anuncios_resumen('MANDI');
select column_name from information_schema.columns where table_schema='inbox' and table_name='conversaciones' and column_name='ultima_receta_at';
```
Esperado: 3 filas · un número ≥ 27 · 1 fila.

- [ ] **Step 4: Control negativo**

```sql
select count(*) from inbox.anuncios_resumen('NO-EXISTE');
```
Esperado: `0`. Si devolviera filas, el filtro por cuenta está mal.

---

### Task 2: Defaults de configuración `recetas`

**Files:**
- Modify: `lib/automatizaciones.js` (dentro de `DEFAULTS`, después del bloque `seguimientos`)
- Test: `tests/automatizaciones-merge.test.js`

**Interfaces:**
- Produces: `DEFAULTS.recetas = { activo: false, lista: [], por_anuncio: {} }`.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar al final de `tests/automatizaciones-merge.test.js`:
```js
test('las recetas de bienvenida arrancan APAGADAS y vacías', () => {
  assert.equal(DEFAULTS.recetas.activo, false)
  assert.deepEqual(DEFAULTS.recetas.lista, [])
  assert.deepEqual(DEFAULTS.recetas.por_anuncio, {})
})

test('asignar un anuncio no borra los otros (por_anuncio se mezcla por clave)', () => {
  const base  = merge(DEFAULTS, { recetas: { por_anuncio: { '111': 'r_a' } } })
  const nueva = merge(base,     { recetas: { por_anuncio: { '222': 'r_b' } } })
  assert.equal(nueva.recetas.por_anuncio['111'], 'r_a')
  assert.equal(nueva.recetas.por_anuncio['222'], 'r_b')
})
```
⚠️ Ojo: `merge` es de UN nivel: `merge(base, {recetas:{por_anuncio:{...}}})` reemplaza `recetas.por_anuncio` ENTERO. La segunda prueba **debe fallar** y documenta la trampa: la pantalla manda `por_anuncio` completo. Si la prueba pasa, `merge` cambió y hay que revisar el resto de la app.

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test tests/automatizaciones-merge.test.js`
Esperado: la primera falla con `Cannot read properties of undefined (reading 'activo')`; la segunda falla con `'111'` → `undefined`.

- [ ] **Step 3: Implementar**

En `lib/automatizaciones.js`, después del cierre del bloque `seguimientos: { ... },` y antes del comentario `// CORTAFUEGOS de MANDI AGENT`:
```js
  // RECETAS DE BIENVENIDA por anuncio (14-sep-2026). Ver
  // docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md.
  //   lista:       [{ id, nombre, activa, pasos:[{tipo:'respuesta', respuestaId}], pregunta:{texto, botones:[{title}]}|null }]
  //   por_anuncio: { [source_id]: recetaId, organico: recetaId }
  // Arranca APAGADO y sin recetas: sin receta asignada NO sale nada (decisión del dueño).
  // ⚠️ merge() es de UN nivel: `lista` y `por_anuncio` se guardan COMPLETOS desde la pantalla.
  recetas: { activo: false, lista: [], por_anuncio: {} },
```

- [ ] **Step 4: Ajustar la segunda prueba a la realidad del merge y correr**

Cambiar la segunda prueba por:
```js
test('por_anuncio se reemplaza ENTERO (merge de un nivel): la pantalla lo manda completo', () => {
  const base  = merge(DEFAULTS, { recetas: { por_anuncio: { '111': 'r_a' } } })
  const nueva = merge(base,     { recetas: { por_anuncio: { '222': 'r_b' } } })
  assert.equal(nueva.recetas.por_anuncio['111'], undefined)
  assert.equal(nueva.recetas.por_anuncio['222'], 'r_b')
  assert.equal(nueva.recetas.activo, false) // lo que no se manda se conserva
})
```
Run: `node --test tests/automatizaciones-merge.test.js` → todas pasan.

- [ ] **Step 5: Commit**

```bash
git add lib/automatizaciones.js tests/automatizaciones-merge.test.js
git commit -m "feat(recetas): defaults de recetas de bienvenida (apagadas)"
```

---

### Task 3: `lib/recetas.js` — decidir, armar piezas, aviso (módulo puro)

**Files:**
- Create: `lib/recetas.js`
- Test: `tests/recetas.test.js`

**Interfaces:**
- Consumes: `adjuntosDeRespuesta(reply)` de `lib/adjuntos-respuesta.js` (devuelve `[{tipo:'imagen'|'audio'|'documento', url, nombre}]`); la forma `reply` de `toRespuesta` en `lib/inbox-supabase.js` (`{ id, text, botones:[string], adjuntos, imageUrl… }`).
- Produces:
  - `normalizarBotones(lista) → [{ id:'rc_1', title }]` (máx 3, 20 letras, sin vacíos; acepta strings u objetos `{title}`)
  - `decidirReceta({ config, sourceId, esNuevo, contacto, botActivo, ahoraMs }) → receta | null`
  - `piezasDeReceta({ receta, respuestas, contacto }) → [{ Telefono, Nombre, Canal, ...pieza }]` donde pieza es `{Mensaje}` | `{TipoMensaje:'interactive_buttons', Cuerpo, Botones}` | `{ImagenURL}` | `{AudioURL}` | `{DocURL, DocNombre}`
  - `textoAvisoAnuncioNuevo({ cuenta, titular, sourceId, url }) → string` (HTML de Telegram)
  - `VENTANA_RECETA_MS = 24*3600*1000`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/recetas.test.js`:
```js
import test from 'node:test'
import assert from 'node:assert'
import { normalizarBotones, decidirReceta, piezasDeReceta, textoAvisoAnuncioNuevo } from '../lib/recetas.js'

const H = 3600 * 1000
const AHORA = Date.parse('2026-09-14T15:00:00Z')
const hace = (h) => new Date(AHORA - h * H).toISOString()

const saludo = { id: 'r-saludo', text: '¡Hola! 🧡 Bienvenid@ a Mandarina.', botones: [], adjuntos: [{ tipo: 'imagen', url: 'https://x/logo.jpg', nombre: '' }] }
const pitch  = { id: 'r-dbz', text: '🐉 Chaquetas DBZ a $35', botones: [], adjuntos: [
  { tipo: 'imagen', url: 'https://x/1.jpg', nombre: '' }, { tipo: 'audio', url: 'https://x/voz.ogg', nombre: '' }, { tipo: 'documento', url: 'https://x/guia.pdf', nombre: 'guia.pdf' } ] }
const conBotones = { id: 'r-doom', text: '¿Negro o verde?', botones: ['Negro con verde', 'Verde completo'], adjuntos: [] }
const respuestas = [saludo, pitch, conBotones]

const receta = { id: 'r_1', nombre: 'DBZ', activa: true,
  pasos: [{ tipo: 'respuesta', respuestaId: 'r-saludo' }, { tipo: 'respuesta', respuestaId: 'r-dbz' }],
  pregunta: { texto: '¿Cuál te gustó?', botones: [{ title: '1' }, { title: '2' }, { title: '3' }] } }
const config = { recetas: { activo: true, lista: [receta], por_anuncio: { '120252247632190606': 'r_1', organico: 'r_1' } } }
const contacto = { telefono: '593999000111', nombre: 'Ana', alias: '', phoneId: '1024077200794372', ultimaRecetaAt: null }
const base = { config, sourceId: '120252247632190606', esNuevo: true, contacto, botActivo: false, ahoraMs: AHORA }

test('anuncio con receta activa: sale la receta', () => {
  assert.equal(decidirReceta(base)?.id, 'r_1')
})
test('global apagado: nada', () => {
  assert.equal(decidirReceta({ ...base, config: { recetas: { ...config.recetas, activo: false } } }), null)
})
test('anuncio sin receta asignada: nada (decisión del dueño)', () => {
  assert.equal(decidirReceta({ ...base, sourceId: '999' }), null)
})
test('receta asignada pero inactiva: nada', () => {
  const cfg = { recetas: { ...config.recetas, lista: [{ ...receta, activa: false }] } }
  assert.equal(decidirReceta({ ...base, config: cfg }), null)
})
test('el bot va a contestar ese chat: nada', () => {
  assert.equal(decidirReceta({ ...base, botActivo: true }), null)
})
test('ya salió una receta hace 2 h: nada; hace 30 h: sale', () => {
  assert.equal(decidirReceta({ ...base, contacto: { ...contacto, ultimaRecetaAt: hace(2) } }), null)
  assert.equal(decidirReceta({ ...base, contacto: { ...contacto, ultimaRecetaAt: hace(30) } })?.id, 'r_1')
})
test('orgánico: solo si el contacto es NUEVO', () => {
  assert.equal(decidirReceta({ ...base, sourceId: '', esNuevo: true })?.id, 'r_1')
  assert.equal(decidirReceta({ ...base, sourceId: '', esNuevo: false }), null)
})
test('sin config no lanza', () => {
  assert.equal(decidirReceta({ ...base, config: null }), null)
})

test('piezas: texto → adjuntos en orden → pregunta con botones, todas con Canal y Nombre', () => {
  const p = piezasDeReceta({ receta, respuestas, contacto })
  assert.deepEqual(p.map(x => x.Mensaje || x.ImagenURL || x.AudioURL || x.DocURL || x.Cuerpo), [
    '¡Hola! 🧡 Bienvenid@ a Mandarina.', 'https://x/logo.jpg',
    '🐉 Chaquetas DBZ a $35', 'https://x/1.jpg', 'https://x/voz.ogg', 'https://x/guia.pdf',
    '¿Cuál te gustó?',
  ])
  assert.ok(p.every(x => x.Canal === '1024077200794372' && x.Telefono === '593999000111' && x.Nombre === 'Ana'))
  assert.equal(p[5].DocNombre, 'guia.pdf')
  const ult = p[6]
  assert.equal(ult.TipoMensaje, 'interactive_buttons')
  assert.deepEqual(JSON.parse(ult.Botones), [
    { type: 'reply', reply: { id: 'rc_1', title: '1' } },
    { type: 'reply', reply: { id: 'rc_2', title: '2' } },
    { type: 'reply', reply: { id: 'rc_3', title: '3' } },
  ])
})
test('piezas: una respuesta con botones propios sale como interactivo', () => {
  const r = { ...receta, pasos: [{ tipo: 'respuesta', respuestaId: 'r-doom' }], pregunta: null }
  const p = piezasDeReceta({ receta: r, respuestas, contacto })
  assert.equal(p.length, 1)
  assert.equal(p[0].TipoMensaje, 'interactive_buttons')
  assert.equal(p[0].Cuerpo, '¿Negro o verde?')
})
test('piezas: un paso huérfano (respuesta borrada) se salta sin romper', () => {
  const r = { ...receta, pasos: [{ tipo: 'respuesta', respuestaId: 'no-existe' }, { tipo: 'respuesta', respuestaId: 'r-saludo' }], pregunta: null }
  const p = piezasDeReceta({ receta: r, respuestas, contacto })
  assert.equal(p.length, 2)
  assert.equal(p[0].Mensaje, '¡Hola! 🧡 Bienvenid@ a Mandarina.')
})
test('piezas: pregunta sin botones válidos sale como texto plano; sin texto no sale', () => {
  const r1 = { ...receta, pasos: [], pregunta: { texto: '¿Talla?', botones: [{ title: '  ' }] } }
  assert.deepEqual(piezasDeReceta({ receta: r1, respuestas, contacto }).map(x => x.Mensaje), ['¿Talla?'])
  const r2 = { ...receta, pasos: [], pregunta: { texto: '', botones: [{ title: 'M' }] } }
  assert.equal(piezasDeReceta({ receta: r2, respuestas, contacto }).length, 0)
})
test('el alias manda sobre el nombre de Meta', () => {
  const p = piezasDeReceta({ receta, respuestas, contacto: { ...contacto, alias: 'Anita' } })
  assert.equal(p[0].Nombre, 'Anita')
})
test('botones: recorte a 20 letras, máximo 3, sin vacíos, acepta strings', () => {
  assert.deepEqual(normalizarBotones(['Sí', { title: '   ' }, { title: 'Quiero más información por favor' }, 'x', 'y']),
    [{ id: 'rc_1', title: 'Sí' }, { id: 'rc_2', title: 'Quiero más informaci' }, { id: 'rc_3', title: 'x' }])
})
test('aviso de anuncio nuevo: trae cuenta, titular, id y enlace', () => {
  const t = textoAvisoAnuncioNuevo({ cuenta: 'MANDI', titular: 'Hoodie Luffy', sourceId: '120253', url: 'https://inbox.apps.mandarinaec.com/?tab=autos' })
  assert.match(t, /Anuncio NUEVO en MANDI/)
  assert.match(t, /Hoodie Luffy/)
  assert.match(t, /120253/)
  assert.match(t, /tab=autos/)
})
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test tests/recetas.test.js`
Esperado: `Cannot find module '.../lib/recetas.js'`.

- [ ] **Step 3: Implementar `lib/recetas.js`**

```js
// lib/recetas.js — Recetas de bienvenida por anuncio. Módulo PURO (sin red ni base).
//
// Una receta es la lista ordenada de respuestas rápidas que Rodrigo manda a mano
// cuando alguien llega de un anuncio (medido: saludo → pitch → fotos, con 74 min
// de retraso). Acá se decide A QUIÉN le toca y QUÉ piezas salen; el webhook solo
// llama y envía. Ver docs/superpowers/specs/2026-09-14-recetas-bienvenida-design.md.
import { adjuntosDeRespuesta } from './adjuntos-respuesta.js'

export const VENTANA_RECETA_MS = 24 * 3600 * 1000
export const MAX_BOTONES = 3
export const MAX_TITULO = 20

/** [{title}] o ['título'] → [{ id, title }]: sin vacíos, 20 letras, máx 3 (límites de WhatsApp). */
export function normalizarBotones(lista) {
  const out = []
  for (const b of Array.isArray(lista) ? lista : []) {
    const title = String((b && typeof b === 'object') ? b.title : b || '').trim().slice(0, MAX_TITULO)
    if (!title) continue
    out.push({ id: `rc_${out.length + 1}`, title })
    if (out.length >= MAX_BOTONES) break
  }
  return out
}

/**
 * ¿A este entrante le toca una receta? Devuelve la receta o null.
 *  - Global apagado, anuncio sin receta, receta inactiva → null (sin receta NO sale nada).
 *  - Orgánico (sin sourceId) solo para contactos NUEVOS.
 *  - Si el bot va a contestar ese chat, se lo deja en paz.
 *  - Una receta por cliente por ventana de 24 h (contacto.ultimaRecetaAt).
 */
export function decidirReceta({ config, sourceId, esNuevo, contacto, botActivo, ahoraMs = Date.now() }) {
  const rc = config?.recetas
  if (!rc?.activo) return null
  if (botActivo) return null
  const sid = String(sourceId || '').trim()
  const recetaId = sid ? rc.por_anuncio?.[sid] : (esNuevo ? rc.por_anuncio?.organico : null)
  if (!recetaId) return null
  const receta = (Array.isArray(rc.lista) ? rc.lista : []).find(r => r?.id === recetaId)
  if (!receta || receta.activa === false) return null
  const ult = contacto?.ultimaRecetaAt ? new Date(contacto.ultimaRecetaAt).getTime() : 0
  if (ult && ahoraMs - ult < VENTANA_RECETA_MS) return null
  return receta
}

const pieza = (contacto, extra) => ({
  Telefono: contacto.telefono,
  Nombre: contacto.alias || contacto.nombre || '',
  Canal: contacto.phoneId,
  ...extra,
})

const interactivo = (texto, botones) => ({
  TipoMensaje: 'interactive_buttons',
  Cuerpo: texto,
  Botones: JSON.stringify(botones.map(({ id, title }) => ({ type: 'reply', reply: { id, title } }))),
})

/**
 * Las piezas a mandar por /api/saliente, EN ORDEN: por cada paso, su texto (o
 * texto+botones si la respuesta rápida los tiene) y luego sus adjuntos como los
 * cargó el vendedor; al final la pregunta con botones. Un paso cuya respuesta ya
 * no existe se salta con log: mejor un paquete incompleto que uno mudo.
 */
export function piezasDeReceta({ receta, respuestas, contacto }) {
  const out = []
  const porId = new Map((respuestas || []).map(r => [String(r.id), r]))
  for (const paso of Array.isArray(receta?.pasos) ? receta.pasos : []) {
    if (paso?.tipo !== 'respuesta') continue
    const r = porId.get(String(paso.respuestaId))
    if (!r) { console.warn('[recetas] paso huérfano, respuesta rápida no existe:', paso.respuestaId); continue }
    const texto = String(r.text || '').trim()
    const botones = normalizarBotones(r.botones)
    if (texto && botones.length) out.push(pieza(contacto, interactivo(texto, botones)))
    else if (texto) out.push(pieza(contacto, { Mensaje: texto }))
    for (const a of adjuntosDeRespuesta(r)) {
      if (a.tipo === 'audio') out.push(pieza(contacto, { AudioURL: a.url }))
      else if (a.tipo === 'documento') out.push(pieza(contacto, { DocURL: a.url, DocNombre: a.nombre || 'documento' }))
      else out.push(pieza(contacto, { ImagenURL: a.url }))
    }
  }
  const q = receta?.pregunta
  const qTexto = String(q?.texto || '').trim()
  if (qTexto) {
    const botones = normalizarBotones(q.botones)
    out.push(pieza(contacto, botones.length ? interactivo(qTexto, botones) : { Mensaje: qTexto }))
  }
  return out
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Texto (HTML de Telegram) del aviso de anuncio nuevo sin receta. */
export function textoAvisoAnuncioNuevo({ cuenta, titular, sourceId, url }) {
  return [
    `📣 <b>Anuncio NUEVO en ${esc(cuenta)}</b>`,
    `«${esc(titular || '(sin titular)')}»`,
    `id <code>${esc(sourceId)}</code>`,
    'Sin receta: nadie le contesta solo. Configúralo en AUTOS → Bienvenida por anuncio',
    esc(url),
  ].join('\n')
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `node --test tests/recetas.test.js`
Esperado: 14 pruebas, 0 fallos. `adjuntosDeRespuesta` devuelve `tipo` ∈ `imagen|audio|documento` (lista cerrada `TIPOS` en `lib/adjuntos-respuesta.js`, línea 59).

- [ ] **Step 5: Commit**

```bash
git add lib/recetas.js tests/recetas.test.js
git commit -m "feat(recetas): decidir receta, armar piezas y aviso de anuncio nuevo (puro, probado)"
```

---

### Task 4: Persistencia — anuncios vistos, marca de receta con guardia, `ultimaRecetaAt` en la ficha

**Files:**
- Modify: `lib/inbox-supabase.js` (`COLS_CONTACTO`, `toContacto`, y tres funciones nuevas al final de la sección de contactos, junto a `marcarSeguimientoSupabase`)
- Modify: `lib/contactos.js` (dos reexports)
- Test: `tests/columnas-contacto.test.js` (ya existe: vigila que cada campo de `toContacto` tenga su columna)

**Interfaces:**
- Produces:
  - `toContacto(c).ultimaRecetaAt` (ISO o null) — lo lee `decidirReceta`.
  - `registrarAnuncioVistoSupabase({ sourceId, referral }) → { ok, nuevo:boolean }` — upsert por `(cuenta, source_id)`; `nuevo=true` solo si la fila no existía o tenía `visto_en` nulo.
  - `marcarAvisoAnuncioSupabase(sourceId) → { ok }` — `avisado_at = now()`.
  - `marcarRecetaSupabase(telefono, ahoraIso) → { ok, marcado:boolean }` — `marcado=false` si otro proceso ya marcó dentro de las 24 h (guardia en el WHERE).
  - `getAnunciosResumenSupabase() → filas de inbox.anuncios_resumen(CUENTA)`.
  - `setEtiquetaAnuncioSupabase(sourceId, etiqueta) → { ok }`.
  - En `lib/contactos.js`: `marcarReceta(telefono, ahoraIso)`, `registrarAnuncioVisto(args)`, `marcarAvisoAnuncio(sourceId)`, `getAnunciosResumen()`, `setEtiquetaAnuncio(sourceId, etiqueta)`.

- [ ] **Step 1: Prueba de la columna nueva (falla)**

Abrir `tests/columnas-contacto.test.js` y agregar, junto a las comprobaciones existentes (seguir el patrón del archivo; si compara `Object.keys(toContacto({}))` contra `COLS_CONTACTO`, basta con que `ultimaRecetaAt` aparezca en la ficha y `ultima_receta_at` en las columnas):
```js
test('la ficha trae ultimaRecetaAt y la columna ultima_receta_at está pedida', () => {
  assert.ok(COLS_CONTACTO.includes('ultima_receta_at'))
})
```
(Importar `COLS_CONTACTO` desde `../lib/inbox-supabase.js` si el archivo aún no lo importa.)

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test tests/columnas-contacto.test.js` → falla en `includes('ultima_receta_at')`.

- [ ] **Step 3: Implementar**

En `COLS_CONTACTO` agregar `'ultima_receta_at'` al final de la lista. En `toContacto` agregar:
```js
    ultimaRecetaAt: c.ultima_receta_at || null, // última receta de bienvenida (tope 1 por ventana)
```
Después de `marcarAlertaVentanaSupabase` agregar:
```js
// ── Recetas de bienvenida por anuncio ────────────────────────────────────────
// Marca "a este cliente ya le salió una receta" ANTES de enviar, con guardia en el
// WHERE: si Meta reentrega el mismo webhook (pasa: ver lib/reentrega.js), el
// segundo proceso no encuentra fila que tocar y NO manda el paquete otra vez.
export async function marcarRecetaSupabase(telefono, ahoraIso = new Date().toISOString()) {
  const sb = getSupabase()
  const tel = canonTel(telefono) || String(telefono)
  const limite = new Date(Date.parse(ahoraIso) - 24 * 3600 * 1000).toISOString()
  const { data, error } = await sb
    .from('conversaciones')
    .update({ ultima_receta_at: ahoraIso })
    .eq('cuenta', CUENTA).eq('telefono', tel)
    .or(`ultima_receta_at.is.null,ultima_receta_at.lt.${limite}`)
    .select('conversacion_id')
  if (error) throw error
  return { ok: true, marcado: (data || []).length > 0 }
}

// Un anuncio que el inbox ve por primera vez. No pisa `etiqueta` si ya la tiene
// (la cargó el CRM o la puso Rodrigo); sí completa titular/texto/foto si faltan.
export async function registrarAnuncioVistoSupabase({ sourceId, referral }) {
  const sb = getSupabase()
  const sid = String(sourceId || '').trim()
  if (!sid) return { ok: false, nuevo: false }
  const { data: exist } = await sb.from('anuncios').select('source_id, visto_en, etiqueta')
    .eq('cuenta', CUENTA).eq('source_id', sid).maybeSingle()
  const snap = {
    titular: String(referral?.headline || '').slice(0, 300) || null,
    texto: String(referral?.body || '').slice(0, 1000) || null,
    imagen_url: String(referral?.image_url || referral?.thumbnail_url || '').slice(0, 1000) || null,
  }
  if (!exist) {
    const { error } = await sb.from('anuncios').insert({
      cuenta: CUENTA, source_id: sid, etiqueta: snap.titular || '', ...snap, visto_en: new Date().toISOString(),
    })
    if (error && !/duplicate key/i.test(error.message)) throw error
    return { ok: true, nuevo: !error }
  }
  if (exist.visto_en) return { ok: true, nuevo: false }
  const { error } = await sb.from('anuncios').update({ ...snap, visto_en: new Date().toISOString() })
    .eq('cuenta', CUENTA).eq('source_id', sid).is('visto_en', null)
  if (error) throw error
  return { ok: true, nuevo: true }
}

export async function marcarAvisoAnuncioSupabase(sourceId) {
  const sb = getSupabase()
  const { error } = await sb.from('anuncios').update({ avisado_at: new Date().toISOString() })
    .eq('cuenta', CUENTA).eq('source_id', String(sourceId)).is('avisado_at', null)
  if (error) throw error
  return { ok: true }
}

export async function getAnunciosResumenSupabase() {
  const sb = getSupabase()
  const { data, error } = await sb.rpc('anuncios_resumen', { p_cuenta: CUENTA })
  if (error) throw error
  return data || []
}

export async function setEtiquetaAnuncioSupabase(sourceId, etiqueta) {
  const sb = getSupabase()
  const { error } = await sb.from('anuncios').update({ etiqueta: String(etiqueta || '').trim().slice(0, 120) })
    .eq('cuenta', CUENTA).eq('source_id', String(sourceId))
  if (error) throw error
  return { ok: true }
}
```
En `lib/contactos.js`, al final:
```js
// Recetas de bienvenida por anuncio (lib/recetas.js decide; esto solo persiste).
export async function marcarReceta(telefono, ahoraIso) { return SB.marcarRecetaSupabase(telefono, ahoraIso) }
export async function registrarAnuncioVisto(args) { return SB.registrarAnuncioVistoSupabase(args) }
export async function marcarAvisoAnuncio(sourceId) { return SB.marcarAvisoAnuncioSupabase(sourceId) }
export async function getAnunciosResumen() { return SB.getAnunciosResumenSupabase() }
export async function setEtiquetaAnuncio(sourceId, etiqueta) { return SB.setEtiquetaAnuncioSupabase(sourceId, etiqueta) }
```
⚠️ El `.rpc('anuncios_resumen')` funciona porque el cliente de `lib/supabase.js` ya apunta al schema `inbox` (así llama a `pendientes_bandeja`). Si no, usar `sb.schema('inbox').rpc(...)` como hacen las otras rpc del archivo — copiar exactamente la forma de `pendientes_bandeja` (línea ~930).

- [ ] **Step 4: Correr todo**

Run: `npm test` → 0 fallos.

- [ ] **Step 5: Verificación manual de la guardia (doble golpe)**

Con `execute_sql`, contra tu propio teléfono de pruebas (reemplazar `593…`):
```sql
update inbox.conversaciones set ultima_receta_at = now() where cuenta='MANDI' and telefono='593…' and (ultima_receta_at is null or ultima_receta_at < now() - interval '24 hours') returning telefono;
```
Correrlo dos veces: la primera devuelve 1 fila, la segunda 0. Después limpiar: `update inbox.conversaciones set ultima_receta_at = null where cuenta='MANDI' and telefono='593…';`

- [ ] **Step 6: Commit**

```bash
git add lib/inbox-supabase.js lib/contactos.js tests/columnas-contacto.test.js
git commit -m "feat(recetas): anuncios vistos, marca de receta con guardia y ultimaRecetaAt en la ficha"
```

---

### Task 5: API `/api/anuncios` (detrás del login) + cliente

**Files:**
- Create: `app/api/anuncios/route.js`
- Modify: `lib/api-client.js` (dos funciones al final)
- Modify: `tests/rutas-publicas.test.js` (agregar `'/api/anuncios'` a `PROTEGIDAS`)

**Interfaces:**
- Produces: `GET /api/anuncios → { ok, anuncios:[{ source_id, etiqueta, titular, imagen_url, visto_en, avisado_at, chats_30d, ultimo_chat }] }`; `PATCH /api/anuncios { source_id, etiqueta } → { ok }`; `getAnuncios()` y `patchAnuncio(sourceId, etiqueta)` en `lib/api-client.js`.

- [ ] **Step 1: Prueba (falla)**

En `tests/rutas-publicas.test.js`, agregar `'/api/anuncios'` a la lista `PROTEGIDAS`. Run: `node --test tests/rutas-publicas.test.js` → pasa ya (la ruta no está en `RUTAS_PUBLICAS`). **Esto es a propósito**: la prueba documenta que la ruta va detrás del candado; si alguien la hace pública, cae.

- [ ] **Step 2: Implementar la ruta**

`app/api/anuncios/route.js`:
```js
import { NextResponse } from 'next/server'
import { getAnunciosResumen, setEtiquetaAnuncio } from '@/lib/contactos'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Anuncios vistos por el inbox (con chats de 30 días) para la tarjeta
// "Bienvenida por anuncio" de AUTOS. Va detrás del login como todo lo del navegador.
export async function GET() {
  try {
    const anuncios = await getAnunciosResumen()
    return NextResponse.json({ ok: true, anuncios })
  } catch (err) {
    console.error('[/api/anuncios GET]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function PATCH(req) {
  try {
    const { source_id, etiqueta } = await req.json().catch(() => ({}))
    if (!source_id) return NextResponse.json({ ok: false, error: 'falta source_id' }, { status: 400 })
    await setEtiquetaAnuncio(source_id, etiqueta)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[/api/anuncios PATCH]', err.message)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
```
En `lib/api-client.js`, al final:
```js
export async function getAnuncios() {
  try {
    const res = await fetch(`/api/anuncios?t=${Date.now()}`, { cache: 'no-store' })
    return await res.json()
  } catch (err) {
    console.error('[api-client] getAnuncios:', err)
    return { ok: false, anuncios: [] }
  }
}

export async function patchAnuncio(sourceId, etiqueta) {
  try {
    const res = await fetch('/api/anuncios', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, etiqueta }),
    })
    return await res.json().catch(() => ({ ok: res.ok }))
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
```

- [ ] **Step 3: Correr pruebas y lint**

Run: `npm test` → 0 fallos.

- [ ] **Step 4: Commit**

```bash
git add app/api/anuncios/route.js lib/api-client.js tests/rutas-publicas.test.js
git commit -m "feat(recetas): /api/anuncios (lista con chats 30d y etiqueta), detrás del candado"
```

---

### Task 6: Webhook — anuncio visto + aviso + envío de la receta

**Files:**
- Modify: `app/api/webhook/route.js` (imports; dentro de `procesar`: nueva función `recetaSiCorresponde`, y el bucle `for (const m of nuevos)` justo antes de `saludarSiCorresponde`)

**Interfaces:**
- Consumes: `decidirReceta`, `piezasDeReceta`, `textoAvisoAnuncioNuevo` (`lib/recetas.js`); `marcarReceta`, `registrarAnuncioVisto`, `marcarAvisoAnuncio` (`lib/contactos.js`); `getRespuestas` (`lib/respuestas.js`); `enviarTelegram` (`lib/telegram.js`); `enviarSaliente` (ya importado); `CUENTA` (`lib/supabase.js`).

- [ ] **Step 1: Imports**

Agregar arriba del archivo:
```js
import { marcarReceta, registrarAnuncioVisto, marcarAvisoAnuncio } from '@/lib/contactos'
import { decidirReceta, piezasDeReceta, textoAvisoAnuncioNuevo } from '@/lib/recetas'
import { getRespuestas } from '@/lib/respuestas'
import { enviarTelegram } from '@/lib/telegram'
import { CUENTA } from '@/lib/supabase'
```
(Si `lib/contactos` ya está importado en la línea 3, sumar los tres nombres a ese import en vez de duplicarlo.)

- [ ] **Step 2: La función, dentro de `procesar`, después de `saludarSiCorresponde`**

```js
  // ── Recetas de bienvenida por anuncio ──────────────────────────────────────
  // Ver lib/recetas.js. Devuelve true si SALIÓ una receta (entonces el saludo
  // automático no se manda: la receta ya saludó).
  //
  // Orden que importa:
  //   1. marcarReceta ANTES de enviar, con guardia → una reentrega de Meta no
  //      duplica el paquete (el segundo proceso ve `marcado:false` y se va).
  //   2. Las piezas salen UNA a UNA con await: el cliente las ve en el orden
  //      que Rodrigo cargó (texto → fotos → voz → pregunta).
  //   3. Una pieza rechazada se registra con su código y se sigue: mejor un
  //      paquete incompleto que uno mudo.
  let respuestasCache = null
  const respuestasRapidas = async () => {
    if (!respuestasCache) respuestasCache = await getRespuestas().catch(() => [])
    return respuestasCache
  }
  const recetados = new Set()
  async function recetaSiCorresponde(m) {
    if (!auto?.recetas?.activo) return false
    const t = tail9(m.telefono)
    if (recetados.has(t)) return false
    const sourceId = String(m.referral?.source_id || '').trim()
    const contacto = contactos.find(c => tail9(c.telefono) === t) || null
    const receta = decidirReceta({
      config: auto, sourceId, esNuevo: esNuevoDe(m.telefono),
      contacto: { ...(contacto || {}), telefono: m.telefono, nombre: m.nombre, phoneId: m.phoneId },
      botActivo: modoIAde(m.telefono, m.phoneId),
    })
    if (!receta) return false
    recetados.add(t)
    const { marcado } = await marcarReceta(m.telefono).catch(e => { console.error('[/api/webhook] marcar receta:', e.message); return { marcado: false } })
    if (!marcado) return false
    const piezas = piezasDeReceta({
      receta, respuestas: await respuestasRapidas(),
      contacto: { telefono: m.telefono, nombre: m.nombre, alias: contacto?.alias || '', phoneId: m.phoneId },
    })
    let salieron = 0
    for (const p of piezas) {
      const r = await enviarSaliente(origin, p)
      if (r?.ok) salieron++
      else console.error('[/api/webhook] receta', receta.id, 'pieza rechazada', r?.status ?? 'red', m.telefono)
    }
    console.log('[/api/webhook] receta', receta.id, 'a', m.telefono, `${salieron}/${piezas.length} piezas`)
    return salieron > 0
  }

  // Anuncio que el inbox ve por PRIMERA vez → un aviso por Telegram, una sola vez.
  async function anuncioVistoSiCorresponde(m) {
    const sourceId = String(m.referral?.source_id || '').trim()
    if (!sourceId) return
    const { nuevo } = await registrarAnuncioVisto({ sourceId, referral: m.referral })
    if (!nuevo) return
    const texto = textoAvisoAnuncioNuevo({
      cuenta: CUENTA, titular: m.referral?.headline || '', sourceId,
      url: `${origin}/?tab=autos`,
    })
    const r = await enviarTelegram(texto)
    if (r?.ok) await marcarAvisoAnuncio(sourceId).catch(() => {})
  }
```

- [ ] **Step 3: Engancharlo en el bucle**

Justo ANTES de la línea `await saludarSiCorresponde(m.telefono, m.nombre, m.phoneId)`, reemplazar ese bloque por:
```js
    // Anuncio nuevo → aviso. Nunca lanza, nunca frena el resto.
    await anuncioVistoSiCorresponde(m)
      .catch(e => console.error('[/api/webhook] anuncio visto:', e.message))

    // Receta de bienvenida por anuncio. Si salió, reemplaza al saludo automático.
    const conReceta = await recetaSiCorresponde(m)
      .catch(e => { console.error('[/api/webhook] receta:', e.message); return false })

    // Saludo automático (bienvenida a nuevo / "hola de vuelta" al reactivarse).
    // Va antes de LINKPAGO/IA y solo dispara con la IA apagada.
    if (!conReceta) {
      await saludarSiCorresponde(m.telefono, m.nombre, m.phoneId)
        .catch(e => console.error('[/api/webhook] saludo:', e.message))
    }
```

- [ ] **Step 4: Compilar y pruebas**

Run: `npm test` → 0 fallos. Run: `npx next build` → sin errores.

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/route.js
git commit -m "feat(recetas): el webhook manda la receta del anuncio y avisa de anuncios nuevos"
```

---

### Task 7: Pantalla — tarjeta "📣 Bienvenida por anuncio" en AUTOS

**Files:**
- Modify: `components/Automatizaciones.jsx` (imports; estado; helpers; la tarjeta antes del bloque `{/* Nota siguiente módulo */}`)

**Interfaces:**
- Consumes: `getAnuncios`, `patchAnuncio`, `fetchRepliesFromSheet` (existe en `lib/api-client.js`, línea ~161; pese al nombre lee `/api/respuestas` y devuelve la lista de respuestas rápidas con `{ id, text, botones, adjuntos, imageUrl… }`), `saveAutomatizaciones`.
- Produces: `config.recetas` editado en pantalla; interruptor global y por receta guardados al instante.

- [ ] **Step 1: Imports y estado**

```js
import { getAutomatizaciones, saveAutomatizaciones, getAnuncios, patchAnuncio, fetchRepliesFromSheet } from '@/lib/api-client'
```
Dentro del componente, junto a los otros `useState`:
```js
  const [anuncios,   setAnuncios]   = useState([])
  const [respuestas, setRespuestas] = useState([])
```
En `cargar`, después de `setConfig(c)`: cargar en paralelo
```js
    const [a, r] = await Promise.all([getAnuncios().catch(() => null), fetchRepliesFromSheet().catch(() => [])])
    setAnuncios(a?.anuncios || [])
    setRespuestas(Array.isArray(r) ? r : [])
```

- [ ] **Step 2: Helpers (después de `togSegT`)**

```js
  // ── Recetas de bienvenida por anuncio ──────────────────────────────────────
  // `lista` y `por_anuncio` se mandan COMPLETOS (merge de un nivel). Los
  // interruptores van al instante; el resto con "Guardar cambios".
  const rc = config?.recetas || { activo: false, lista: [], por_anuncio: {} }
  const setRc = (patch) => setConfig(prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), ...patch } }))
  const togRcG = (valor) => guardarInterruptor(
    { recetas: { activo: valor } },
    prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), activo: valor } }))
  const togReceta = (id, valor) => {
    const lista = (rc.lista || []).map(r => r.id === id ? { ...r, activa: valor } : r)
    guardarInterruptor({ recetas: { lista } }, prev => ({ ...prev, recetas: { ...(prev?.recetas || {}), lista } }))
  }
  const nuevaReceta = () => setRc({ lista: [...(rc.lista || []), {
    id: 'r_' + Math.random().toString(36).slice(2, 8), nombre: 'Nueva receta', activa: true, pasos: [], pregunta: null,
  }] })
  const editarReceta = (id, patch) => setRc({ lista: (rc.lista || []).map(r => r.id === id ? { ...r, ...patch } : r) })
  const borrarReceta = (id) => {
    const por_anuncio = Object.fromEntries(Object.entries(rc.por_anuncio || {}).filter(([, v]) => v !== id))
    setRc({ lista: (rc.lista || []).filter(r => r.id !== id), por_anuncio })
  }
  const duplicarReceta = (r) => setRc({ lista: [...(rc.lista || []), { ...r, id: 'r_' + Math.random().toString(36).slice(2, 8), nombre: r.nombre + ' (copia)' }] })
  const asignar = (sourceId, recetaId) => setRc({ por_anuncio: { ...(rc.por_anuncio || {}), [sourceId]: recetaId || null } })
  const moverPaso = (r, i, d) => {
    const pasos = [...r.pasos]; const j = i + d
    if (j < 0 || j >= pasos.length) return
    ;[pasos[i], pasos[j]] = [pasos[j], pasos[i]]
    editarReceta(r.id, { pasos })
  }
  const respuestaDe = (id) => respuestas.find(x => String(x.id) === String(id))
  const resumenRespuesta = (x) => {
    const n = (Array.isArray(x?.adjuntos) && x.adjuntos.length) ? x.adjuntos.length
      : [x?.imageUrl, x?.imageUrl2, x?.imageUrl3, x?.imageUrl4, x?.imageUrl5].filter(Boolean).length
    return `${String(x?.text || '').slice(0, 60)}${n ? ` · ${n} adj.` : ''}`
  }
  const guardarEtiqueta = async (sourceId, etiqueta) => {
    const r = await patchAnuncio(sourceId, etiqueta)
    if (r?.ok) setAnuncios(prev => prev.map(a => a.source_id === sourceId ? { ...a, etiqueta } : a))
    else { setToast('❌ No se guardó la etiqueta'); setTimeout(() => setToast(null), 2500) }
  }
  const btnChico = { background: 'transparent', border: '1px solid #1e2d3d', color: '#94a3b8', borderRadius: 8, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontFamily: 'Outfit,sans-serif' }
  const selectStyle = { background: '#080d14', border: '1px solid #1e2d3d', borderRadius: 8, color: '#e2e8f0', fontSize: 12, padding: '6px 8px', fontFamily: 'Outfit,sans-serif', outline: 'none', maxWidth: '100%' }
```

- [ ] **Step 3: La tarjeta (antes de `{/* Nota siguiente módulo */}`)**

```jsx
          {/* ── BIENVENIDA POR ANUNCIO (recetas) ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: rc.activo ? 14 : 0 }}>
              <div style={{ fontSize: 26 }}>📣</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>Bienvenida por anuncio</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                  Cuando alguien llega de un anuncio, sale sola la <b style={{ color: '#94a3b8' }}>receta</b> que elijas: tus respuestas rápidas en orden y una pregunta con botones. Un anuncio sin receta no recibe nada automático. Una vez por cliente por ventana de 24h.
                </div>
              </div>
              <Switch on={!!rc.activo} onClick={() => togRcG(!rc.activo)} />
            </div>

            {rc.activo && (<>
              {/* Anuncios vistos */}
              <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', margin: '6px 0 8px' }}>ANUNCIOS VISTOS · {anuncios.length}</div>
              {[{ source_id: 'organico', etiqueta: 'Orgánico (sin anuncio)', titular: 'Contactos nuevos que escriben por su cuenta', chats_30d: null, fijo: true }, ...anuncios].map(a => {
                const asignada = rc.por_anuncio?.[a.source_id] || ''
                const nuevo = !a.fijo && !asignada
                return (
                  <div key={a.source_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, border: `1px solid ${nuevo ? '#f59e0b55' : '#1e2d3d'}`, background: nuevo ? '#f59e0b0c' : 'transparent' }}>
                    {a.imagen_url ? <img src={a.imagen_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 36, height: 36, borderRadius: 8, background: '#1e2d3d', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {a.fijo
                        ? <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{a.etiqueta}</div>
                        : <input defaultValue={a.etiqueta || ''} placeholder="Etiqueta (ej. DBZ chaquetas)" maxLength={120}
                            onBlur={e => e.target.value !== (a.etiqueta || '') && guardarEtiqueta(a.source_id, e.target.value)}
                            style={{ ...selectStyle, width: '100%', fontWeight: 800, color: '#e2e8f0', padding: '4px 6px' }} />}
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nuevo && <b style={{ color: '#f59e0b', marginRight: 6 }}>NUEVO</b>}
                        {a.titular || '(sin titular)'}{a.chats_30d != null ? ` · ${a.chats_30d} chats en 30 días` : ''}
                      </div>
                    </div>
                    <select value={asignada} onChange={e => asignar(a.source_id, e.target.value)} style={selectStyle}>
                      <option value="">— sin receta —</option>
                      {(rc.lista || []).map(r => <option key={r.id} value={r.id}>{r.nombre}{r.activa === false ? ' (apagada)' : ''}</option>)}
                    </select>
                  </div>
                )
              })}

              {/* Recetas */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>RECETAS · {(rc.lista || []).length}</div>
                <button onClick={nuevaReceta} style={btnChico}>+ Nueva receta</button>
              </div>
              {(rc.lista || []).map(r => (
                <div key={r.id} style={{ border: `1px solid ${r.activa !== false ? '#f59e0b44' : '#1e2d3d'}`, borderRadius: 12, padding: 12, marginBottom: 10, background: r.activa !== false ? '#f59e0b0a' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input value={r.nombre || ''} onChange={e => editarReceta(r.id, { nombre: e.target.value })} maxLength={60}
                      style={{ ...selectStyle, flex: 1, fontWeight: 800, color: '#e2e8f0' }} />
                    <button onClick={() => duplicarReceta(r)} style={btnChico} title="Duplicar">⧉</button>
                    <button onClick={() => borrarReceta(r.id)} style={{ ...btnChico, color: '#ef4444' }} title="Eliminar">✕</button>
                    <Switch on={r.activa !== false} onClick={() => togReceta(r.id, !(r.activa !== false))} />
                  </div>

                  <div style={{ fontSize: 11, color: '#64748b', margin: '10px 0 6px' }}>Pasos (salen en este orden):</div>
                  {(r.pasos || []).map((p, i) => {
                    const x = respuestaDe(p.respuestaId)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#64748b', width: 16 }}>{i + 1}.</span>
                        <div style={{ flex: 1, fontSize: 12, color: x ? '#e2e8f0' : '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {x ? resumenRespuesta(x) : `⚠️ respuesta rápida borrada (${p.respuestaId})`}
                        </div>
                        <button onClick={() => moverPaso(r, i, -1)} style={btnChico}>▲</button>
                        <button onClick={() => moverPaso(r, i, +1)} style={btnChico}>▼</button>
                        <button onClick={() => editarReceta(r.id, { pasos: r.pasos.filter((_, k) => k !== i) })} style={btnChico}>✕</button>
                      </div>
                    )
                  })}
                  <select value="" onChange={e => { if (e.target.value) editarReceta(r.id, { pasos: [...(r.pasos || []), { tipo: 'respuesta', respuestaId: e.target.value }] }) }} style={{ ...selectStyle, width: '100%', marginTop: 4 }}>
                    <option value="">+ agregar respuesta rápida…</option>
                    {respuestas.map(x => <option key={x.id} value={x.id}>{resumenRespuesta(x)}</option>)}
                  </select>

                  <div style={{ fontSize: 11, color: '#64748b', margin: '12px 0 6px' }}>Pregunta final con botones (opcional):</div>
                  <textarea value={r.pregunta?.texto || ''} rows={2} placeholder="Ej. ¿Cuál te gustó?"
                    onChange={e => editarReceta(r.id, { pregunta: { ...(r.pregunta || { botones: [] }), texto: e.target.value } })} style={inputTxt} />
                  {[0, 1, 2].map(i => (
                    <input key={i} value={r.pregunta?.botones?.[i]?.title || ''} maxLength={20} placeholder={`Botón ${i + 1} (máx 20)`}
                      onChange={e => {
                        const botones = [0, 1, 2].map(k => ({ title: k === i ? e.target.value.slice(0, 20) : (r.pregunta?.botones?.[k]?.title || '') }))
                        editarReceta(r.id, { pregunta: { ...(r.pregunta || {}), texto: r.pregunta?.texto || '', botones } })
                      }}
                      style={{ ...selectStyle, width: 'calc(33% - 4px)', marginRight: i < 2 ? 6 : 0, marginTop: 6 }} />
                  ))}
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
                ⚠️ Lo que el cliente toque en un botón entra al chat como texto y lo pone en PENDIENTES; ningún botón hace nada solo. Si el bot está contestando ese chat, la receta no se mete. Cuando aparece un anuncio nuevo te llega un aviso por Telegram.
              </div>
            </>)}
          </Card>
```

- [ ] **Step 4: Lint, build y revisión a ojo**

Run: `npm test` → 0 fallos (lint incluido). Run: `npx next build` → ok. Correr `npm run dev`, entrar a AUTOS con sesión, prender el global, crear una receta con 2 respuestas y 3 botones, asignarla al anuncio principal, "Guardar cambios", recargar y ver que persiste. Cambiar una etiqueta y recargar.

- [ ] **Step 5: Commit**

```bash
git add components/Automatizaciones.jsx
git commit -m "feat(recetas): tarjeta Bienvenida por anuncio en AUTOS (anuncios vistos, combo de receta, editor)"
```

---

### Task 8: Deploy, prueba real y documentación

**Files:**
- Create: `docs/HANDOFF-2026-09-14-recetas-bienvenida.md`
- Modify (memoria de Claude): `~/.claude/projects/C--Users-RodrigoWork/memory/MEMORY.md` + archivo nuevo

- [ ] **Step 1: Push y confirmar deploy**

```bash
git push origin main && git status -sb
```
Con `mcp__claude_ai_Vercel__list_deployments` (projectId `prj_YrOUJA8k8sYEFtbjEt9DDWld816h`, teamId `team_Sk65ztrHF0ybuWBRPQoS0hzp`, `since` = ahora − 5 min) ver el deployment con el `githubCommitSha` del último commit en `READY`.

- [ ] **Step 2: Control negativo en producción**

```bash
curl -s -w "\nHTTP %{http_code}\n" https://inbox.apps.mandarinaec.com/api/anuncios
```
Esperado: 401 o redirección al login (NO una lista). Si devuelve `{ok:true,...}` sin sesión, la ruta quedó pública: parar y revisar `lib/rutas-publicas.js`.

- [ ] **Step 3: Prueba real (la hace Rodrigo, guiada)**

1. En AUTOS: crear receta "Prueba" con el saludo + 1 respuesta con fotos + pregunta "¿Te ayudo?" con botones "Sí" / "Después". Asignarla a **Orgánico**. Prender el global. Guardar.
2. Desde un número que NUNCA haya escrito a MANDI, mandar "hola" al número principal.
3. Esperado en el celular: las piezas en orden, la pregunta con los dos botones al final, todo en menos de un minuto. En el inbox: el chat en PENDIENTES con todo el paquete en el hilo.
4. Tocar "Sí": llega al inbox como texto "Sí", el chat sigue en PENDIENTES.
5. Volver a escribir "hola" desde el mismo número: NO sale el paquete otra vez (tope 24h).
6. Quitar la asignación de Orgánico. Guardar.

Control en la base:
```sql
select telefono, ultima_receta_at from inbox.conversaciones where cuenta='MANDI' and ultima_receta_at is not null order by 2 desc limit 5;
select source_id, etiqueta, titular, visto_en, avisado_at from inbox.anuncios where cuenta='MANDI' and visto_en is not null order by visto_en desc limit 5;
```

- [ ] **Step 4: Handoff**

Crear `docs/HANDOFF-2026-09-14-recetas-bienvenida.md` con: qué se construyó (enlace a la spec), cómo se configura, los dos controles SQL de arriba, lo que NO se portó a IND todavía y la lista de archivos tocados. Máximo una página.

- [ ] **Step 5: Commit + memoria**

```bash
git add docs/HANDOFF-2026-09-14-recetas-bienvenida.md
git commit -m "docs: handoff recetas de bienvenida por anuncio"
git push origin main
```
Guardar en la memoria de Claude un archivo `inbox-recetas-bienvenida.md` (tipo project) con: estado (MANDI en producción / IND pendiente), la regla "sin receta no sale nada", la guardia de reentrega, y el enlace al handoff. Agregar la línea al índice `MEMORY.md`.

---

## Self-review (hecho al escribir el plan)

- **Cobertura de la spec:** §3.1 → Task 2 · §3.2 → Task 1 · §4 → Tasks 3, 4, 6 · §5 → Tasks 3, 6 · §6 → Tasks 5, 7 · §7 → cada task · §8 riesgos: reentrega (Task 4 guardia + Task 6 orden), bot (Task 3), saludo (Task 6), orden (Task 6 await por pieza), ruta caliente (Task 6: `respuestasRapidas` se lee una vez por ciclo y solo si hay receta), respuesta borrada (Task 3 + Task 7 en rojo) · §9 → Task 8.
- **Tipos:** `contacto.ultimaRecetaAt` (Task 4) es lo que lee `decidirReceta` (Task 3); `piezasDeReceta` devuelve cuerpos que `enviarSaliente` manda tal cual (Task 6); `por_anuncio.organico` (Task 2/3) es la clave que la pantalla escribe con `source_id: 'organico'` (Task 7); `getAnuncios()` devuelve `{ ok, anuncios }` (Task 5) y la pantalla lee `a?.anuncios` (Task 7).
- **IND:** fuera de este plan a propósito; el mismo código se porta después (paleta `C`, `cabecerasMaquina` en vez de `enviarSaliente`, `tests/rutas-publicas.test.js` de IND).
