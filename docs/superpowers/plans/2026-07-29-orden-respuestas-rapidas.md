# Orden de las respuestas rápidas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las respuestas rápidas tengan un orden estable, que se pueda cambiar con flechas ↑↓ (y arrastrando en computadora), y que una respuesta nueva entre primera.

**Architecture:** Una columna `orden` en la tabla compartida `inbox.respuestas_rapidas`. La lectura ordena por ella. Al reordenar, el navegador manda la lista completa de ids y el servidor escribe `orden = 0,1,2…`. La lógica de mover un elemento dentro de una lista se extrae a un módulo puro para poder probarla. Crear y editar se separan: crear calcula el orden, editar no lo toca.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (Postgres), `node:test` + `node:assert`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-orden-respuestas-rapidas-design.md` (en el repo de MANDI). Ante duda, manda el spec.
- **Dos repos:** `C:\Users\RodrigoWork\Desktop\wa-inbox-next` (MANDI, proyecto Vercel `wa-inbox-v2`) y `C:\Users\RodrigoWork\Desktop\ind-inbox-next` (IND, proyecto `ind-inbox-v2`). Las carpetas no se llaman como los proyectos.
- **Producción = `main`** en los dos. Sin ramas.
- **La tabla es COMPARTIDA.** La migración se aplica UNA vez y sirve a los dos.
- **La migración va ANTES del código.** Si el código pidiera `order by orden` sin la columna, la pestaña de respuestas dejaría de cargar en los dos inbox a la vez.
- **Editar NO cambia el orden.** Es el fallo más probable de este trabajo: hoy `editRespuestaSupabase` *es* `addRespuestaSupabase`.
- Lectura: `.order('orden', { ascending: true }).order('fecha', { ascending: false })` — el desempate va **descendente** para no contradecir "lo nuevo va arriba".
- Comentarios y textos de interfaz en **español**; mensajes de commit en español **sin tildes**.
- Baseline de pruebas: **MANDI 72**, **IND 37**. Correrlas antes de cada commit.

---

### Task 1: La migración (se aplica UNA vez, sirve a los dos inbox)

**Files:**
- Create: `docs/sql/2026-07-29-respuestas-orden.sql` (en el repo de MANDI, como registro)

**Interfaces:**
- Produces: la columna `inbox.respuestas_rapidas.orden` (integer, nullable), rellenada.

- [ ] **Step 1: Ver el estado de partida**

Ejecutar contra el proyecto Supabase `piingkecjgoisnxccvaa`:

```sql
select cuenta, count(*) as filas
from inbox.respuestas_rapidas group by cuenta order by 1;
```

Expected: `IND 11`, `MANDI 13`. Si los números difieren mucho, **parar y avisar**: alguien cambió las respuestas mientras tanto y hay que revisar antes de renumerar.

- [ ] **Step 2: Añadir la columna y rellenarla**

```sql
-- Orden de las respuestas rapidas. Nullable y aditiva a proposito: el codigo que
-- todavia no conoce esta columna la ignora, asi que la migracion puede ir ANTES
-- de los despliegues sin romper nada.
alter table inbox.respuestas_rapidas add column if not exists orden integer;

-- Las que ya existen se numeran de la MAS NUEVA a la mas vieja, por coherencia:
-- de aqui en adelante una respuesta nueva entra primera.
with numeradas as (
  select cuenta, id,
         row_number() over (partition by cuenta order by fecha desc) - 1 as n
  from inbox.respuestas_rapidas
)
update inbox.respuestas_rapidas r
set orden = numeradas.n
from numeradas
where r.cuenta = numeradas.cuenta
  and r.id = numeradas.id
  and r.orden is null;
```

- [ ] **Step 3: Verificar que quedó bien**

```sql
select cuenta,
       count(*) as filas,
       count(orden) as con_orden,
       min(orden) as menor,
       max(orden) as mayor,
       count(distinct orden) as ordenes_distintos
