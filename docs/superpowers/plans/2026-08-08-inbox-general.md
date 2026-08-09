# INBOX GENERAL — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pestaña GENERAL cuya columna de contactos acumula los chats de MANDI y REPUBLIC en una sola cola, con una línea de color por canal debajo de cada contacto, y que al seleccionar uno arma automáticamente el canal por el que se responde.

**Architecture:** La columna deja de filtrarse por número; el hilo y el envío siguen atados a un canal, pero ese canal lo fija **la ficha del contacto** al seleccionarlo, no la pestaña. Es la regla que ya está escrita en `app/api/inbox-sync/route.js`: *el estado vive en la conversación (una por cliente), la lista se filtra por el canal del mensaje.* GENERAL simplemente pide la lista sin filtro.

**Tech Stack:** Next.js 14 (App Router), React sin librería de estado, Supabase (PostgREST), `node --test` para las pruebas unitarias.

## Global Constraints

- **Repo:** `wa-inbox-next` únicamente. REPUBLIC es un canal de MANDI; `ind-inbox-next` tiene sus propios canales y **no se toca en este plan**.
- **Rama `main` siempre.** No crear ramas: Preview no sirve porque Supabase solo está en Production.
- **Nunca se puede enviar con el canal en `null`.** `postSaliente` inyecta `Canal: getCanalActivo()`; si eso llega vacío, el mensaje sale por el número equivocado o no sale. Toda ruta que permita escribir debe tener el canal armado antes.
- **`node --test` no entiende el alias `@/`** (lo define `jsconfig.json`, solo lo usa el bundler de Next). Los `lib/` con prueba unitaria se importan entre sí con **ruta relativa**.
- **Convención de canal ya establecida:** `undefined` → canal principal (el default del parámetro); **`null` → todos los canales** (el default no se aplica y el `if (canal)` no filtra). Es exactamente como funciona hoy `getContactosSupabase`.
- **No tocar el webhook** (`app/api/webhook/route.js`) ni el cron. Este plan es solo de lectura y de interfaz.
- Comentarios y textos de la interfaz **en español ecuatoriano con tuteo** (`tú`, `puedes`, `dime`). Nada de voseo.
- Correr `npm test` completo antes de cada commit: la suite es rápida y es la red que tenemos.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `lib/canales.js` | Definición de canales. Se le agrega el id lógico `GENERAL` (→ `phoneId` nulo) y `colorDeCanal()`. | 1, 2 |
| `lib/inbox-supabase.js` | Lecturas. `getListaSupabase` y `getMensajesSupabase` dejan de filtrar cuando el canal es nulo. | 1 |
| `app/api/inbox-sync/route.js` | Traduce `?canal=todos` a `null`. | 1 |
| `lib/api-client.js` | `fetchInboxSync(todosLosCanales)` — la columna se pide sin filtro según la **pestaña**, no según el canal armado. | 1, 3 |
| `components/Components.jsx` | `ContactRow` pinta la línea de color del canal. | 2 |
| `components/App.jsx` | Arma el canal al seleccionar, pinta la pestaña GENERAL, aplica el orden. | 3, 4, 5 |
| `lib/orden-bandeja.js` | **Nuevo.** Función pura del orden de la columna (FIFO en Pendientes). | 5 |
| `tests/canales.test.js` | Ya existe; se le suman casos. | 1, 2 |
| `tests/orden-bandeja.test.js` | **Nuevo.** | 5 |

### Por qué este orden de tareas

La pestaña GENERAL es **lo último visible que se agrega** (Tarea 4), después de que seleccionar un contacto ya arma su canal (Tarea 3). Así no existe ni un commit intermedio en el que se pueda abrir un chat de REPUBLIC y responderle por MANDI. Las tareas 1 y 2 son invisibles para el usuario: la 1 habilita una consulta que nadie llama todavía, y la 2 pinta una línea que en las pestañas actuales sale siempre del color de esa pestaña.

---

### Task 1: Las lecturas aceptan "todos los canales"

**Files:**
- Modify: `lib/canales.js` (agregar `CANAL_GENERAL` y ajustar `phoneIdDeCanal`)
- Modify: `lib/inbox-supabase.js:222` (`getMensajesSupabase`) y `lib/inbox-supabase.js:264` (`getListaSupabase`)
- Modify: `app/api/inbox-sync/route.js:14`
- Modify: `lib/api-client.js:86` (`fetchInboxSync`)
- Test: `tests/canales.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `CANAL_GENERAL` (string `'GENERAL'`) y `phoneIdDeCanal('GENERAL') === null`, que usan las tareas 3 y 4.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar al final de `tests/canales.test.js`:

```js
test('el canal GENERAL no tiene phone_id: significa TODOS los numeros', () => {
  assert.equal(phoneIdDeCanal(CANAL_GENERAL), null)
})

