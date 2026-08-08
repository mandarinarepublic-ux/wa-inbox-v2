# Fase 3 — PEDIDO MANUAL en el inbox — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear un pedido de verdad desde el panel derecho del inbox, con la pantalla `nuevo-pedido` del CRM incrustada, y que el pedido quede a nombre de quien lo hizo.

**Architecture:** No se reimplementa ningún formulario. El panel derecho abre un `<iframe>` a `nuevo-pedido` del CRM con `?embed=1`, que oculta menú y cabecera. La sesión ya viaja sola: la cookie `mp_sesion` es de `.apps.mandarinaec.com` y el iframe es del mismo sitio. Al crear, el CRM avisa al padre con `postMessage` y el inbox guarda la nota `📦` y marca `idVenta`, igual que hoy.

**Tech Stack:** Next.js 14 App Router en los dos repos, React 18, pruebas con `node --test` (sin dependencias nuevas), Vercel.

## Global Constraints

- **Dos repos.** CRM: `C:\Users\RodrigoWork\Desktop\MANDARINACRM` (Vercel `mandarina-pro-sales`). Inbox: `C:\Users\RodrigoWork\Desktop\wa-inbox-next` (Vercel `wa-inbox-v2`). Producción = `main` en los dos.
- **BAJO NINGÚN CONCEPTO puede afectarse el envío o la recepción de mensajes, ni la creación de pedidos** por los caminos que ya existen. Manda sobre cualquier otra decisión.
- **El botón CREAR PEDIDO con IA se conserva**, no se toca su comportamiento (§3.5 y §8 del spec). Pasa a ser el segundo camino, no el principal.
- Trabajar **siempre en `main`**, sin ramas. Commit apenas algo funcione; push antes de cerrar.
- Valores exactos:
  - Orígenes de los inbox: `https://inbox.apps.mandarinaec.com` y `https://ind-inbox.apps.mandarinaec.com`.
  - Origen del CRM: `https://crm.apps.mandarinaec.com`.
  - Tipo del mensaje `postMessage`: `'pedido-creado'`.
- **Nunca `postMessage(..., '*')` ni aceptar un mensaje sin comprobar `event.origin`.** Un iframe recibe mensajes de cualquiera.
- **El origen destino NO puede venir de un parámetro de la URL.** Se valida contra lista blanca, igual que `lib/volver.js`.
- Español ecuatoriano con tuteo en comentarios, commits y textos de pantalla. Nada de voseo.
- ⚠️ Tras cada push, **confirmar que Vercel desplegó** (`vercel ls <proyecto> --prod`): el 7-ago un push a `main` no disparó build.

---

## Estructura de archivos

| Archivo | Responsabilidad | Repo | Tarea |
|---|---|---|---|
| `lib/origenes.js` | única lista de orígenes nuestros | CRM | 1 |
| `tests/origenes.test.js` | que un parecido no se cuele | CRM | 1 |
| `lib/volver.js` | pasa a leer la lista de `origenes.js` | CRM | 1 |
| `next.config.js` | `frame-ancestors` con la lista blanca | CRM | 2 |
| `tests/csp.test.js` | que la CSP y `origenes.js` no se desincronicen | CRM | 2 |
| `app/dashboard/layout.js` | esconder menú y cabecera con `embed=1` | CRM | 3 |
| `lib/aviso-padre.js` | avisar al inbox, validando a quién | CRM | 4 |
| `tests/aviso-padre.test.js` | que no avise a un origen ajeno | CRM | 4 |
| `app/dashboard/nuevo-pedido/page.js` | precarga + aviso al crear | CRM | 4 |
| `lib/pedido-manual.js` | armar la URL y leer el aviso | inbox | 5 |
| `tests/pedido-manual.test.js` | teléfono y validación del aviso | inbox | 5 |
| `components/PedidoManual.jsx` | el iframe con su cabecera | inbox | 6 |
| `components/RightPanel.jsx` | los dos botones | inbox | 6 |
| `components/App.jsx` | ensanchar el panel al abrir | inbox | 6 |

---

## Task 1: La lista de orígenes, en un solo lugar

El CRM ya tiene una lista blanca de hosts en `lib/volver.js:14-18`. La Fase 3 necesita **la misma lista** para dos cosas más: la CSP y el destino del `postMessage`. El handoff de la Fase 2 (§5.3) fue explícito: *"Tres copias divergentes de un filtro de redirecciones es exactamente cómo nacen los redirects abiertos. Si los inbox lo necesitan, que sea UNA fuente."*

**Files:**
- Create: `lib/origenes.js`
- Create: `tests/origenes.test.js`
- Modify: `lib/volver.js:12-18`

**Interfaces:**
- Consumes: nada.
- Produces: `ORIGENES_INBOX: readonly string[]`, `ORIGEN_CRM: string`, `HOSTS_PERMITIDOS: Set<string>`, `esOrigenInbox(origen: string): boolean`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/origenes.test.js`:

```js
// La lista de orígenes decide QUIÉN puede enmarcar el CRM y a quién se le manda
// el aviso del pedido creado. Un parecido que se cuele acá es un agujero real.
import test from 'node:test'
import assert from 'node:assert'
import { ORIGENES_INBOX, ORIGEN_CRM, HOSTS_PERMITIDOS, esOrigenInbox } from '../lib/origenes.js'

test('los dos inbox están, y con https', () => {
  assert.deepStrictEqual([...ORIGENES_INBOX], [
    'https://inbox.apps.mandarinaec.com',
    'https://ind-inbox.apps.mandarinaec.com',
  ])
})

test('esOrigenInbox acepta los nuestros', () => {
  assert.strictEqual(esOrigenInbox('https://inbox.apps.mandarinaec.com'), true)
  assert.strictEqual(esOrigenInbox('https://ind-inbox.apps.mandarinaec.com'), true)
})