from inbox.respuestas_rapidas group by cuenta order by 1;
```

Expected por cuenta: `con_orden = filas`, `menor = 0`, `mayor = filas - 1`, y
`ordenes_distintos = filas` (sin empates). Si hubiera empates, la renumeración falló.

- [ ] **Step 4: Comprobar que los inbox EN PRODUCCIÓN siguen funcionando**

Abrir el inbox de MANDI y el de IND (ambos con el código viejo todavía) y confirmar que la pestaña **Respuestas** sigue cargando y enviando. La columna es aditiva; esto verifica que de verdad lo es.

- [ ] **Step 5: Guardar el SQL en el repo y commit**

Crear `docs/sql/2026-07-29-respuestas-orden.sql` con el SQL del Step 2 tal cual.

```bash
git add docs/sql/2026-07-29-respuestas-orden.sql
git commit -m "chore(sql): columna orden en respuestas_rapidas

Aditiva y nullable a proposito: el codigo que aun no la conoce la ignora, asi que
la migracion puede aplicarse ANTES de desplegar los dos inbox. La tabla es
COMPARTIDA por MANDI e IND, asi que esta migracion es una sola.

Las filas existentes se numeran de la mas nueva a la mas vieja, por coherencia con
que una respuesta nueva entre primera.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Módulo puro para mover un elemento de la lista (MANDI)

Lo usan tanto las flechas como el arrastre. Se extrae para poder probarlo: es la única parte de este trabajo con lógica de verdad.

**Files:**
- Create: `lib/orden-lista.js`
- Test: `tests/orden-lista.test.js`

**Interfaces:**
- Produces: `moverItem(lista, desde, hacia) → Array` — devuelve una lista NUEVA, no muta la original.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/orden-lista.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { moverItem } from '../lib/orden-lista.js'

test('baja un elemento una posicion', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'])
})

test('sube un elemento una posicion', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b'])
})

test('mover a una posicion lejana reordena bien', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c', 'd'], 0, 3), ['b', 'c', 'd', 'a'])
})