test('un id desconocido sigue cayendo en el canal principal, no en GENERAL', () => {
  // Protege el comportamiento viejo: una pestaña en cache con un id que ya no
  // existe debe ver MANDI, nunca la lista acumulada de los dos numeros.
  assert.equal(phoneIdDeCanal('NO_EXISTE'), CANALES[0].phoneId)
  assert.notEqual(phoneIdDeCanal('NO_EXISTE'), null)
})
```

Y sumar `CANAL_GENERAL` al import que ya tiene el archivo arriba:

```js
import { CANALES, CANAL_GENERAL, phoneIdDeCanal, canalDePhoneId, wabaIdDePhoneId } from '../lib/canales.js'
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test`
Expected: FAIL — `CANAL_GENERAL` llega `undefined` y `phoneIdDeCanal(undefined)` devuelve el phoneId de MANDI, no `null`.

- [ ] **Step 3: Implementar en `lib/canales.js`**

Agregar la constante justo después de `export const CANAL_POR_DEFECTO`:

```js
/**
 * Pestaña que acumula TODOS los números en una sola columna.
 *
 * No es un canal más: no tiene número propio. Su phoneId es `null` a propósito,
 * porque `null` es la convención que ya usan las lecturas para decir "sin filtro"
 * (mira el `if (canal)` de getContactosSupabase). `undefined` NO sirve: los
 * parámetros con valor por defecto solo se rellenan con undefined, y el canal
 * terminaría siendo MANDI en silencio.
 */
export const CANAL_GENERAL = 'GENERAL'
```

Y reemplazar `phoneIdDeCanal` por:

```js
/**
 * id lógico → phone_id de Meta. Devuelve el principal si el id no existe.
 * GENERAL devuelve null = todos los números (ver CANAL_GENERAL).
 */
export function phoneIdDeCanal(id) {
  if (id === CANAL_GENERAL) return null
  const c = CANALES.find((x) => x.id === id)
  return (c || CANALES[0]).phoneId
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS — toda la suite en verde, incluidas las pruebas viejas de `canales.test.js`.

- [ ] **Step 5: Que el canal viaje con cada mensaje**

`getListaSupabase` ya pide `phone_id` en su `select`, pero `toMensaje` lo bota al mapear. Es la **segunda fuente** del canal, y la Tarea 3 la usa como respaldo para no armar nunca un canal equivocado. Agregar el campo al final de `toMensaje` en `lib/inbox-supabase.js`:

```js
    estadoEntrega:  m.estado_entrega || '', // read receipts: sent|delivered|read|failed
    // Número por el que entró/salió ESTE mensaje. La consulta ya lo traía y el
    // mapeo lo botaba. Es el respaldo del canal cuando la ficha del contacto
    // todavía no llegó (ver openConv): sin él, un chat nuevo se respondería por
    // el canal que estuviera armado antes.
    phoneId:        m.phone_id || '',
```

⚠️ `getMensajesSupabase` usa `select('*')`, así que ahí `phone_id` ya venía; `getHiloSupabase` usa `COLS_MSG`, que **no** lo incluye — y no hace falta, porque el hilo siempre es de un solo canal.

- [ ] **Step 6: Quitar el filtro de las dos lecturas**

En `lib/inbox-supabase.js`, `getMensajesSupabase` — sustituir la consulta por:

```js
export async function getMensajesSupabase(limite = 3000, canal = canalPorDefecto()) {
  const sb = getSupabase()
  let q = sb.from('mensajes').select('*').eq('cuenta', CUENTA)
  if (canal) q = q.eq('phone_id', canal)   // canal null → todos los números (pestaña GENERAL)
  const { data, error } = await q.order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || [])
    .reverse() // cronológico asc, como el tail de Sheets
    .map(toMensaje)
    .filter((m) => soloDigitos(m.telefono).length >= 9)
    .filter((m) => String(m.tipo).toLowerCase() !== 'system' && (String(m.mensaje).trim() || String(m.mediaUrl).trim() || String(m.mediaId).trim() || String(m.botones).trim()))
}
```

Y en `getListaSupabase`:

```js
export async function getListaSupabase(limite = 4000, canal = canalPorDefecto()) {
  const sb = getSupabase()
  let q = sb
    .from('ultimos_mensajes')
    .select('wa_message_id, telefono, nombre, tipo, texto, media_url, fecha, direccion, media_id, botones, estado_entrega, contexto_id, referral, phone_id')
    .eq('cuenta', CUENTA)
  if (canal) q = q.eq('phone_id', canal)   // canal null → todos los números (pestaña GENERAL)
  const { data, error } = await q.order('fecha', { ascending: false }).limit(limite)
  if (error) throw error
  return (data || []).map(toMensaje).filter(esPintable)
}
```

⚠️ **No tocar `getHiloSupabase`.** El hilo de un chat SÍ tiene que seguir filtrado: es lo que garantiza que veas la conversación de un solo número y no dos mezcladas.

- [ ] **Step 7: Traducir `?canal=todos` en la ruta**

En `app/api/inbox-sync/route.js`, reemplazar la línea del parámetro por:

```js
    // ?canal=<phone_id>. Cada bandeja pide la suya; sin parámetro, el número
    // principal (así una pestaña vieja en caché sigue viendo lo de siempre).
    // ?canal=todos es la pestaña GENERAL: null = sin filtro de número.
    const pedido = new URL(req.url).searchParams.get('canal') || undefined
    const canal = pedido === 'todos' ? null : pedido
```

El resto del handler no cambia: `getLista(canal)` y `getMensajes(canal)` ya reciben la variable con ese nombre.

- [ ] **Step 8: Mandar `todos` desde el cliente**

En `lib/api-client.js`, reemplazar `fetchInboxSync` por:

```js
export async function fetchInboxSync() {
  try {
    // Sin canal armado (pestaña GENERAL) se piden los dos números. El literal
    // 'todos' viaja explícito porque un `canal=` vacío lo lee la ruta como
    // "sin parámetro" y devolvería solo el número principal.
    const canal = CANAL_ACTIVO || 'todos'
    const res = await fetch(`/api/inbox-sync?canal=${canal}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()   // { lista, rows, contactos }
  } catch (err) {
    console.error('[api-client] fetchInboxSync:', err)
    return null
  }
}
```

- [ ] **Step 9: Correr la suite y comprobar a mano que nada cambió**

Run: `npm test`
Expected: PASS.

Run: `npm run dev` y abrir el inbox en MANDI y en REPUBLIC.
Expected: las dos pestañas se ven **exactamente igual que antes**. Todavía nadie pide `canal=todos`.

- [ ] **Step 10: Commit**

```bash
git add lib/canales.js lib/inbox-supabase.js app/api/inbox-sync/route.js lib/api-client.js tests/canales.test.js
git commit -F - <<'EOF'
feat(general): las lecturas de la columna aceptan "todos los canales"