test('el CRM no es un inbox', () => {
  // El CRM puede enmarcarse a sí mismo por 'self', pero no es destino de avisos.
  assert.strictEqual(esOrigenInbox(ORIGEN_CRM), false)
})

test('un sufijo parecido NO pasa', () => {
  // El truco clásico: termina igual pero el dominio es de otro.
  assert.strictEqual(esOrigenInbox('https://inbox.apps.mandarinaec.com.evil.com'), false)
  assert.strictEqual(esOrigenInbox('https://evil.com/inbox.apps.mandarinaec.com'), false)
})

test('http:// no pasa aunque el host sea el nuestro', () => {
  assert.strictEqual(esOrigenInbox('http://inbox.apps.mandarinaec.com'), false)
})

test('vacío, basura y null no lanzan', () => {
  assert.strictEqual(esOrigenInbox(''), false)
  assert.strictEqual(esOrigenInbox('null'), false)   // origin de un iframe sandbox
  assert.strictEqual(esOrigenInbox(null), false)
  assert.strictEqual(esOrigenInbox(undefined), false)
})

test('HOSTS_PERMITIDOS trae los tres hosts, sin protocolo', () => {
  // Es lo que consume lib/volver.js, que compara hostname.
  assert.strictEqual(HOSTS_PERMITIDOS.has('inbox.apps.mandarinaec.com'), true)
  assert.strictEqual(HOSTS_PERMITIDOS.has('ind-inbox.apps.mandarinaec.com'), true)
  assert.strictEqual(HOSTS_PERMITIDOS.has('crm.apps.mandarinaec.com'), true)
  assert.strictEqual(HOSTS_PERMITIDOS.size, 3)
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd /c/Users/RodrigoWork/Desktop/MANDARINACRM
npm test
```

Esperado: FALLA — `lib/origenes.js` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/origenes.js`:

```js
// Los orígenes de nuestras aplicaciones. UNA sola fuente, a propósito.
//
// Tres cosas distintas dependen de esta lista y las tres son de seguridad:
//   1. `lib/volver.js`  → a dónde se puede mandar a alguien después del login
//   2. `next.config.js` → quién puede enmarcar el CRM (frame-ancestors)
//   3. `lib/aviso-padre.js` → a quién se le manda el postMessage del pedido
//
// Tenerlas copiadas en tres lados es cómo nacen los redirects abiertos: se
// arregla una, se olvidan las otras dos, y nadie se entera hasta que alguien lo
// aprovecha.
//
// ⚠️ Se compara el ORIGEN COMPLETO (protocolo + host), nunca "empieza con" ni
// "contiene": `https://inbox.apps.mandarinaec.com.evil.com` pasaría esas dos.

/** Los inbox. Pueden enmarcar al CRM y reciben el aviso del pedido creado. */
export const ORIGENES_INBOX = Object.freeze([
  'https://inbox.apps.mandarinaec.com',
  'https://ind-inbox.apps.mandarinaec.com',
])

/** El CRM. Se enmarca a sí mismo por 'self'; NO es destino de avisos. */
export const ORIGEN_CRM = 'https://crm.apps.mandarinaec.com'

/** Solo los hostnames, que es lo que compara `volver.js`. */
export const HOSTS_PERMITIDOS = new Set(
  [...ORIGENES_INBOX, ORIGEN_CRM].map((o) => new URL(o).hostname),
)

/** ¿Este `event.origin` es uno de nuestros inbox? Nunca lanza. */
export function esOrigenInbox(origen) {
  return ORIGENES_INBOX.includes(String(origen || ''))
}
```

- [ ] **Step 4: Hacer que `volver.js` lea de ahí**

En `lib/volver.js`, reemplazar el bloque de las líneas 12-18 por:

```js
// ⚠️ Import RELATIVO, no `@/lib/origenes`. El alias `@/` lo define jsconfig.json
// y **solo lo entiende el bundler de Next**: `node --test` carga este archivo
// directo y con el alias falla con ERR_MODULE_NOT_FOUND, tumbando la suite. Que
// nunca haya dado problemas es porque hasta hoy ni volver.js ni sesion.js
// importaban nada. Regla: un `lib/` que tenga prueba unitaria se importa entre
// sí con ruta relativa.
import { HOSTS_PERMITIDOS } from './origenes.js'

const DESTINO_POR_DEFECTO = '/dashboard'
```

El resto del archivo **no se toca**: `HOSTS_PERMITIDOS.has(u.hostname)` en la línea 33 sigue igual.

- [ ] **Step 5: Correr TODAS las pruebas**

```bash
npm test
```

Esperado: las 7 nuevas en verde **y `tests/volver.test.js` sin un solo cambio**. Si volver falla, el import quedó mal.

- [ ] **Step 6: Commit**

```bash
git add lib/origenes.js lib/volver.js tests/origenes.test.js
git commit -m "refactor(origenes): una sola lista de origenes nuestros, en vez de tres copias"
git push origin main
```

---

## Task 2: Permitir que los inbox enmarquen el CRM

Hoy el CRM no manda `X-Frame-Options` ni CSP, así que **cualquiera puede enmarcarlo**. Se aprovecha esta fase para cerrarlo con lista blanca en vez de dejarlo abierto.

**Files:**
- Modify: `next.config.js`
- Create: `tests/csp.test.js`

**Interfaces:**
- Consumes: `ORIGENES_INBOX` (T1).
- Produces: nada que otras tareas consuman.

- [ ] **Step 1: Escribir la prueba que falla**

`next.config.js` es CommonJS y no se puede importar desde una prueba ESM sin enredo, así que la prueba **lee el archivo como texto**. Suena tosco, pero atrapa justo lo que importa: que alguien agregue un inbox a `origenes.js` y se olvide de la CSP.

Crear `tests/csp.test.js`:

```js
// Si la CSP y la lista de orígenes se desincronizan, el inbox nuevo carga en
// blanco dentro del iframe y el navegador solo lo dice en la consola. Esta
// prueba es la que avisa antes de que pase.
import test from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { ORIGENES_INBOX } from '../lib/origenes.js'

const config = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8')

test('la CSP declara frame-ancestors', () => {
  assert.match(config, /frame-ancestors/)
})

test('cada origen de la lista está en la CSP', () => {
  for (const origen of ORIGENES_INBOX) {
    assert.ok(config.includes(origen), `falta ${origen} en la CSP de next.config.js`)
  }
})

test('la CSP NO usa comodín', () => {
  // frame-ancestors * deja que cualquiera enmarque el CRM: clickjacking servido.
  assert.doesNotMatch(config, /frame-ancestors[^;'"]*\*/)
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test
```

Esperado: FALLA — `next.config.js` todavía no tiene `frame-ancestors`.

- [ ] **Step 3: Implementar**

En `next.config.js`, agregar `headers()` dentro de `nextConfig`, **sin tocar el bloque `webpack` que ya está**:

```js
  // Quién puede meter el CRM dentro de un iframe.
  //
  // Hasta hoy no había ninguna cabecera, o sea que podía enmarcarlo cualquiera
  // (clickjacking: te ponen el CRM invisible encima de otra cosa y haces clics
  // que no querías). Se cierra con lista blanca, no con comodín.
  //
  // ⚠️ Estos valores están repetidos a mano porque next.config.js es CommonJS y
  // lib/origenes.js es ESM. `tests/csp.test.js` compara los dos y falla si se
  // desincronizan — si agregas un inbox, agrégalo en los dos lados.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://inbox.apps.mandarinaec.com https://ind-inbox.apps.mandarinaec.com",
          },
        ],
      },
    ]
  },
```

- [ ] **Step 4: Correr las pruebas y compilar**

```bash
npm test && npm run build
```

Esperado: todo en verde y compila.

- [ ] **Step 5: Commit y desplegar**

```bash
git add next.config.js tests/csp.test.js
git commit -m "feat(csp): solo nuestros inbox pueden enmarcar el CRM"
git push origin main
```

- [ ] **Step 6: Verificar contra producción**

```bash
curl -sS -D- -o /dev/null https://crm.apps.mandarinaec.com/ | grep -i "content-security-policy"
```

Esperado: la cabecera con los dos orígenes.

⚠️ **Y comprobar que el CRM sigue funcionando normal** (entrar, abrir un pedido). Una CSP mal escrita puede romper la página entera; `frame-ancestors` solo afecta el enmarcado, pero se verifica igual.

---

## Task 3: `embed=1` esconde el menú y la cabecera

**Files:**
- Modify: `app/dashboard/layout.js:121` (renombrar) y `:166-282` (salida temprana), más un envoltorio nuevo al final.

**Interfaces:**
- Consumes: nada.
- Produces: el modo embed que consume la Tarea 4.

> **Por qué hay que envolver en `Suspense`:** `useSearchParams()` obliga a que el componente esté dentro de un `<Suspense>` o Next falla el build con *"useSearchParams() should be wrapped in a suspense boundary"*. El archivo ya usa ese patrón para `ActiveLink` (ver el comentario en la línea 61), así que se repite el mismo.

- [ ] **Step 1: Renombrar el componente actual**

En `app/dashboard/layout.js`, cambiar la línea 121:

```js
export default function DashboardLayout({ children }) {
```

por:

```js
function DashboardChrome({ children }) {
```

- [ ] **Step 2: Leer el modo embed**

Agregar `useSearchParams` al `import` de `next/navigation` si no estuviera (ya está en la línea 4), y dentro de `DashboardChrome`, justo debajo de `const router = useRouter()`:

```js
  // Con ?embed=1 esta pantalla vive dentro del panel del inbox: sin menú lateral,
  // sin cabecera y sin los márgenes que dejan sitio para ellos. Es un cambio de
  // presentación, NO de permisos: la sesión y el rol siguen decidiéndose igual.
  const searchParams = useSearchParams()
  const esEmbed = searchParams?.get('embed') === '1'
```

- [ ] **Step 3: Salida temprana en modo embed**

Justo **antes** del `return (` de la línea 166 (el que abre `<div className="min-h-screen bg-gray-950">`), y **después** del `if (!user) return (…)` de la línea 158, agregar:

```js
  if (esEmbed) {
    // Ojo: se conserva el fondo para que el iframe no se vea blanco sobre el
    // panel oscuro del inbox mientras carga.
    return <main className="min-h-screen bg-gray-950">{children}</main>
  }
```

- [ ] **Step 4: Agregar el envoltorio con Suspense**

Al final del archivo, agregar:

```js
// useSearchParams() exige un <Suspense> encima o el build falla. Mismo patrón
// que ActiveLink, más arriba en este archivo.
export default function DashboardLayout({ children }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-mandarina-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DashboardChrome>{children}</DashboardChrome>
    </Suspense>
  )
}
```

`Suspense` ya está importado en la línea 3.

- [ ] **Step 5: Compilar y probar a mano**

```bash
npm run build && npm test
```

Luego, en el navegador, con sesión:

1. `https://crm.apps.mandarinaec.com/dashboard/nuevo-pedido` → **con** menú y cabecera, como siempre.
2. `https://crm.apps.mandarinaec.com/dashboard/nuevo-pedido?embed=1` → **sin** menú ni cabecera, el formulario ocupando todo.

⚠️ Comprobar también `/dashboard` y `/dashboard/historial` **sin** `embed`: el menú tiene que seguir igual. Este paso toca el layout de TODO el CRM.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/layout.js
git commit -m "feat(embed): con embed=1 el dashboard va sin menu ni cabecera"
git push origin main
```

---

## Task 4: `nuevo-pedido` precargado y avisando al padre

**Files:**
- Create: `lib/aviso-padre.js`
- Create: `tests/aviso-padre.test.js`
- Modify: `app/dashboard/nuevo-pedido/page.js:125` (renombrar + envoltorio), `:162` (precarga), `:519` (aviso)

**Interfaces:**
- Consumes: `esOrigenInbox` (T1); el modo embed (T3).
- Produces: el mensaje `{ tipo: 'pedido-creado', pedidoId, montoTotal, url }`, que consume la Tarea 5.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `tests/aviso-padre.test.js`:

```js
// Mandar un postMessage con targetOrigin '*' es publicarle el pedido a
// cualquiera que te haya enmarcado. Estas pruebas fijan a quién se le habla.
import test from 'node:test'
import assert from 'node:assert'
import { avisarPedidoCreado, origenDelPadre } from '../lib/aviso-padre.js'

function ventanaFalsa(referrer) {
  const enviados = []
  return {
    enviados,
    win: {
      document: { referrer },
      parent: { postMessage: (msg, destino) => enviados.push({ msg, destino }) },
    },
  }
}

test('avisa al inbox que lo enmarcó, con su origen exacto', () => {
  const { win, enviados } = ventanaFalsa('https://inbox.apps.mandarinaec.com/inbox')
  avisarPedidoCreado({ pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' }, win)
  assert.strictEqual(enviados.length, 1)
  assert.strictEqual(enviados[0].destino, 'https://inbox.apps.mandarinaec.com')
  assert.strictEqual(enviados[0].msg.tipo, 'pedido-creado')
  assert.strictEqual(enviados[0].msg.pedidoId, 'MAN-AND-1')
  assert.strictEqual(enviados[0].msg.montoTotal, 42.5)
})

test('el inbox de IND también vale', () => {
  const { win, enviados } = ventanaFalsa('https://ind-inbox.apps.mandarinaec.com/inbox')
  avisarPedidoCreado({ pedidoId: 'IND-1', montoTotal: 1, url: 'x' }, win)
  assert.strictEqual(enviados[0].destino, 'https://ind-inbox.apps.mandarinaec.com')
})

test('NO avisa si quien enmarca no es de los nuestros', () => {
  const { win, enviados } = ventanaFalsa('https://evil.com/trampa')
  avisarPedidoCreado({ pedidoId: 'X', montoTotal: 1, url: 'x' }, win)
  assert.strictEqual(enviados.length, 0)
})

test('NO avisa sin referrer', () => {
  // Sin referrer no se sabe a quién hablarle, y '*' no es opción.
  const { win, enviados } = ventanaFalsa('')
  avisarPedidoCreado({ pedidoId: 'X', montoTotal: 1, url: 'x' }, win)
  assert.strictEqual(enviados.length, 0)
})

test('origenDelPadre saca solo el origen, sin la ruta', () => {
  assert.strictEqual(
    origenDelPadre('https://inbox.apps.mandarinaec.com/inbox?x=1'),
    'https://inbox.apps.mandarinaec.com',
  )
  assert.strictEqual(origenDelPadre('basura'), '')
  assert.strictEqual(origenDelPadre(''), '')
})

test('no lanza si no hay ventana', () => {
  // En el servidor no existe `window`; la función tiene que aguantarlo.
  assert.doesNotThrow(() => avisarPedidoCreado({ pedidoId: 'X', montoTotal: 1, url: 'x' }, undefined))
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
npm test
```

Esperado: FALLA — no existe `lib/aviso-padre.js`.

- [ ] **Step 3: Implementar**

Crear `lib/aviso-padre.js`:

```js
// Avisarle al inbox que el pedido ya está creado.
//
// El inbox nos tiene dentro de un iframe y necesita el número del pedido para
// dejar su nota `📦` y marcar el chat como venta. La vía es postMessage.
//
// ⚠️ El destino NO puede ser '*': eso le entrega el pedido a cualquiera que nos
// haya enmarcado. Y tampoco puede venir de un parámetro de la URL, porque
// entonces lo elige quien arma el enlace. Se saca del `document.referrer`, que
// lo pone el navegador, y se valida contra la lista blanca de lib/origenes.js.
// ⚠️ Import RELATIVO, no `@/lib/origenes`: el alias solo lo entiende el bundler
// de Next y `node --test` carga este archivo directo. Ver la nota en volver.js.
import { esOrigenInbox } from './origenes.js'

/** El origen (protocolo + host) de una URL, o '' si no se puede leer. */
export function origenDelPadre(referrer) {
  try {
    return new URL(String(referrer || '')).origin
  } catch {
    return ''
  }
}

/**
 * Le avisa al inbox que enmarcó esta pantalla. Si no hay padre reconocible, no
 * hace nada: es normal cuando la pantalla se usa suelta, sin iframe.
 *
 * `ventana` se inyecta para poder probarlo; en la app se llama sin argumentos.
 */
export function avisarPedidoCreado({ pedidoId, montoTotal, url }, ventana = typeof window !== 'undefined' ? window : undefined) {
  if (!ventana) return
  const destino = origenDelPadre(ventana.document?.referrer)
  if (!esOrigenInbox(destino)) return
  ventana.parent?.postMessage({ tipo: 'pedido-creado', pedidoId, montoTotal, url }, destino)
}
```

> El archivo se importa **desde la página** con `@/lib/aviso-padre` (eso lo
> resuelve Next sin problema); lo que tiene que ser relativo es el import de
> `origenes.js` **dentro** de este archivo, porque `node --test` lo carga directo.

- [ ] **Step 4: Correr y ver que pasa**

```bash
npm test
```

Esperado: las 6 nuevas en verde.

- [ ] **Step 5: Renombrar la página y envolverla en Suspense**

En `app/dashboard/nuevo-pedido/page.js`, cambiar la línea 125:

```js
export default function NuevoPedidoPage() {
```

por:

```js
function NuevoPedidoContenido() {
```

Y al final del archivo agregar:

```js
// useSearchParams() exige <Suspense> encima o el build falla.
export default function NuevoPedidoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-mandarina-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <NuevoPedidoContenido />
    </Suspense>
  )
}
```

Y en la línea 2, agregar `Suspense` al import de React:

```js
import { useState, useEffect, useRef, Suspense } from 'react'
```

Y en la línea 3:

```js
import { useRouter, useSearchParams } from 'next/navigation'
```

- [ ] **Step 6: Precargar celular y nombre**

Dentro de `NuevoPedidoContenido`, junto a `const router = useRouter()`:

```js
  const searchParams = useSearchParams()
  const esEmbed = searchParams?.get('embed') === '1'
```

Y dentro del `useEffect` de la línea 162, **después** de `setUser(u)` y **antes** del bloque `if (u.rol === 'VENDEDOR_YAW')`:

```js
    // Precarga desde el inbox: solo celular y nombre. El buscador de cliente que
    // ya existe hace el resto — si la cédula está registrada, trae dirección,
    // ciudad y correo solo.
    //
    // El celular llega ya en formato ecuatoriano (0987654321) porque el inbox lo
    // convierte antes de armar la URL; acá NO se vuelve a tocar. Si viene algo
    // que no calza, se deja el campo vacío a propósito: un valor inválido
    // precargado traba el formulario y es peor que no precargar nada.
    const celularUrl = searchParams?.get('celular') || ''
    const nombreUrl  = searchParams?.get('nombre') || ''
    if (celularUrl || nombreUrl) {
      setCliente((p) => ({
        ...p,
        ...(/^0\d{9}$/.test(celularUrl) ? { celular: celularUrl } : {}),
        ...(nombreUrl ? { nombre: nombreUrl } : {}),
      }))
    }
```

- [ ] **Step 7: Avisar al padre al crear**

Agregar el import arriba del archivo:

```js
import { avisarPedidoCreado } from '@/lib/aviso-padre'
```

Y reemplazar la línea 519:

```js
      router.push(`/dashboard/pedido/${data.pedidoId}?nuevo=1`)
```

por:

```js
      // El inbox necesita el número para dejar su nota y marcar la venta. Se
      // avisa ANTES de navegar: después de router.push esta pantalla se va.
      if (esEmbed) {
        avisarPedidoCreado({
          pedidoId: data.pedidoId,
          montoTotal,
          url: `${window.location.origin}/dashboard/pedido/${data.pedidoId}`,
        })
      }
      // Se conserva el embed al navegar: si no, el pedido recién creado
      // aparecería con el menú entero dentro del panel del inbox.
      router.push(`/dashboard/pedido/${data.pedidoId}?nuevo=1${esEmbed ? '&embed=1' : ''}`)
```

- [ ] **Step 8: Compilar y probar a mano**

```bash
npm run build && npm test
```

En el navegador, con sesión:

```
https://crm.apps.mandarinaec.com/dashboard/nuevo-pedido?embed=1&celular=0999989663&nombre=Prueba
```

Esperado: sin menú, y con **Celular** y **Nombre** ya llenos.

⚠️ Y sin `embed`, la pantalla tiene que comportarse **exactamente como antes**, incluido crear un pedido de verdad y navegar a él.

- [ ] **Step 9: Commit**

```bash
git add lib/aviso-padre.js tests/aviso-padre.test.js app/dashboard/nuevo-pedido/page.js
git commit -m "feat(embed): nuevo-pedido precargado desde el inbox y avisando al crear"
git push origin main
```

---

## Task 5: El lado del inbox — armar la URL y leer el aviso

Toda la lógica sin React, para poder probarla.

**Files:**
- Create: `lib/pedido-manual.js` (repo **inbox**)
- Create: `tests/pedido-manual.test.js`

**Interfaces:**
- Consumes: el mensaje `{ tipo: 'pedido-creado', … }` (T4).
- Produces: `celularEcuador(telefono: string): string`, `urlPedidoManual(telefono: string, nombre: string): string`, `leerAvisoPedido(evento): {pedidoId, montoTotal, url} | null`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/pedido-manual.test.js`:

```js
// El inbox guarda los teléfonos como 593999989663 y el CRM exige 0999989663.
// Si la conversión falla, la precarga traba el formulario en vez de ayudar.
import test from 'node:test'
import assert from 'node:assert'
import { celularEcuador, urlPedidoManual, leerAvisoPedido } from '../lib/pedido-manual.js'

test('convierte el formato de WhatsApp al del CRM', () => {
  assert.strictEqual(celularEcuador('593999989663'), '0999989663')
  assert.strictEqual(celularEcuador('593987654321'), '0987654321')
})

test('aguanta el + y los espacios', () => {
  assert.strictEqual(celularEcuador('+593 99 998 9663'), '0999989663')
})

test('si ya viene en formato local lo deja igual', () => {
  assert.strictEqual(celularEcuador('0999989663'), '0999989663')
})

test('un número que no es de Ecuador devuelve vacío', () => {
  // Vacío = "no precargues". Mejor que meter algo que el CRM va a rechazar.
  assert.strictEqual(celularEcuador('12025550143'), '')
  assert.strictEqual(celularEcuador(''), '')
  assert.strictEqual(celularEcuador(null), '')
})

test('la URL lleva embed, celular y nombre, escapados', () => {
  const url = new URL(urlPedidoManual('593999989663', 'Ana & Cía'))
  assert.strictEqual(url.origin, 'https://crm.apps.mandarinaec.com')
  assert.strictEqual(url.pathname, '/dashboard/nuevo-pedido')
  assert.strictEqual(url.searchParams.get('embed'), '1')
  assert.strictEqual(url.searchParams.get('celular'), '0999989663')
  assert.strictEqual(url.searchParams.get('nombre'), 'Ana & Cía')
})

test('si el celular no convierte, no se manda el parámetro', () => {
  const url = new URL(urlPedidoManual('12025550143', 'Bob'))
  assert.strictEqual(url.searchParams.get('celular'), null)
  assert.strictEqual(url.searchParams.get('nombre'), 'Bob')
})

test('acepta el aviso del CRM', () => {
  const aviso = leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' },
  })
  assert.deepStrictEqual(aviso, { pedidoId: 'MAN-AND-1', montoTotal: 42.5, url: 'https://crm…/p/1' })
})

test('RECHAZA un mensaje de otro origen', () => {
  // Lo esencial: un iframe recibe mensajes de cualquiera. Sin este filtro,
  // cualquier página podría hacernos marcar ventas falsas.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://evil.com',
    data: { tipo: 'pedido-creado', pedidoId: 'FALSO', montoTotal: 1, url: 'x' },
  }), null)
})

test('RECHAZA otro tipo de mensaje', () => {
  // Las extensiones del navegador y las herramientas de React mandan mensajes
  // al mismo tiempo; hay que ignorarlos sin romperse.
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'otra-cosa', pedidoId: 'X' },
  }), null)
})

test('RECHAZA un aviso sin número de pedido', () => {
  assert.strictEqual(leerAvisoPedido({
    origin: 'https://crm.apps.mandarinaec.com',
    data: { tipo: 'pedido-creado', montoTotal: 5 },
  }), null)
})

test('no lanza con basura', () => {
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: 'hola' }), null)
  assert.strictEqual(leerAvisoPedido({ origin: 'https://crm.apps.mandarinaec.com', data: null }), null)
  assert.strictEqual(leerAvisoPedido({}), null)
  assert.strictEqual(leerAvisoPedido(null), null)
})
```

- [ ] **Step 2: Correr y ver que falla**

```bash
cd /c/Users/RodrigoWork/Desktop/wa-inbox-next
npm test
```

Esperado: FALLA — no existe `lib/pedido-manual.js`.

- [ ] **Step 3: Implementar**

Crear `lib/pedido-manual.js`:

```js
// PEDIDO MANUAL: abrir la pantalla `nuevo-pedido` del CRM dentro del panel.
//
// No se reimplementa ningún formulario. El CRM ya sabe de clientes, productos,
// pagos, factura, mapa y fecha de entrega; acá solo se arma la URL y se escucha
// la respuesta.

const CRM = 'https://crm.apps.mandarinaec.com'

/**
 * El teléfono de WhatsApp al formato que valida el CRM (`0987654321`).
 *
 * El inbox los guarda como `593999989663` (código de país, sin +) y el CRM exige
 * 10 dígitos empezando en 0. Si el número no es ecuatoriano se devuelve '' para
 * NO precargar: un valor inválido en ese campo traba el formulario, y es peor
 * que dejarlo vacío para que lo escriban.
 */
export function celularEcuador(telefono) {
  const d = String(telefono || '').replace(/\D/g, '')
  if (/^593\d{9}$/.test(d)) return '0' + d.slice(3)
  if (/^0\d{9}$/.test(d)) return d
  return ''
}

/** La URL del formulario del CRM, ya precargado con lo que sabemos del chat. */
export function urlPedidoManual(telefono, nombre) {
  const p = new URLSearchParams({ embed: '1' })
  const cel = celularEcuador(telefono)
  if (cel) p.set('celular', cel)
  if (nombre) p.set('nombre', String(nombre))
  return `${CRM}/dashboard/nuevo-pedido?${p.toString()}`
}

/**
 * Lee el aviso de "pedido creado", o null si el mensaje no es de fiar.
 *
 * ⚠️ Un iframe recibe `message` de CUALQUIERA: extensiones del navegador, las
 * herramientas de React, y quien quiera. Por eso se comprueba `origin` primero
 * y se exige la forma exacta. Sin esto, cualquier página abierta podría hacernos
 * marcar ventas que no existen.
 */
export function leerAvisoPedido(evento) {
  if (!evento || evento.origin !== CRM) return null
  const d = evento.data
  if (!d || typeof d !== 'object') return null
  if (d.tipo !== 'pedido-creado') return null
  if (!d.pedidoId) return null
  return { pedidoId: String(d.pedidoId), montoTotal: d.montoTotal, url: d.url }
}
```

- [ ] **Step 4: Correr las pruebas**

```bash
npm test
```

Esperado: las 12 nuevas en verde, más las 145 que ya había.

- [ ] **Step 5: Commit**

```bash
git add lib/pedido-manual.js tests/pedido-manual.test.js
git commit -m "feat(pedido): URL del formulario del CRM y lectura segura de su aviso"
git push origin main
```

---

## Task 6: El panel con el formulario dentro

**Files:**
- Create: `components/PedidoManual.jsx`
- Modify: `components/RightPanel.jsx:227` (props), `:707-716` (los botones)
- Modify: `components/App.jsx:1660` (ancho del panel)

**Interfaces:**
- Consumes: `urlPedidoManual`, `leerAvisoPedido` (T5); `addNota`, `setIdVenta` (ya existen en `lib/api-client`).
- Produces: nada.

- [ ] **Step 1: Crear el componente**

Crear `components/PedidoManual.jsx`:

```jsx
'use client'
import React, { useEffect, useRef } from 'react'
import { urlPedidoManual, leerAvisoPedido } from '@/lib/pedido-manual'

// El formulario de pedidos del CRM, dentro del panel derecho.
//
// La sesión viaja sola: la cookie `mp_sesion` es de `.apps.mandarinaec.com` y el
// CRM es un subdominio de ahí, así que el iframe entra autenticado sin que
// tengamos que pasarle nada. Si la sesión venció, el CRM muestra su propio login
// DENTRO del panel en vez de expulsarte del inbox.
export default function PedidoManual({ telefono, nombre, onCreado, onCerrar }) {
  // `onCreado` cambia en cada render del padre; sin la ref, el efecto se
  // volvería a suscribir todo el tiempo y podríamos perder el aviso.
  const alCrear = useRef(onCreado)
  useEffect(() => { alCrear.current = onCreado }, [onCreado])

  useEffect(() => {
    function alMensaje(e) {
      const aviso = leerAvisoPedido(e)
      if (aviso) alCrear.current?.(aviso)
    }
    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [])

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div style={{
        flexShrink:0, padding:'8px 10px', background:'#0a0f1a',
        borderBottom:'1px solid #111c2a', display:'flex',
        alignItems:'center', justifyContent:'space-between', gap:8,
      }}>
        <span style={{ fontSize:12, fontWeight:800, color:'#e2e8f0', letterSpacing:'.03em' }}>
          🧾 PEDIDO MANUAL
        </span>
        <button onClick={onCerrar} style={{
          background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8',
          borderRadius:6, padding:'4px 10px', fontSize:11, fontWeight:700,
          cursor:'pointer', fontFamily:'inherit',
        }}>✕ Cerrar</button>
      </div>
      <iframe
        src={urlPedidoManual(telefono, nombre)}
        title="Nuevo pedido"
        style={{ flex:1, width:'100%', border:'none', background:'#0a0f1a', minHeight:0 }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Enganchar los dos botones en `RightPanel`**

En `components/RightPanel.jsx`, agregar al import de la línea 5:

```js
import PedidoManual from './PedidoManual'
```

En la firma del componente (línea 227), agregar la prop `onPedidoManual`:

```js
export default function RightPanel({ activeConv, onQuickReply, onSendText, onSendImage, onSendProducto, contactInfo, onUpdateContact, windowOpen, onPedidoManual, pestanas = ['respuestas', 'ventas', 'tienda'] }) {
```

Junto al resto de `useState` del componente, agregar:

```js
  const [manualAbierto, setManualAbierto] = useState(false)
```

Y avisarle al padre cuando cambie, para que ensanche el panel:

```js
  useEffect(() => { onPedidoManual?.(manualAbierto) }, [manualAbierto, onPedidoManual])

  // Al cambiar de conversación se cierra: dejarlo abierto mostraría el formulario
  // precargado con el cliente ANTERIOR, que es la peor forma de equivocarse.
  useEffect(() => { setManualAbierto(false) }, [activeConv?.telefono])
```

- [ ] **Step 3: Pintar el formulario o los botones**

Reemplazar el bloque de las líneas 707-716 (desde `{/* CREAR PEDIDO */}` hasta el cierre del `<button>` del CREAR PEDIDO) por:

```jsx
            {/* PEDIDO MANUAL (principal) + CON IA (el de siempre) */}
            {manualAbierto ? (
              <div style={{ height:'70vh', minHeight:380 }}>
                <PedidoManual
                  telefono={activeConv.telefono}
                  nombre={contactName}
                  onCerrar={() => setManualAbierto(false)}
                  onCreado={(aviso) => {
                    // Exactamente lo mismo que hace el botón con IA: la nota
                    // fechada con el link, y la marca de venta.
                    addNota(activeConv.telefono, `📦 Pedido ${aviso.pedidoId} · $${aviso.montoTotal}\n${aviso.url}`)
                      .then(() => setNotasRefrescar(n => n + 1))
                      .catch(() => {})
                    setIdVenta(activeConv.telefono, aviso.pedidoId).catch(() => {})
                    setPedidoRes({ ok: true, pedidoId: aviso.pedidoId, montoTotal: aviso.montoTotal })
                  }}
                />
              </div>
            ) : (
              <div style={{ padding:'12px 12px 4px' }}>
                <button onClick={() => setManualAbierto(true)}
                  style={{ width:'100%', padding:'9px', background:'linear-gradient(135deg,#10b981,#059669)', border:'1px solid rgba(16,185,129,.4)', color:'#fff', borderRadius:8, fontSize:12, fontWeight:800, cursor:'pointer', fontFamily:'inherit', letterSpacing:'.03em' }}>
                  🧾 PEDIDO MANUAL
                </button>
                <button onClick={crearPedido} disabled={pedidoLoading}
                  style={{ width:'100%', marginTop:6, padding:'7px', background:'#111c2a', border:'1px solid #1e2d3d', color:'#94a3b8', borderRadius:8, fontSize:11, fontWeight:700, cursor: pedidoLoading?'default':'pointer', fontFamily:'inherit' }}>
                  {pedidoLoading ? '⏳ Leyendo conversación…' : '🤖 Crear con IA'}
                </button>
              </div>
            )}
```

> ⚠️ El `<div style={{ padding:'12px 12px 4px' }}>` original envolvía **también** el bloque `{pedidoRes?.ok && …}` que viene después. Al reemplazar, dejar ese bloque donde está y que quede **fuera** del ternario, para que el aviso "✅ Pedido creado" se vea en los dos caminos.

- [ ] **Step 4: Ensanchar el panel al abrir**

En `components/App.jsx`, junto al resto de `useRef`:

```js
  // El asistente del CRM son 4 pasos pensados para pantalla completa; en 340px
  // no se puede llenar. Se ensancha al abrirlo y se devuelve el ancho guardado
  // al cerrar. Es el punto más flojo del diseño y está aceptado a sabiendas.
  //
  // El ancho anterior va en una REF, no en estado, a propósito: hay que leerlo y
  // escribirlo dentro del mismo callback, y meter un `setRightWidth` dentro del
  // actualizador de un `useState` es un efecto secundario en un updater — React
  // los ejecuta dos veces en modo estricto y el ancho quedaría mal guardado.
  const anchoPrevioRef = useRef(null)

  const alAbrirPedidoManual = useCallback((abierto) => {
    if (abierto) {
      if (anchoPrevioRef.current === null) anchoPrevioRef.current = rightWidthRef.current
      const ancho = Math.min(720, Math.round(window.innerWidth * 0.55))
      setRightWidth(Math.max(rightWidthRef.current, ancho))
      return
    }
    if (anchoPrevioRef.current !== null) {
      setRightWidth(anchoPrevioRef.current)
      anchoPrevioRef.current = null
    }
  }, [])
```

`useCallback` y `useRef` ya están importados en la línea 2 del archivo.

Y pasarle la prop a **las dos** instancias de `RightPanel` (la de escritorio y la del cajón móvil):

```jsx
onPedidoManual={alAbrirPedidoManual}
```

> ⚠️ **Son dos instancias.** Olvidar la del celular es el bug exacto que ya pasó con `onSendProducto` (commit `b0ac404`): el botón no hacía nada, sin error y sin registro. Buscar `<RightPanel` en el archivo y confirmar que aparece en las dos.

- [ ] **Step 5: Compilar y probar**

```bash
npm run build && npm test
```

- [ ] **Step 6: Commit**

```bash
git add components/PedidoManual.jsx components/RightPanel.jsx components/App.jsx
git commit -m "feat(pedido): PEDIDO MANUAL con el formulario del CRM dentro del panel"
git push origin main
```

---

## Task 7: Verificación de punta a punta

No es tarea de código: es la que dice si la fase sirve.

**Files:** ninguno.

- [ ] **Step 1: Confirmar que los dos proyectos desplegaron**

```bash
vercel ls mandarina-pro-sales --prod
vercel ls wa-inbox-v2 --prod
```

- [ ] **Step 2: Crear un pedido de verdad**

En `https://inbox.apps.mandarinaec.com/inbox`, con sesión:

1. Abrir un chat → pestaña **Ventas** → **🧾 PEDIDO MANUAL**.
2. El panel se ensancha y aparece el formulario **sin el menú del CRM**, con **celular y nombre ya llenos**.
3. Completar el pedido y crearlo.
4. En el inbox tienen que aparecer, sin recargar: la nota **📦 Pedido … · $…** y la marca **💰** de venta.

- [ ] **Step 3: Comprobar el vendedor en la base**

```sql
select pedido_id, vendedor_id, cliente_nombre, total, fecha_pedido
from crm.pedidos order by fecha_pedido desc limit 3;
```

Esperado: `vendedor_id` es **la persona que entró**, no `MANDI-WA`. Ese es el punto de toda la fase.

- [ ] **Step 4: Comprobar que no se rompió el camino viejo**

Con **🤖 Crear con IA** en otro chat: tiene que seguir funcionando igual que antes.

- [ ] **Step 5: Comprobar que el mensajeo sigue intacto**

```sql
select count(*) filter (where direccion='ENTRANTE') as entrantes,
       count(*) filter (where direccion='SALIENTE') as salientes,
       count(*) filter (where direccion='SALIENTE' and estado_entrega='failed') as fallidos
from inbox.mensajes where cuenta='MANDI' and fecha > now() - interval '2 hours';
```

Esperado: `fallidos = 0` y los otros dos subiendo.

- [ ] **Step 6: Comprobar que el CRM suelto no cambió**

Entrar a `https://crm.apps.mandarinaec.com/dashboard` normal: menú, cabecera y `nuevo-pedido` completo, como siempre. La Tarea 3 tocó el layout de TODO el CRM.

---

## Verificación de la fase completa

- [ ] `npm test` en verde en los dos repos.
- [ ] Un pedido real creado desde el inbox, **con el vendedor correcto**.
- [ ] La nota `📦` y la marca `💰` aparecen solas en el inbox.
- [ ] El botón con IA sigue funcionando.
- [ ] El CRM suelto se ve y funciona igual que antes.
- [ ] La cabecera `Content-Security-Policy: frame-ancestors …` responde en producción, sin comodín.
- [ ] `fallidos = 0` en las 2 h siguientes.

## Riesgos conocidos, aceptados

1. **El ancho** (§13.1 del spec). `nuevo-pedido` es un asistente de 4 pasos para pantalla completa; en una laptop de 13", aun ensanchando el panel, va justo. Es el punto más flojo y está aceptado. Si molesta mucho, la salida es abrirlo en una ventana aparte en vez de en el panel.
2. **La Tarea 3 toca el layout de todo el CRM.** Es un cambio chico, pero el radio de impacto es la aplicación entera; por eso el Paso 6 de la Tarea 7 existe.
3. **El aviso depende de `document.referrer`.** Si algún día el inbox se sirve con `Referrer-Policy: no-referrer`, el `postMessage` deja de encontrar destino y el pedido se crearía sin dejar nota. Hoy no hay esa cabecera. Si aparece, esto se entera antes que nadie.

## Lo que queda para después

- **Fase 4** — cerrar `mandi-agent/api/crear-pedido.js`, hoy abierto al mundo, y hacerle firmar quién vendió en vez del `vendedorId: 'MANDI-WA'` quemado. ⚠️ El botón **Crear con IA** llama a ese endpoint: cerrarlo sin tocar el inbox rompe el botón.
- **Fase 5** — repetir las fases 2 y 3 en `ind-inbox-next` con `INBOX_INDSTORE`. Copiar también `AvisoSesion`.