test('subir el primero o bajar el ultimo no cambia nada', () => {
  assert.deepEqual(moverItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'])
  assert.deepEqual(moverItem(['a', 'b', 'c'], 2, 3), ['a', 'b', 'c'])
})

test('no muta la lista original', () => {
  const original = ['a', 'b', 'c']
  moverItem(original, 0, 2)
  assert.deepEqual(original, ['a', 'b', 'c'])
})

test('tolera entradas invalidas sin lanzar', () => {
  assert.deepEqual(moverItem(null, 0, 1), [])
  assert.deepEqual(moverItem(['a'], 5, 0), ['a'])
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/orden-lista.js'`

- [ ] **Step 3: Escribir el módulo**

Crear `lib/orden-lista.js`:

```js
// lib/orden-lista.js — Mover un elemento dentro de una lista.
//
// Lo usan las flechas ↑↓ y el arrastre, que son la misma operación con distinto
// gesto. Vive aparte y es puro para poder probarlo: es la única lógica de verdad
// del reordenamiento (el resto es escribir en la base y pintar).
//
// Devuelve una lista NUEVA. No muta la que recibe, porque el que llama guarda la
// anterior para poder revertir si el guardado falla.

/**
 * @param {Array} lista
 * @param {number} desde  índice actual del elemento
 * @param {number} hacia  índice destino. Se recorta a los límites de la lista, así
 *                        que "subir el primero" o "bajar el último" no hacen nada.
 * @returns {Array} lista nueva
 */
export function moverItem(lista, desde, hacia) {
  if (!Array.isArray(lista)) return []
  const n = lista.length
  const copia = [...lista]
  if (!Number.isInteger(desde) || desde < 0 || desde >= n) return copia
  const destino = Math.max(0, Math.min(n - 1, hacia))
  if (destino === desde) return copia
  const [item] = copia.splice(desde, 1)
  copia.splice(destino, 0, item)
  return copia
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS — **78** pruebas (72 previas + 6 nuevas), 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add lib/orden-lista.js tests/orden-lista.test.js
git commit -m "feat(respuestas): modulo puro para mover un elemento de la lista

Lo van a usar las flechas y el arrastre, que son la misma operacion con distinto
gesto. Se extrae para poder PROBARLO: es la unica logica de verdad del
reordenamiento, el resto es escribir en la base y pintar.

Devuelve una lista nueva sin mutar la recibida, porque quien llama guarda la
anterior para revertir si el guardado falla. Subir el primero o bajar el ultimo
no hacen nada (el destino se recorta a los limites).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backend de MANDI — leer ordenado, crear primera, editar sin mover, reordenar

**Files:**
- Modify: `lib/inbox-supabase.js` (`getRespuestasSupabase`, `addRespuestaSupabase`, `editRespuestaSupabase`; función nueva)
- Modify: `lib/respuestas.js` (exportar la nueva)
- Modify: `app/api/respuestas/route.js` (acción nueva)
- Modify: `lib/api-client.js` (función nueva para el navegador)

**Interfaces:**
- Produces:
  - `reordenarRespuestasSupabase(ids) → { ok, actualizadas }` (en `lib/inbox-supabase.js`)
  - `reordenarRespuestas(ids)` (en `lib/respuestas.js`)
  - `accion: 'reordenar'` con `{ ids: [...] }` en `POST /api/respuestas`
  - `reorderReplies(ids) → { ok }` (en `lib/api-client.js`, para el navegador)

- [ ] **Step 1: Leer ordenado**

En `lib/inbox-supabase.js`, `getRespuestasSupabase` hoy es:

```js
  const { data, error } = await sb
    .from('respuestas_rapidas').select('*').eq('cuenta', CUENTA).eq('activo', true)
```

Cambiar la consulta por:

```js
  // Orden explícito: antes no había ninguno y el resultado era el que Postgres
  // devolvía por casualidad, que podía cambiar solo entre recargas. El desempate
  // por fecha va DESCENDENTE para no contradecir que lo nuevo entra arriba.
  const { data, error } = await sb
    .from('respuestas_rapidas').select('*').eq('cuenta', CUENTA).eq('activo', true)
    .order('orden', { ascending: true })
    .order('fecha', { ascending: false })
```

- [ ] **Step 2: Separar crear de editar**

Reemplazar `addRespuestaSupabase` y `editRespuestaSupabase` por:

```js
export async function addRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  const sb = getSupabase()
  const fila = {
    cuenta: CUENTA, id, texto,
    imagenes: imgsFromExtras(imagenUrl, extras),
    botones: botonesFrom(extras),
    activo: true,
  }
  // Una respuesta NUEVA entra PRIMERA: el orden menor que exista, menos uno. Puede
  // quedar negativo y da igual, solo se usa para ordenar; el primer reordenamiento
  // manual renumera desde 0.
  //
  // Si la fila YA existe no se toca el orden. Sin esta comprobación, editar el texto
  // mandaría la respuesta arriba: corriges una tilde y se te desordena la lista.
  const { data: existe } = await sb
    .from('respuestas_rapidas').select('id')
    .eq('cuenta', CUENTA).eq('id', id).maybeSingle()
  if (!existe) {
    const { data: menor } = await sb
      .from('respuestas_rapidas').select('orden').eq('cuenta', CUENTA)
      .order('orden', { ascending: true }).limit(1).maybeSingle()
    fila.orden = (Number.isFinite(menor?.orden) ? menor.orden : 0) - 1
  }
  const { error } = await sb.from('respuestas_rapidas')
    .upsert(fila, { onConflict: 'cuenta,id' })
  if (error) throw error
  return { ok: true }
}

// Editar NO reordena. Escribe los campos de contenido y deja `orden` como estaba.
export async function editRespuestaSupabase(id, texto, imagenUrl, extras = {}) {
  const sb = getSupabase()
  const { error } = await sb.from('respuestas_rapidas').update({
    texto,
    imagenes: imgsFromExtras(imagenUrl, extras),
    botones: botonesFrom(extras),
    activo: true,
  }).eq('cuenta', CUENTA).eq('id', id)
  if (error) throw error
  return { ok: true }
}
```

- [ ] **Step 3: Añadir la función que reordena**

Junto a `deleteRespuestaSupabase`, en `lib/inbox-supabase.js`:

```js
/**
 * Reescribe el orden completo: `ids` en su nuevo orden → orden = 0,1,2…
 * Se manda la lista entera (y no "intercambia estas dos") a propósito: así no
 * quedan huecos ni empates, que es lo que volvía impredecible el orden. Con una
 * docena de filas el coste es irrelevante, y repetir la misma llamada deja lo mismo.
 */
export async function reordenarRespuestasSupabase(ids) {
  const sb = getSupabase()
  const lista = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean)
  if (!lista.length) return { ok: true, actualizadas: 0 }
  for (let i = 0; i < lista.length; i++) {
    const { error } = await sb.from('respuestas_rapidas')
      .update({ orden: i }).eq('cuenta', CUENTA).eq('id', lista[i])
    if (error) throw error
  }
  return { ok: true, actualizadas: lista.length }
}
```

- [ ] **Step 4: Exponerla en el dispatcher**

En `lib/respuestas.js`, junto a `deleteRespuesta`:

```js
export async function reordenarRespuestas(ids) {
  return SB.reordenarRespuestasSupabase(ids)
}
```

- [ ] **Step 5: Añadir la acción en la ruta**

En `app/api/respuestas/route.js`: añadir `reordenarRespuestas` al import de `@/lib/respuestas`, sacar `ids` del cuerpo, y añadir la rama antes del `else` de acción desconocida:

```js
    const { accion, id, texto, imagenUrl, ids, ...extras } = await req.json()
```

```js
    } else if (accion === 'reordenar') {
      await reordenarRespuestas(ids)
```

- [ ] **Step 6: Añadir la llamada del navegador**

En `lib/api-client.js`, junto a `writeReply`:

```js
/** Guarda el orden completo de las respuestas rápidas. `ids` en su nuevo orden. */
export async function reorderReplies(ids) {
  try {
    const res = await fetch('/api/respuestas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'reordenar', ids }),
    })
    return { ok: res.ok }
  } catch (err) {
    console.error('[api-client] reorderReplies:', err)
    return { ok: false }
  }
}
```

- [ ] **Step 7: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: **78** pruebas en verde y build limpio.

- [ ] **Step 8: Comprobar contra la base que editar NO mueve**

Con `npm run dev`, abrir la pestaña Respuestas, **editar el texto** de una respuesta que NO sea la primera, guardar, y consultar:

```sql
select id, orden, left(texto, 30) as texto
from inbox.respuestas_rapidas where cuenta = 'MANDI' order by orden;
```

Expected: la respuesta editada conserva **el mismo `orden`** que tenía. Si saltó a la primera posición, el Step 2 está mal y hay que pararse aquí.

- [ ] **Step 9: Commit**

```bash
git add lib/inbox-supabase.js lib/respuestas.js app/api/respuestas/route.js lib/api-client.js
git commit -m "feat(respuestas): orden estable, crear entra primera, editar no mueve