Primera pieza de la pestaña INBOX GENERAL. getListaSupabase y
getMensajesSupabase dejan de filtrar por phone_id cuando el canal es null,
con el mismo `if (canal)` que getContactosSupabase ya usaba.

Todavia nadie llama esta ruta: las pestañas MANDI y REPUBLIC siguen
pidiendo su numero y se ven igual que antes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: La línea de color del canal en cada contacto

**Files:**
- Modify: `lib/canales.js` (agregar `colorDeCanal`)
- Modify: `components/Components.jsx` (`ContactRow`)
- Modify: `components/App.jsx:1629-1642` (pasarle el color a cada fila)
- Test: `tests/canales.test.js`

**Interfaces:**
- Consumes: `CANALES` y `canalDePhoneId(phoneId)` de `lib/canales.js`.
- Produces: `colorDeCanal(phoneId) → string` (hex del canal, o `''` si el phoneId no es de ninguno). `ContactRow` acepta la prop nueva `colorCanal` (string, por defecto `''`).

- [ ] **Step 1: Escribir la prueba que falla**

Agregar a `tests/canales.test.js`:

```js
test('colorDeCanal devuelve el color de cada numero', () => {
  assert.equal(colorDeCanal(CANALES[0].phoneId), CANALES[0].color)
  assert.equal(colorDeCanal(CANALES[1].phoneId), CANALES[1].color)
})

test('colorDeCanal tolera basura sin lanzar y sin inventar color', () => {
  // Un phone_id que no es nuestro no puede pintarse del color de MANDI: eso
  // seria la pantalla mintiendo sobre por donde sale la respuesta.
  assert.equal(colorDeCanal('999999999'), '')
  assert.equal(colorDeCanal(''), '')
  assert.equal(colorDeCanal(null), '')
  assert.equal(colorDeCanal(undefined), '')
})

test('colorDeCanal compara como texto: el phone_id puede llegar numerico', () => {
  assert.equal(colorDeCanal(Number(CANALES[0].phoneId)), CANALES[0].color)
})
```

Sumar `colorDeCanal` al import del archivo.

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `npm test`
Expected: FAIL — `colorDeCanal is not a function`.

- [ ] **Step 3: Implementar `colorDeCanal`**

Al final de `lib/canales.js`:

```js
/**
 * phone_id de Meta → color del canal, para pintarlo en la interfaz.
 *
 * Devuelve '' si el phone_id no es de ninguno de nuestros números. Mejor no
 * pintar nada que pintar el color equivocado: esa línea es lo que le dice al
 * vendedor por cuál número va a salir su respuesta.
 */
export function colorDeCanal(phoneId) {
  const c = canalDePhoneId(phoneId)
  return c?.color || ''
}
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Pintar la línea en `ContactRow`**

En `components/Components.jsx`, cambiar la firma:

```js
export function ContactRow({ conv, isActive, onClick, search = '', estado, modoIA, temp = '', alerta = false, msgSnippet = null, colorCanal = '' }) {
```

Y envolver el `<div>` que ya existe en un contenedor que le agrega la línea debajo. Reemplazar la apertura del componente (desde `return (` hasta el `>` que cierra el div de estilos) por:

```js
  return (
    <div>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '13px 16px', cursor: 'pointer', transition: 'all .12s',
          background: isActive
            ? 'rgba(37,211,102,.08)'
            : hovered ? 'rgba(255,255,255,.02)' : 'transparent',
          borderLeft: isActive ? '3px solid #25d366' : '3px solid transparent',
        }}
      >
```

Cerrar ese div interno donde hoy cierra, y justo antes del cierre del contenedor agregar la línea:

```js
      {colorCanal && (
        // Separador de canal: dice por cuál número va a salir la respuesta si
        // abres este chat. Va DEBAJO de la fila, a lo ancho, para que se lea de
        // reojo bajando la columna sin tener que enfocar cada contacto.
        <div style={{ height: 2, background: colorCanal, opacity: .55, margin: '0 16px' }} />
      )}
    </div>
  )