getRespuestasSupabase leia SIN order by: el orden visible era el que Postgres
devolvia por casualidad y podia cambiar solo entre recargas. Ahora ordena por la
columna `orden`, con la fecha DESCENDENTE como desempate para no contradecir que
lo nuevo va arriba.

Crear entra primera (orden = el menor que exista, menos uno). Y editar deja de ser
un alias de crear: eran la misma funcion via upsert, asi que sin separarlas cada
edicion mandaria la respuesta al principio -corriges una tilde y se desordena la
lista-.

Al reordenar se manda la lista COMPLETA y se escribe orden = 0,1,2... En vez de
'intercambia estas dos': menos escritura, pero deja huecos y empates que
reproducen el problema que esto viene a arreglar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Interfaz de MANDI — flechas, arrastre y que la nueva salga arriba

**Files:**
- Modify: `components/RightPanel.jsx`

**Interfaces:**
- Consumes: `moverItem(lista, desde, hacia)` de `lib/orden-lista.js` (Task 2) y `reorderReplies(ids)` de `lib/api-client.js` (Task 3).

- [ ] **Step 1: Imports y estado**

En `components/RightPanel.jsx`, añadir a los imports:

```js
import { moverItem } from '@/lib/orden-lista'
```

y `reorderReplies` al import que ya existe de `@/lib/api-client`.

Junto a `const [replies, setReplies] = useState([])` (línea ~253), añadir:

```js
  const [arrastrando, setArrastrando] = useState(null)   // índice que se está arrastrando
  const [errorOrden, setErrorOrden]   = useState('')     // aviso si el guardado falla
```

- [ ] **Step 2: El manejador que reordena y revierte si falla**

Junto a `deleteReply` (línea ~373), añadir:

```js
  // Reordena en pantalla YA y guarda detrás. Si el guardado falla, VUELVE al orden
  // anterior y avisa: una lista que se ve reordenada y no lo está en la base es
  // peor que no poder reordenar.
  const reordenar = async (desde, hacia) => {
    const previa = replies
    const nueva = moverItem(previa, desde, hacia)
    if (nueva.length !== previa.length) return
    if (nueva.every((r, i) => r === previa[i])) return   // no cambió nada
    setReplies(nueva)
    setErrorOrden('')
    const r = await reorderReplies(nueva.map(x => x.id))
    if (!r?.ok) {
      setReplies(previa)
      setErrorOrden('No se pudo guardar el orden. Reintenta.')
      setTimeout(() => setErrorOrden(''), 4000)
    }
  }
```