```

⚠️ La fila tiene dos ramas de contenido (`msgSnippet != null` y la normal). La línea va **fuera de las dos**, pegada al cierre del contenedor nuevo, para que se vea igual buscando y sin buscar.

- [ ] **Step 6: Pasarle el color desde `App.jsx`**

Reemplazar el import de `components/App.jsx` (línea 9). Va completo de una vez, con lo que necesitan también las tareas 3 y 4, para no volver a tocarlo:

```js
import { CANALES, CANAL_GENERAL, colorDeCanal, canalDePhoneId } from '@/lib/canales'
```

Agregar el helper **justo encima de `openConv`** (línea ~693). No junto a `getStatus`, que está más abajo: `openConv` lo va a usar en la Tarea 3, y aunque por cierre funcionaría igual, definir algo 200 líneas después de donde se lee se presta a que el siguiente lo mueva sin darse cuenta.

```js
  /**
   * Número por el que habla este contacto.
   *
   * ⚠️ ESTE ES EL ÚNICO LUGAR donde se decide el canal de una conversación. Lo
   * usan la línea de color de la fila Y el canal que se arma al abrir el chat
   * (openConv). Tienen que salir de acá los dos: si cada uno lo calculara por su
   * lado podrían discrepar, y entonces la línea diría un número mientras la
   * respuesta sale por el otro.
   *
   * La ficha del contacto es la fuente buena —es el mismo campo `phone_id` que
   * usa el cron para responder—. El último mensaje de la fila es el respaldo
   * para una conversación tan nueva que su ficha no llegó en el último sync.
   */
  const phoneIdDe = (tel) =>
    contacts[tel]?.phoneId || convs.find(c => c.telefono === tel)?.last?.phoneId || ''
```

Y en el `filtered.map(...)` de la columna, sumar la prop:

```js
                  colorCanal={colorDeCanal(phoneIdDe(conv.telefono))}
```

Se comprobó el 8-ago-2026 contra la base que el `phone_id` de la conversación apunta siempre al canal del último mensaje: 24 de 24 conversaciones que habían usado los dos números.

- [ ] **Step 7: Comprobar a mano**

Run: `npm run dev`
Expected: en la pestaña MANDI todas las filas llevan una línea verde debajo; en REPUBLIC, naranja. Un contacto sin `phoneId` (ninguno debería, pero puede pasar con datos viejos) simplemente no lleva línea, sin romperse.

- [ ] **Step 8: Commit**

```bash
git add lib/canales.js components/Components.jsx components/App.jsx tests/canales.test.js
git commit -F - <<'EOF'
feat(general): linea de color del canal debajo de cada contacto

El color sale del phone_id de la FICHA del contacto, que es el mismo campo
que usa el envio. Asi lo que ves pintado es literalmente por donde va a
salir la respuesta, no un dato paralelo que puede desincronizarse.

Un phone_id desconocido no pinta nada, en vez de caer en el color de MANDI.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Seleccionar un contacto arma su canal

**Files:**
- Modify: `components/App.jsx:693` (`openConv`)
- Modify: `components/App.jsx` (estado nuevo `canalArmado`)

**Interfaces:**
- Consumes: `colorDeCanal`, `CANAL_GENERAL` (Tareas 1 y 2), `canalDePhoneId` de `lib/canales.js`, `setCanalActivo` de `lib/api-client.js`.
- Produces: estado `canalArmado` (string con el id lógico del canal, `''` si ninguno), que la Tarea 4 usa para encender la pestaña.

Esta es la tarea que hace segura la pestaña GENERAL. Hasta acá nada la expone; después de acá, abrir un chat deja el canal correcto armado **antes** de que se cargue el hilo o se pueda escribir.

- [ ] **Step 1: Agregar el estado del canal armado**

En `components/App.jsx`, junto a los demás `useState` de la parte de arriba del componente:

```js
  // Canal por el que se va a responder AHORA MISMO. En las pestañas MANDI y
  // REPUBLIC es la pestaña misma; en GENERAL lo fija el contacto que abres.
  // '' = ninguno armado todavía (GENERAL recién abierta, sin chat elegido).
  const [canalArmado, setCanalArmado] = useState(CANAL_POR_DEFECTO_ID)
```

Y arriba del componente, la constante:

```js
const CANAL_POR_DEFECTO_ID = CANALES[0].id
```

- [ ] **Step 2: Armar el canal dentro de `openConv`**

Reemplazar el comienzo de `openConv` por:

```js
  const openConv = (telefono) => {
    // Único paso obligado para cambiar de chat: lo usan la lista, CONTACTOS y el
    // salto desde un aviso push. Con esto acá, los tres quedan cubiertos.
    if (!puedoDejarLaConversacion(telefono)) return

    // ⚠️ ORDEN CRÍTICO: armar el canal ANTES de tocar `active`. El hilo se pide
    // con `CANAL_ACTIVO` (fetchHilo) y el envío inyecta `Canal: getCanalActivo()`
    // (postSaliente). Si esto corriera después, el primer hilo se pediría por el
    // canal anterior y una respuesta rápida saldría por el número equivocado.
    // `phoneIdDe` es el MISMO helper que pinta la línea de color de la fila
    // (Tarea 2). Tiene que ser el mismo: si el color y el canal armado se
    // calcularan por separado podrían discrepar, y la línea diría un número
    // mientras la respuesta sale por el otro.
    const canal = canalDePhoneId(phoneIdDe(telefono))
    if (canal && canal.id !== canalArmado) {
      setCanalActivo(canal.id)
      setCanalArmado(canal.id)
      // Los hilos cacheados NO se botan: `hilosRef` está indexado por teléfono, y
      // cada conversación pertenece a un solo canal (comprobado contra la base el
      // 8-ago-2026). Botarlos acá haría que GENERAL recargue todo a cada clic.
    }

    setActive(telefono)
    activeRef.current = telefono
    setShowSidebar(false)
```

El resto de `openConv` queda igual.

- [ ] **Step 3: No dejar que GENERAL quede sin canal armado**

En `cambiarLinea`, agregar la rama de GENERAL antes del `setLinea(id)` final:

```js
    } else if (id === CANAL_GENERAL) {
      // GENERAL no tiene número propio: la columna se pide sin filtro, pero el
      // canal armado se conserva para que el chat abierto siga respondiendo por
      // donde corresponde. Si no había ninguno, queda el principal — nunca null,
      // porque un envío con `Canal` vacío sale por el número equivocado.
      setCanalActivo(canalArmado || CANAL_POR_DEFECTO_ID)
    }
```

⚠️ Ojo con la asimetría: la **columna** de GENERAL se pide sin filtro porque `fetchInboxSync` manda `todos` cuando `CANAL_ACTIVO` es nulo… pero acá nunca lo dejamos nulo. Ver el Step 4.

- [ ] **Step 4: Hacer que la columna de GENERAL pida los dos números**

`fetchInboxSync` decide por `CANAL_ACTIVO`, que ahora siempre tiene valor. La columna tiene que decidir por la **pestaña**, no por el canal armado. Cambiar la firma en `lib/api-client.js`:

```js
export async function fetchInboxSync(todosLosCanales = false) {
  try {
    // La COLUMNA se pide sin filtro en la pestaña GENERAL. El canal activo NO
    // sirve para decidirlo: en GENERAL siempre hay uno armado (el del chat
    // abierto) y la columna igual tiene que traer los dos números.
    const canal = todosLosCanales ? 'todos' : CANAL_ACTIVO
    const res = await fetch(`/api/inbox-sync?canal=${canal}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()   // { lista, rows, contactos }
  } catch (err) {
    console.error('[api-client] fetchInboxSync:', err)
    return null
  }
}
```

En `components/App.jsx`, `load` es un `useCallback(async () => { … }, [])` con **dependencias vacías** (línea 270, cierra en la 335). Leer `linea` adentro lo dejaría congelado en el valor del primer render, y meterlo en las dependencias recrearía `load` en cada cambio de pestaña, reiniciando el polling.

Se resuelve con una ref, que es el idioma que este archivo ya usa (`activeRef`). Agregar junto a los demás refs:

```js
  // `load` es un useCallback con dependencias vacías: no puede leer `linea`
  // directo (quedaría congelado en el primer render) y meterlo en las
  // dependencias recrearía la función en cada cambio de pestaña, reiniciando el
  // polling. La ref le da el valor de ahora sin recrear nada.
  const lineaRef = useRef(linea)
  useEffect(() => { lineaRef.current = linea }, [linea])
```

Y dentro de `load`, cambiar la primera línea del cuerpo:

```js
    const sync   = await fetchInboxSync(lineaRef.current === CANAL_GENERAL)