- [ ] **Step 3: Que una respuesta nueva salga arriba**

En la línea ~382 hoy dice:

```js
    setReplies(prev => [...prev, newReply])
```

Cambiar por:

```js
    setReplies(prev => [newReply, ...prev])   // la nueva entra PRIMERA, igual que en la base
```

- [ ] **Step 4: Las flechas**

En la fila de botones de cada respuesta (la que tiene `▶ Enviar`, `✏️` y `🗑`, línea ~576-579), **antes** del botón de Enviar, añadir:

```jsx
                          <button onClick={() => reordenar(idx, idx - 1)} disabled={idx === 0}
                            title="Subir"
                            style={{ background:'transparent', border:'1px solid #1e2d3d', color: idx === 0 ? '#334155' : '#64748b', borderRadius:5, padding:'3px 5px', fontSize:10, cursor: idx === 0 ? 'default' : 'pointer', fontFamily:'inherit' }}>↑</button>
                          <button onClick={() => reordenar(idx, idx + 1)} disabled={idx === replies.length - 1}
                            title="Bajar"
                            style={{ background:'transparent', border:'1px solid #1e2d3d', color: idx === replies.length - 1 ? '#334155' : '#64748b', borderRadius:5, padding:'3px 5px', fontSize:10, cursor: idx === replies.length - 1 ? 'default' : 'pointer', fontFamily:'inherit' }}>↓</button>
```

> Se dejan **visibles pero deshabilitadas** en los extremos, en gris apagado
> (`#334155`), en vez de desaparecer: si los botones se quitan, los de abajo se
> desplazan y el que quería subir la segunda acaba pulsando otra cosa.

- [ ] **Step 5: El arrastre (solo mouse)**

En el `<div>` de la caja de la respuesta (el que hoy empieza con
`style={{ background:'rgba(255,255,255,.02)', border:'1px solid #111c2a', borderRadius:8, overflow:'hidden'…`, línea ~558), añadir estas props:

```jsx
                      draggable
                      onDragStart={() => setArrastrando(idx)}
                      onDragEnd={() => setArrastrando(null)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => { if (arrastrando !== null && arrastrando !== idx) reordenar(arrastrando, idx); setArrastrando(null) }}
```

y en su `style`, añadir al final del objeto:

```jsx
                      opacity: arrastrando === idx ? .4 : 1,
                      outline: arrastrando !== null && arrastrando !== idx ? '1px dashed #2a3f55' : 'none',
```

> Se usa el arrastre nativo de HTML (`draggable`), y eso resuelve solo el problema
> del táctil: **los eventos `drag*` no se disparan con el dedo**. Así el arrastre
> queda para el mouse sin pelearse con el gesto de bajar la lista, y en el teléfono
> quedan las flechas. No hace falta ninguna librería ni detectar el dispositivo.

- [ ] **Step 6: El aviso de error**

Justo antes del cierre del contenedor de la lista de respuestas (después del `.map(...)`), añadir:

```jsx
              {errorOrden && (
                <div style={{ fontSize:11, color:'#ef4444', padding:'6px 8px' }}>⚠️ {errorOrden}</div>
              )}
```

- [ ] **Step 7: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: 78 pruebas en verde, build limpio.

- [ ] **Step 8: Probar en el navegador**

Con `npm run dev`, en la pestaña Respuestas:

1. Pulsar ↓ en la primera: baja una posición.
2. **Recargar la página**: sigue en su nueva posición (se guardó de verdad).
3. La primera tiene el ↑ apagado; la última, el ↓ apagado.
4. Arrastrar una caja a otra posición con el mouse: se queda donde se suelta.
5. Crear una respuesta nueva: aparece **arriba**.
6. Editar el texto de una del medio: **NO se mueve**.
7. Confirmar contra la base que la pantalla y `orden` coinciden:

```sql
select id, orden, left(texto, 30) as texto
from inbox.respuestas_rapidas where cuenta = 'MANDI' order by orden;
```