```

- [ ] **Step 5: Comprobar a mano que las pestañas viejas no cambiaron**

Run: `npm run dev`
Expected: MANDI y REPUBLIC siguen mostrando solo su número. Abrir un chat en cada una y mandar un mensaje de prueba **a tu propio celular**: llega por el número correcto. La pestaña GENERAL todavía no existe.

- [ ] **Step 6: Correr la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/App.jsx lib/api-client.js
git commit -F - <<'EOF'
feat(general): abrir un chat arma el canal de ese contacto

Prepara la pestaña GENERAL, que todavia no existe. openConv fija el canal
ANTES de cambiar el chat activo, porque el hilo se pide con CANAL_ACTIVO y
el envio inyecta Canal desde ahi: al reves, el primer hilo saldria por el
canal anterior.

El canal armado nunca queda vacio: un envio con Canal nulo sale por el
numero equivocado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: La pestaña INBOX GENERAL en la cabecera

**Files:**
- Modify: `components/App.jsx:1486-1496` (arreglo de pestañas)
- Modify: `components/App.jsx:672-691` (`cambiarLinea`, reconocer GENERAL como pestaña de chat)

**Interfaces:**
- Consumes: `CANAL_GENERAL`, `canalArmado` (Tarea 3), `CANALES`.
- Produces: la pestaña visible. Nada más consume esto.

- [ ] **Step 1: Agregar la pestaña al arreglo**

En `components/App.jsx`, dentro del arreglo que se mapea a botones, **antes** del `...CANALES.map(...)`:

```js
            // GENERAL va primero: es la cola de trabajo, la que se mira todo el
            // día. Su contador suma los pendientes de todos los números.
            {
              id: CANAL_GENERAL, label:'GENERAL', icon:'📥', color:'#a78bfa', sub:'Los dos',
              badge: Object.values(pendientes).reduce((a, b) => a + (b || 0), 0),
              title:'Todos los números en una sola cola',
            },
```

- [ ] **Step 2: Marcar cuál canal está armado**

Dentro del mismo `.map(...)`, en el `...CANALES.map(c => ({...}))`, agregar el punto:

```js
            ...CANALES.map(c => ({
              id: c.id, label: c.etiqueta, icon:'💬', color: c.color, sub: c.sub,
              badge: pendientes[c.phoneId] || 0, title: c.titulo,
              // Encendido cuando estás en GENERAL y el chat abierto es de este
              // número: la pestaña deja de ser "dónde estoy" y pasa a ser
              // "por acá sale lo que escribas".
              armado: linea === CANAL_GENERAL && canalArmado === c.id,
            })),
```

Ampliar la desestructuración del map de botones:

```js
          ].map(({ id, label, icon, color, sub, badge = 0, title, armado = false }) => (
```

Y en el `<button>`, cambiar el `borderBottom` para que también responda al armado:

```js
              borderBottom: linea===id ? `2px solid ${color}`
                          : armado     ? `2px dashed ${color}`
                          :              '2px solid transparent',
```

Y sumar el punto junto a la etiqueta, dentro del `<span>{icon} {label}</span>`:

```js
                <span>{icon} {label}{armado ? ' ◉' : ''}</span>
```

⚠️ El punto y la línea punteada tienen que ser **distintos** de la pestaña activa (línea sólida): son dos cosas distintas —dónde estás parado y por dónde respondes— y si se ven igual el aviso deja de servir.

- [ ] **Step 3: Que `cambiarLinea` trate GENERAL como pestaña de chat**

En `cambiarLinea`, reemplazar las dos constantes por:

```js
    const esChat = (x) => x === CANAL_GENERAL || CANALES.some(c => c.id === x)
    const eraChat = esChat(linea)
    const vaAChat = esChat(id)
```

Y en la rama que limpia todo al saltar entre números, excluir GENERAL del borrado del canal activo (ya lo cubre el Step 3 de la Tarea 3):

```js
    if (vaAChat && eraChat && id !== linea && id !== CANAL_GENERAL) {
      setCanalActivo(id)
      ...
```

⚠️ Cuando **sales** de GENERAL hacia MANDI o REPUBLIC, sí tiene que limpiar: te llevas el chat abierto de un número a la pestaña de otro. Esa rama ya lo hace porque `id !== CANAL_GENERAL` se cumple.

- [ ] **Step 4: Comprobar a mano — la prueba de verdad**

Run: `npm run dev`

Expected, en este orden:
1. La pestaña **📥 GENERAL** aparece primera, con el total de pendientes de los dos números.
2. Al entrar, la columna trae contactos de los dos, cada uno con su línea verde o naranja.
3. Al abrir uno naranja, la pestaña **REPUBLIC** se enciende con `◉` y la columna **no se filtra**: siguen los dos.
4. Al abrir uno verde, el `◉` se pasa a MANDI.
5. **Mandar un mensaje de prueba a tu propio celular desde un chat naranja y otro desde uno verde**, y verificar en el teléfono que llegaron desde los números correctos (+593 97 910 4167 y +593 98 374 5757).

El paso 5 es obligatorio: es lo único que comprueba de punta a punta que el canal armado manda de verdad.

- [ ] **Step 5: Correr la suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/App.jsx
git commit -F - <<'EOF'
feat(general): pestaña INBOX GENERAL con los dos numeros en una cola

La columna acumula MANDI y REPUBLIC y NO se filtra al abrir un chat: la
pestaña del canal solo se enciende con un punto para decir por donde sale
la respuesta. Asi se baja la cola entera sin cambiar de vista.

Pestaña activa = linea solida. Canal armado = linea punteada y ◉. Son dos
cosas distintas y tienen que verse distintas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: FIFO en la bandeja Pendientes

**Files:**
- Create: `lib/orden-bandeja.js`
- Create: `tests/orden-bandeja.test.js`
- Modify: `components/App.jsx:895-901` (donde se arma `filtered`)

**Interfaces:**
- Consumes: nada de tareas anteriores (es independiente; se puede hacer antes o después).
- Produces: `ordenarBandeja(convs, bandeja, esperandoDesde) → Array` — devuelve una copia ordenada, nunca muta.

Hoy la columna ordena por el mensaje más reciente arriba (`lib/utils.js`, `buildConvs`). Eso es lo contrario del FIFO: quien lleva más rato esperando se va hundiendo cada vez que escribe alguien nuevo. **Solo Pendientes cambia**; las demás bandejas conservan el orden de siempre, porque en Atendidos o Archivados el más viejo arriba serían conversaciones de hace meses.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/orden-bandeja.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { ordenarBandeja } from '../lib/orden-bandeja.js'

const conv = (telefono, ultimoMensaje) => ({ telefono, last: { timestamp: ultimoMensaje } })

// Ana escribió hace mucho y sigue esperando; Beto acaba de escribir.
const ANA  = conv('593999000001', '2026-08-08T10:00:00Z')
const BETO = conv('593999000002', '2026-08-08T16:00:00Z')
const espera = {
  '593999000001': '2026-08-08T09:00:00Z',   // Ana lleva esperando desde las 9
  '593999000002': '2026-08-08T15:55:00Z',   // Beto, desde hace 5 minutos
}
const esperandoDesde = (tel) => espera[tel] || null

test('en Pendientes manda el que lleva mas esperando (FIFO)', () => {
  const r = ordenarBandeja([BETO, ANA], 'pendiente', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000001', '593999000002'])
})

test('en las demas bandejas sigue mandando el mas reciente', () => {
  const r = ordenarBandeja([ANA, BETO], 'atendido', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000002', '593999000001'])
})

test('FIFO usa el ultimo ENTRANTE, no el ultimo mensaje', () => {
  // A Beto le salio un mensaje NUESTRO despues (un seguimiento del cron), asi
  // que su ultimo mensaje es mas nuevo que el de Ana. Pero Beto escribio antes
  // que Ana, asi que sigue delante en la cola: lo que se ordena es cuanto lleva
  // esperando LA PERSONA, no cuando tocamos nosotros el chat.
  //
  // ⚠️ Esto es un SEGURO, no un problema observado: medido el 8-ago-2026, las
  // 18 conversaciones pendientes de MANDI tenian las dos fechas identicas
  // (diferencia maxima 0,0 h), porque contestar saca el chat de Pendientes y
  // los saludos automaticos corren segundos despues. Se cubre igual porque el
  // campo ya viene en la ficha y cuesta una linea; el dia que un seguimiento
  // caiga sobre un chat pendiente, la cola no miente.
  const beto = conv('593999000002', '2026-08-08T23:59:00Z')
  const r = ordenarBandeja([beto, ANA], 'pendiente', esperandoDesde)
  assert.deepEqual(r.map(c => c.telefono), ['593999000001', '593999000002'])
})

test('sin dato de espera cae al ultimo mensaje, no al fondo', () => {
  const sinDato = conv('593999000003', '2026-08-08T08:00:00Z')
  const r = ordenarBandeja([ANA, sinDato], 'pendiente', () => null)
  // Ordena por last.timestamp: el de las 08:00 va primero.
  assert.deepEqual(r.map(c => c.telefono), ['593999000003', '593999000001'])
})

test('las fechas invalidas van al final y no rompen el orden del resto', () => {
  const roto = { telefono: '593999000004', last: { timestamp: 'no-es-fecha' } }
  const r = ordenarBandeja([roto, BETO, ANA], 'pendiente', esperandoDesde)
  assert.equal(r[r.length - 1].telefono, '593999000004')
  assert.deepEqual(r.slice(0, 2).map(c => c.telefono), ['593999000001', '593999000002'])
})

test('no muta el arreglo original', () => {
  const original = [BETO, ANA]
  ordenarBandeja(original, 'pendiente', esperandoDesde)
  assert.deepEqual(original.map(c => c.telefono), ['593999000002', '593999000001'])
})

test('tolera entradas vacias o basura sin lanzar', () => {
  assert.deepEqual(ordenarBandeja(null, 'pendiente', esperandoDesde), [])
  assert.deepEqual(ordenarBandeja([], 'pendiente', esperandoDesde), [])
  assert.equal(ordenarBandeja([ANA], 'pendiente', null).length, 1)
})
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/orden-bandeja.js'`.

- [ ] **Step 3: Implementar `lib/orden-bandeja.js`**

```js
// lib/orden-bandeja.js — El orden de la columna de contactos, por bandeja.
//
// Pendientes es una COLA DE TRABAJO, no un muro de novedades: arriba va quien
// lleva más rato esperando respuesta. Las demás bandejas se quedan con el orden
// de siempre (lo más reciente arriba), porque ahí el más viejo primero serían
// conversaciones de hace meses.
//
// Función pura y sin React a propósito: es la regla que decide a quién atiendes
// primero, y tiene que poder probarse sola.

const FONDO = Number.MAX_SAFE_INTEGER

/** ISO → milisegundos. Una fecha vacía o corrupta va al final, nunca al frente. */
function ms(iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isNaN(t) ? FONDO : t
}

/**
 * @param {Array}  convs           conversaciones con { telefono, last: { timestamp } }
 * @param {string} bandeja         'pendiente' activa el FIFO; cualquier otra, el orden de siempre
 * @param {Function} esperandoDesde  (telefono) => ISO del último mensaje ENTRANTE, o null
 * @returns {Array} copia ordenada
 */
export function ordenarBandeja(convs, bandeja, esperandoDesde) {
  const lista = Array.isArray(convs) ? [...convs] : []
  if (bandeja !== 'pendiente') {
    // Orden de siempre: el mensaje más reciente arriba.
    return lista.sort((a, b) => ms(b?.last?.timestamp) - ms(a?.last?.timestamp))
  }
  const desde = typeof esperandoDesde === 'function' ? esperandoDesde : () => null
  // FIFO por el último ENTRANTE: se ordena por cuánto lleva esperando LA
  // PERSONA, no por cuándo tocamos nosotros el chat.
  //
  // Hoy las dos fechas coinciden casi siempre —medido el 8-ago-2026: las 18
  // conversaciones pendientes de MANDI tenían diferencia 0,0 h—, porque
  // contestar saca el chat de Pendientes. Se usa el entrante igual porque es
  // gratis (el campo ya viene en la ficha) y porque el día que un seguimiento
  // del cron caiga sobre un chat pendiente, ordenar por el último mensaje
  // mandaría al fondo justo a quien lleva más esperando.
  const clave = (c) => {
    const entrante = ms(desde(c?.telefono))
    return entrante === FONDO ? ms(c?.last?.timestamp) : entrante
  }
  return lista.sort((a, b) => clave(a) - clave(b))
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `npm test`
Expected: PASS — las 7 pruebas nuevas en verde.

- [ ] **Step 5: Aplicarlo en la columna**

En `components/App.jsx`, agregar el import junto a los demás de `lib/`:

```js
import { ordenarBandeja } from '@/lib/orden-bandeja'
```

Y reemplazar el bloque de `filtered`:

```js
  const filtered = ordenarBandeja(
    isSearching
      ? searched
      : searched.filter(c =>
          filter === 'venta' ? esVentaActiva(c.telefono)
          : esTemp(filter)   ? getTemp(c.telefono) === filter
          :                    getStatus(c.telefono) === filter
        ),
    isSearching ? '' : filter,
    (tel) => contacts[tel]?.ultimoEntranteAt || null,
  )
```

⚠️ Cuando estás **buscando** se pasa `''` como bandeja: los resultados de búsqueda se ordenan por lo más reciente, que es lo que uno espera al buscar a alguien. El FIFO es de la cola de trabajo, no del buscador.

- [ ] **Step 6: Comprobar a mano**

Run: `npm run dev`
Expected:
1. En **Pendientes**, arriba está quien escribió hace más rato. Bajando la columna, las horas van de más vieja a más nueva.
2. En **Atendidos**, **Archivados** y **Soporte**, arriba sigue lo más reciente.
3. Buscando a alguien, el orden es el de siempre.
4. En GENERAL, la cola FIFO mezcla verdes y naranjas por hora de espera — que es el punto de todo esto.

- [ ] **Step 7: Commit**

```bash
git add lib/orden-bandeja.js tests/orden-bandeja.test.js components/App.jsx
git commit -F - <<'EOF'
feat(bandejas): Pendientes ordena FIFO, el que lleva mas esperando arriba

Pendientes es una cola de trabajo. Ordenada por el mensaje mas reciente
—como estaba— quien lleva mas rato esperando se hunde cada vez que
escribe alguien nuevo, y con dos numeros acumulados se hunde el doble.

Ordena por el ultimo ENTRANTE, no por el ultimo mensaje: si no, un saludo
automatico nuestro manda al fondo justo al que falta contestarle.

Las demas bandejas y el buscador no cambian.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Después de terminar

- [ ] `git push` a `main` y confirmar con `npx vercel ls wa-inbox-v2 --prod` que el despliegue de producción tomó el commit (un push a main no siempre dispara build).
- [ ] Probar **en producción** el envío desde un chat de cada color, a un celular propio.
- [ ] Escribir el handoff en `docs/HANDOFF-2026-08-08-inbox-general.md`.

## Lo que este plan NO hace, y por qué

- **No parte las conversaciones en una fila por canal.** Las 24 personas (de 1.440) que escribieron a los dos números siguen teniendo una sola ficha, un solo estado y una sola línea de color: la de su último mensaje. Partirlas es una migración sobre la tabla más caliente, que tocan también el CRM, el cron y la CAPI. No se justifica por el 1,7%.
- **No muestra los dos hilos juntos** para esas 24. Al abrirlas ves el hilo del canal armado. Es coherente con lo que dice la línea de color, pero **te falta contexto sin saberlo**: si alguna vez molesta, lo honesto es avisarlo en la fila, no mezclar los hilos.
- **No toca IND.** REPUBLIC es un canal de MANDI.
- **No cambia el webhook, el cron, ni la CAPI.** Todo el plan es lectura e interfaz.