- [ ] **Step 9: Commit**

```bash
git add components/RightPanel.jsx
git commit -m "feat(respuestas): flechas y arrastre para ordenarlas, y la nueva entra arriba

Flechas en cada caja, visibles pero apagadas en los extremos: si se quitaran, los
botones de abajo se desplazan y el que queria subir la segunda pulsa otra cosa.

El arrastre usa el `draggable` nativo de HTML, y eso resuelve solo el problema del
tactil: los eventos drag* NO se disparan con el dedo. Asi el arraste queda para el
mouse sin pelearse con el gesto de bajar la lista -las respuestas viven en una
columna con scroll- y en el telefono quedan las flechas. Sin librerias y sin
detectar el dispositivo.

Si el guardado falla, la lista VUELVE al orden anterior y avisa: verse reordenada
sin estarlo en la base es peor que no poder reordenar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Backend de IND (porte de la Task 3)

**Files (en `C:\Users\RodrigoWork\Desktop\ind-inbox-next`):**
- Create: `lib/orden-lista.js`
- Test: `tests/orden-lista.test.js`
- Modify: `lib/inbox-supabase.js`, `lib/respuestas.js`, `app/api/respuestas/route.js`, `lib/api-client.js`

**Interfaces:** las mismas que las Tasks 2 y 3, con `CUENTA = 'IND'`.

- [ ] **Step 1: Comprobar que las piezas de IND se llaman igual**

Run, en el repo de IND:

```
grep -n "getRespuestasSupabase\|addRespuestaSupabase\|editRespuestaSupabase\|deleteRespuestaSupabase" lib/inbox-supabase.js
grep -n "accion" app/api/respuestas/route.js
grep -n "writeReply" lib/api-client.js
```

Expected: los mismos nombres que en MANDI. **Si alguno difiere, usa el de IND** y anótalo en el informe: IND ya demostró hoy que no es una copia de MANDI (tiene su propio interruptor maestro de IA, otros nombres de canal y un archivado de medios más completo). No asumas paridad.

- [ ] **Step 2: Copiar el módulo puro y su prueba**

Copiar `lib/orden-lista.js` y `tests/orden-lista.test.js` **tal cual** desde
`C:\Users\RodrigoWork\Desktop\wa-inbox-next`. No tienen nada específico de cuenta ni de canal.

- [ ] **Step 3: Aplicar los mismos cambios del backend**

El código es **byte a byte el mismo** que el de la Task 3 de **este mismo archivo de plan**: ábrela y cópialo de ahí. No hace falta adaptar nada, porque en ninguno de esos fragmentos aparece el nombre de la cuenta: usan la constante `CUENTA`, que en este repo ya vale `'IND'`.

Son los seis cambios de la Task 3, en este orden:

1. **Step 1 de la Task 3** — `getRespuestasSupabase`: añadir los dos `.order(...)`.
2. **Step 2 de la Task 3** — reemplazar `addRespuestaSupabase` y `editRespuestaSupabase` por las dos versiones separadas.
3. **Step 3 de la Task 3** — añadir `reordenarRespuestasSupabase`.
4. **Step 4 de la Task 3** — `reordenarRespuestas` en `lib/respuestas.js`.
5. **Step 5 de la Task 3** — la acción `'reordenar'` y el `ids` en `app/api/respuestas/route.js`.
6. **Step 6 de la Task 3** — `reorderReplies` en `lib/api-client.js`.

Si al abrir un archivo de IND el código de partida **no coincide** con lo que la Task 3 dice que hay que reemplazar, **para y avísalo** en lugar de forzarlo: significa que ese archivo de IND difiere del de MANDI y hay que decidir qué hacer.

- [ ] **Step 4: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: **43** pruebas en verde (37 previas + 6 del módulo nuevo) y build limpio.

- [ ] **Step 5: Comprobar contra la base que editar NO mueve**

Con `npm run dev`, editar el texto de una respuesta de IND que no sea la primera y consultar:

```sql
select id, orden, left(texto, 30) as texto
from inbox.respuestas_rapidas where cuenta = 'IND' order by orden;
```

Expected: conserva su `orden`.

- [ ] **Step 6: Commit**

```bash
git add lib/orden-lista.js tests/orden-lista.test.js lib/inbox-supabase.js lib/respuestas.js app/api/respuestas/route.js lib/api-client.js
git commit -m "feat(respuestas): orden estable en IND, crear entra primera, editar no mueve

Porte de lo que ya quedo revisado en el repo hermano. La tabla respuestas_rapidas
es COMPARTIDA, asi que la columna `orden` ya existe: esto solo la empieza a usar
desde IND.

Igual que alla: la lectura no tenia order by, crear entra primera (orden = el
menor menos uno) y editar deja de ser un alias de crear -si no, corregir una tilde
mandaria la respuesta al principio-.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Interfaz de IND (porte de la Task 4)

**Files (en el repo de IND):**
- Modify: `components/RightPanel.jsx`

**Interfaces:** las mismas que la Task 4.

- [ ] **Step 1: Comparar la estructura antes de tocar**

Abrir `components/RightPanel.jsx` de IND y el de MANDI y localizar en el de IND: el estado `replies`, `deleteReply`, la línea que añade una respuesta nueva, y la fila de botones con `✏️` y `🗑`.

Los estilos y los colores de IND **son distintos** (usa su propia paleta). Adapta los estilos a los que ya usa ese archivo en los botones vecinos, en vez de pegar los códigos de color de MANDI.

- [ ] **Step 2: Aplicar los mismos cambios de interfaz**

Repetir los Steps 1 a 6 de la Task 4 de este plan, con los estilos de IND.

- [ ] **Step 3: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: 43 pruebas en verde, build limpio.

- [ ] **Step 4: Probar en el navegador**

Los mismos 7 puntos del Step 8 de la Task 4, pero con `cuenta = 'IND'` en la consulta.

- [ ] **Step 5: Commit**

```bash
git add components/RightPanel.jsx
git commit -m "feat(respuestas): flechas y arrastre para ordenarlas en IND

Mismo comportamiento que el repo hermano, con los estilos de este panel. El
arrastre usa el `draggable` nativo, cuyos eventos no se disparan con el dedo: asi
no pelea con el scroll de la columna y en el telefono quedan las flechas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Despliegue y verificación

MANDI primero, IND después. La migración ya está aplicada (Task 1), así que ninguno de los dos puede pedir una columna que no existe.

**Files:** ninguno.

- [ ] **Step 1: Desplegar MANDI**

En `C:\Users\RodrigoWork\Desktop\wa-inbox-next`:

```bash
npm test && npm run build && git push origin main
```

- [ ] **Step 2: Verificar MANDI en producción**

Confirmar en Vercel que el último deployment con `target: "production"` del proyecto `wa-inbox-v2` tiene el SHA subido y está `READY`. Luego, en el inbox: la pestaña Respuestas carga, el orden es el esperado, y las flechas guardan (recargar y comprobar).

- [ ] **Step 3: Comprobar que IND no se rompió**

**Antes** de desplegar IND, abrir el inbox de IND (que todavía tiene el código viejo) y confirmar que su pestaña Respuestas **sigue cargando y enviando**. Los dos leen la misma tabla; esto verifica que el cambio de MANDI no afectó al otro.

- [ ] **Step 4: Desplegar IND**

En `C:\Users\RodrigoWork\Desktop\ind-inbox-next`:

```bash
npm test && npm run build && git push origin main
```

- [ ] **Step 5: Verificar IND en producción**

Igual que el Step 2, con el proyecto `ind-inbox-v2`.

- [ ] **Step 6: Comprobar que los dos ordenan independientemente**

Reordenar en MANDI y confirmar que el orden de IND **no cambió**, y al revés. Comparten tabla pero se filtran por `cuenta`:

```sql
select cuenta, id, orden from inbox.respuestas_rapidas order by cuenta, orden;
```

---

## Notas para el que ejecute

- **La migración va primero, siempre.** Si por cualquier razón se despliega código antes, la pestaña Respuestas deja de cargar en los dos inbox a la vez, y las respuestas rápidas son la herramienta con la que se vende.
- **No uses `git add -A` en estos repos.** Hay archivos sin commitear del dueño. Añade solo los archivos que nombra cada tarea.
- El orden es **uno por cuenta, compartido por todo el equipo**: el inbox no tiene sesión ni usuarios, así que no hay orden por persona. No intentes añadirlo.
- Si `moverItem` te parece de más para "subir y bajar": es lo único probable de este trabajo, y es lo que garantiza que arrastrar y las flechas se comporten igual.
