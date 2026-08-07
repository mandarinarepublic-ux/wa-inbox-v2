# Fase 2 — El candado del inbox MANDI — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al inbox de MANDI solo entre quien tenga sesión del CRM y el permiso `INBOX_MANDARINA`, sin que se caiga ni un mensaje.

**Architecture:** Un middleware con tres puertas —persona con sesión, máquina con token, ruta pública— copiado del que ya funciona en el CRM. Sale primero en **modo observación**, que anota lo que habría rechazado sin rechazar nada, y solo se activa cuando el registro esté limpio. Un interruptor de entorno lo apaga sin desplegar.

**Tech Stack:** Next.js App Router, runtime Edge para el middleware, Node 24, Supabase (schemas `inbox` y `crm`), Vercel. Pruebas con `node --test`, sin dependencias nuevas.

## Estado al 7-ago-2026, 16:30

**Tareas 1 a 4 HECHAS y en producción.** Falta la 5 (redirección del host viejo)
y la 6 (ventana de observación y encendido).

- Producción corriendo `fdf70f4` con **`AUTH_MODO=observar`**: anota y **no rechaza
  a nadie**. Verificado: `/api/lista` y `/inbox` siguen dando 200 sin cookie,
  `/api/webhook` sigue en 403 y `/api/pago-dlocal` en 405, iguales que antes.
- Mensajería intacta tras el despliegue: 8 entrantes, 9 salientes, **0 fallidos**
  en 3 h.
- `SESSION_SECRET` cargado en `wa-inbox-v2` y en `ind-inbox-v2` (7-ago).
- ⚠️ **Antes de la Tarea 6 hay que repartir el permiso.** Medido en la base ese
  día: de 14 personas, **solo 2 tienen `INBOX_MANDARINA`** (Andrés Admin y Xavier
  Castillo). Rodrigo, Camila y todas las vendedoras lo tienen vacío. Si se
  enciende `bloquear` así, el equipo entero queda fuera del inbox.
- ⚠️ El push de `fdf70f4` **no disparó build solo** — hubo que correr
  `vercel --prod --yes`. Vale la pena mirar antes de suponer que un push desplegó.

## Global Constraints

- **Repo: `C:\Users\RodrigoWork\Desktop\wa-inbox-next`** (proyecto Vercel `wa-inbox-v2`). Producción = `main`.
- **BAJO NINGÚN CONCEPTO puede afectarse el envío o la recepción de mensajes, ni la creación de pedidos.** Es la regla que manda sobre cualquier otra decisión de este plan.
- Trabajar **siempre en `main`**, sin ramas. Commit apenas algo funcione; push antes de cerrar.
- Valores exactos:
  - Cookie: `mp_sesion`. Permiso: `INBOX_MANDARINA`. Login: `https://crm.apps.mandarinaec.com`.
  - Rutas públicas (del inventario medido): `/api/webhook`, `/api/social/webhook`, `/api/cron/seguimientos`, `/api/pago-dlocal`.
  - Interruptor: `AUTH_MODO` con `observar` · `bloquear` · `apagado`. **Sin la variable, el valor por defecto es `observar`** — el despliegue nunca bloquea por sí solo.
- `SESSION_SECRET` en `wa-inbox-v2` tiene que ser **el mismo valor** que en `mandarina-pro-sales`, y se lee limpiando el BOM con `replace(/[^\x21-\x7E]/g, '')`.
- El middleware corre en **Edge**: nada de `node:crypto`, `@supabase/supabase-js` ni APIs de Node. Solo Web Crypto y `fetch`.
- ⚠️ **Toda lectura a Supabase lleva `cache: 'no-store'`.** Sin eso, Next devuelve congelada la primera respuesta GET y el permiso se quedaría pegado para siempre.
- Español ecuatoriano con tuteo en comentarios, commits y textos de pantalla. Nada de voseo.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `lib/sesion.js` | verificar la firma de la cookie (copia EXACTA de la del CRM) | 1 |
| `tests/sesion.test.js` | ida y vuelta de firma con el mismo secreto | 1 |
| `lib/rutas-publicas.js` | única lista de rutas que nunca piden sesión | 2 |
| `tests/rutas-publicas.test.js` | las 35 rutas reales del inventario, una por una | 2 |
| `lib/acceso.js` | leer `crm.usuarios` y decidir si esa persona entra | 3 |
| `middleware.js` | la puerta, con sus tres modos | 4 |
| `next.config.js` | redirección de las páginas del host viejo al nuevo | 5 |

---

## Task 1: La verificación de sesión en el inbox

El inbox **solo verifica**, nunca emite cookies: eso lo hace el CRM. Pero el archivo se copia **entero y sin cambios**, siguiendo el criterio que este código ya usa con `lib/capi.js`: idéntico a propósito, para que una desincronización se vea de un vistazo.

**Files:**
- Create: `lib/sesion.js` (copia de `C:\Users\RodrigoWork\Desktop\MANDARINACRM\lib\sesion.js`)
- Create: `tests/sesion.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `verificarSesion(token: string, secreto: string): Promise<{id, rol, exp} | null>` y `secretoSesion(): string`, `COOKIE_SESION = 'mp_sesion'`.

- [x] **Step 1: Copiar el archivo tal cual**

```bash
cd /c/Users/RodrigoWork/Desktop/wa-inbox-next
cp /c/Users/RodrigoWork/Desktop/MANDARINACRM/lib/sesion.js lib/sesion.js
```

No se le quita nada, ni siquiera `cookieSesion`/`cookieBorrada`, que el inbox no usa.

- [x] **Step 2: Agregar la nota de que es una copia**

Justo debajo del comentario de cabecera que ya trae el archivo, agregar:

```js
// ⚠️ COPIA EXACTA de MANDARINACRM/lib/sesion.js. Se mantiene idéntico A PROPÓSITO:
// el CRM emite la cookie y este inbox la verifica, así que si los dos archivos se
// desincronizan, las sesiones dejan de validar sin ningún error visible. Mismo
// criterio que lib/capi.js entre los dos inbox. Si tocas uno, toca el otro.
//
// Acá solo se usan verificarSesion() y secretoSesion(): el inbox NUNCA emite
// cookies. cookieSesion()/cookieBorrada() se conservan para que el archivo siga
// siendo comparable línea por línea con el del CRM.
```

- [x] **Step 3: Escribir la prueba que falla**

Crear `tests/sesion.test.js`:

```js
// El CRM firma la cookie y este inbox la verifica. Si estas pruebas fallan,
// nadie puede entrar al inbox aunque el login del CRM funcione.
import test from 'node:test'
import assert from 'node:assert'
import { firmarSesion, verificarSesion, COOKIE_SESION } from '../lib/sesion.js'

const SECRETO = 'secreto-de-prueba-no-es-el-de-produccion'

test('un token firmado con el mismo secreto se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO)
  const datos = await verificarSesion(token, SECRETO)
  assert.strictEqual(datos.id, 'U1')
  assert.strictEqual(datos.rol, 'ADMIN')
})

test('con OTRO secreto no se verifica', async () => {
  // Es el caso real de tener SESSION_SECRET distinto en los dos proyectos de Vercel.
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO)
  assert.strictEqual(await verificarSesion(token, 'otro-secreto'), null)
})

test('un token alterado no se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'VENDEDOR' }, SECRETO)
  const [cuerpo, firma] = token.split('.')
  const falso = Buffer.from(JSON.stringify({ id: 'U1', rol: 'ADMIN', exp: Date.now() + 1e6 }))
    .toString('base64url')
  assert.strictEqual(await verificarSesion(`${falso}.${firma}`, SECRETO), null)
})

test('un token caducado no se verifica', async () => {
  const token = await firmarSesion({ id: 'U1', rol: 'ADMIN' }, SECRETO, -1)
  assert.strictEqual(await verificarSesion(token, SECRETO), null)
})

test('basura y vacío devuelven null, sin lanzar', async () => {
  assert.strictEqual(await verificarSesion('', SECRETO), null)
  assert.strictEqual(await verificarSesion('no-es-un-token', SECRETO), null)
  assert.strictEqual(await verificarSesion(null, SECRETO), null)
})

test('el nombre de la cookie es el mismo que emite el CRM', () => {
  // Si esto cambia, el inbox busca una cookie que nadie pone.
  assert.strictEqual(COOKIE_SESION, 'mp_sesion')
})
```

- [x] **Step 4: Correr y ver que pasa**

```bash
npm test
```

Esperado: las 6 nuevas en verde, más las que ya existían en `tests/`.

- [x] **Step 5: Commit**

```bash
git add lib/sesion.js tests/sesion.test.js
git commit -m "feat(sesion): verificar en el inbox la cookie que emite el CRM"
git push origin main
```

> Este despliegue **no cambia nada** todavía: el archivo existe pero nadie lo llama.

---

## Task 2: La lista de rutas públicas

Sale del inventario medido (`docs/INVENTARIO-RUTAS-2026-08-07.md`). Vive en su propio archivo para poder probarla sin levantar el middleware.

**Files:**
- Create: `lib/rutas-publicas.js`
- Create: `tests/rutas-publicas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `esRutaPublica(pathname: string): boolean` y `RUTAS_PUBLICAS: string[]`.

- [x] **Step 1: Escribir las pruebas que fallan**

Crear `tests/rutas-publicas.test.js`. **Las 35 rutas del inventario, una por una** — si alguien agrega una ruta pública sin pensarlo, esta prueba se lo dice:

```js
// La lista de rutas públicas es lo más delicado de todo el candado: una de menos
// y dejas de recibir mensajes de Meta. Estas pruebas son el inventario del
// 7-ago-2026 convertido en red de seguridad.
import test from 'node:test'
import assert from 'node:assert'
import { esRutaPublica } from '../lib/rutas-publicas.js'

// Las 4 que NUNCA pueden pedir sesión. Cada una se defiende sola.
const PUBLICAS = [
  '/api/webhook',            // Meta (WhatsApp) — 1035 llamadas en 24h
  '/api/social/webhook',     // Meta (FB/IG)
  '/api/cron/seguimientos',  // cron de Vercel, cada hora
  '/api/pago-dlocal',        // dLocal, ya protegida con secreto en la URL
]

// Todo lo demás del inventario: son del navegador y van protegidas.
const PROTEGIDAS = [
  '/api/automatizaciones', '/api/buscar', '/api/capi/diag', '/api/cliente-pedidos',
  '/api/contactos', '/api/contactos/estado', '/api/conversacion', '/api/dashboard',
  '/api/directorio', '/api/hilo', '/api/inbox-sync', '/api/lista', '/api/media',
  '/api/media/precache', '/api/media/upload', '/api/mensaje', '/api/mensajes',
  '/api/notas', '/api/plantillas', '/api/push/subscribe', '/api/push/test',
  '/api/respuestas', '/api/saliente', '/api/social/estado', '/api/social/ingest',
  '/api/social/lista', '/api/social/media', '/api/social/saliente', '/api/tienda',
  '/api/upload-foto', '/api/upload-url',
  '/inbox', '/dashboard',
]

for (const ruta of PUBLICAS) {
  test(`PÚBLICA: ${ruta}`, () => {
    assert.strictEqual(esRutaPublica(ruta), true, `${ruta} tiene que quedar abierta`)
  })
}

for (const ruta of PROTEGIDAS) {
  test(`PROTEGIDA: ${ruta}`, () => {
    assert.strictEqual(esRutaPublica(ruta), false, `${ruta} NO puede quedar abierta`)
  })
}

test('el prefijo no alcanza para colarse', () => {
  // /api/webhook-falso NO es /api/webhook. Si se compara con startsWith a secas,
  // cualquiera abre una puerta agregándole texto al final.
  assert.strictEqual(esRutaPublica('/api/webhook-falso'), false)
  assert.strictEqual(esRutaPublica('/api/webhookeria'), false)
})

test('las subrutas de una pública SÍ son públicas', () => {
  // Meta puede llamar con subruta; el cron también.
  assert.strictEqual(esRutaPublica('/api/webhook/'), true)
  assert.strictEqual(esRutaPublica('/api/cron/seguimientos'), true)
})

test('la barra final no cambia la decisión', () => {
  assert.strictEqual(esRutaPublica('/api/hilo/'), false)
})
```

- [x] **Step 2: Correr y ver que falla**

```bash
npm test
```

Esperado: FALLA — `lib/rutas-publicas.js` no existe.

- [x] **Step 3: Implementar**

Crear `lib/rutas-publicas.js`:

```js
// Las ÚNICAS rutas del inbox que nunca piden sesión, porque quien las llama no
// puede tener una. Salen del inventario medido del 7-ago-2026
// (docs/INVENTARIO-RUTAS-2026-08-07.md), no de la memoria de nadie.
//
// Cada una se defiende sola:
//   /api/webhook          → firma de Meta con META_APP_SECRET
//   /api/social/webhook   → firma de Meta con META_APP_SECRET
//   /api/cron/seguimientos→ CRON_SECRET
//   /api/pago-dlocal      → secreto compartido en la URL (verificado: 401 sin él)
//
// ⚠️ Agregar algo acá es abrir una puerta al internet entero. Si alguna vez hay
// que hacerlo, que sea con tráfico medido en la mano, como se hizo con esta lista.
export const RUTAS_PUBLICAS = [
  '/api/webhook',
  '/api/social/webhook',
  '/api/cron/seguimientos',
  '/api/pago-dlocal',
]

/**
 * ¿Esta ruta queda fuera del candado?
 *
 * Compara la ruta completa o una subruta con separador, NUNCA con `startsWith`
 * a secas: si no, `/api/webhook-falso` pasaría por ser `/api/webhook`.
 */
export function esRutaPublica(pathname) {
  const p = String(pathname || '')
  return RUTAS_PUBLICAS.some((r) => p === r || p.startsWith(r + '/'))
}
```

- [x] **Step 4: Correr las pruebas**

```bash
npm test
```

Esperado: las 40 nuevas en verde (4 públicas + 33 protegidas + 3 de bordes), más las de la Tarea 1.

- [x] **Step 5: Commit**

```bash
git add lib/rutas-publicas.js tests/rutas-publicas.test.js
git commit -m "feat(auth): lista de rutas publicas del inbox, salida del inventario medido"
git push origin main
```

---

## Task 3: Decidir si esa persona entra

**Files:**
- Create: `lib/acceso.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `puedeEntrar(usuarioId: string): Promise<{ok: boolean, motivo: string}>`. `motivo` es uno de `'ok'`, `'sin-usuario'`, `'inactivo'`, `'sin-permiso'`, `'error-consulta'`.

> **Por qué `fetch` y no `@supabase/supabase-js`:** el middleware corre en Edge, donde el cliente pesa y arrastra el `fetch` parcheado de Next, que **cachea las respuestas GET y devolvería el permiso congelado para siempre**. Ese bug ya costó siete diagnósticos equivocados en este proyecto. Con `fetch` directo y `cache: 'no-store'` el problema no existe.

- [x] **Step 1: Implementar**

Crear `lib/acceso.js`:

```js
// ¿Esta persona puede entrar a ESTE inbox?
//
// La sesión firmada solo dice QUIÉN es (`{ id, rol }`). El permiso se relee de
// `crm.usuarios` en CADA petición, a propósito: es la única forma de que quitarle
// el acceso a alguien surta efecto de inmediato. Si viajara dentro del token,
// duraría los 30 días de la sesión.
//
// Costo medido el 7-ago-2026: la tabla tiene 14 filas y 128 kB, la consulta se
// ejecuta en 0,125 ms y cabe entera en memoria. Lo que cuesta es el viaje de red,
// en rutas que ya hablan con Supabase de todos modos.

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** Permiso que exige este inbox. MANDI = INBOX_MANDARINA; IND usará INBOX_INDSTORE. */
export const PERMISO = process.env.INBOX_PERMISO || 'INBOX_MANDARINA'

export async function puedeEntrar(usuarioId) {
  if (!usuarioId) return { ok: false, motivo: 'sin-usuario' }
  if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false, motivo: 'error-consulta' }

  const url = `${SUPABASE_URL}/rest/v1/usuarios`
    + `?usuario_id=eq.${encodeURIComponent(usuarioId)}`
    + `&select=activo,accesos&limit=1`

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        // La tabla vive en el schema `crm`, no en el `inbox` de siempre.
        'Accept-Profile': 'crm',
      },
      // ⚠️ Sin esto Next cachea el GET y devuelve el primer permiso PARA SIEMPRE:
      // revocarle el acceso a alguien no surtiría efecto nunca.
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, motivo: 'error-consulta' }

    const filas = await res.json()
    const u = Array.isArray(filas) ? filas[0] : null
    if (!u) return { ok: false, motivo: 'sin-usuario' }
    if (u.activo !== true) return { ok: false, motivo: 'inactivo' }

    const accesos = Array.isArray(u.accesos) ? u.accesos : []
    if (!accesos.includes(PERMISO)) return { ok: false, motivo: 'sin-permiso' }

    return { ok: true, motivo: 'ok' }
  } catch {
    // Si Supabase no responde, NO se deja pasar: el candado falla cerrado.
    return { ok: false, motivo: 'error-consulta' }
  }
}
```

- [x] **Step 2: Comprobar que compila**

```bash
npm run build
```

Esperado: compila. (No lleva prueba unitaria propia: es una llamada de red. Se verifica de punta a punta en la Tarea 6.)

- [x] **Step 3: Commit**

```bash
git add lib/acceso.js
git commit -m "feat(auth): releer el permiso de crm.usuarios en cada peticion"
git push origin main
```

---

## Task 4: El middleware, en modo observación

**Files:**
- Create: `middleware.js`

**Interfaces:**
- Consumes: `verificarSesion`, `secretoSesion` (T1); `esRutaPublica` (T2); `puedeEntrar` (T3).
- Produces: nada que otras tareas consuman.

- [x] **Step 1: Implementar**

Crear `middleware.js` en la raíz del repo:

```js
import { NextResponse } from 'next/server'
import { COOKIE_SESION, verificarSesion, secretoSesion } from '@/lib/sesion'
import { esRutaPublica } from '@/lib/rutas-publicas'
import { puedeEntrar } from '@/lib/acceso'

// ── La puerta del inbox ───────────────────────────────────────────────────────
// Hasta hoy esto era una URL pública: cualquiera que la conociera leía TODAS las
// conversaciones con las clientas y podía escribirles haciéndose pasar por
// Mandarina. El 6-ago se comprobó mandando un WhatsApp real desde una terminal,
// sin ninguna credencial.
//
// Tres puertas, igual que en el CRM:
//   1. PERSONA con sesión del CRM + permiso INBOX_MANDARINA en crm.usuarios
//   2. MÁQUINA con `Authorization: Bearer $INBOX_API_TOKEN`
//   3. RUTA PÚBLICA que se defiende sola (lib/rutas-publicas.js)
//
// ⚠️ AUTH_MODO manda sobre todo, y sin la variable el valor es `observar`:
//   observar → NO rechaza nada, solo anota lo que habría rechazado (arranca así)
//   bloquear → rechaza de verdad
//   apagado  → ni siquiera mira; es el interruptor de pánico
// ⚠️ Cambiar la variable NO basta: hay que redesplegar. Medido el 7-ago; el
// comentario completo, con el porqué y el comando, está en middleware.js.
const LOGIN = 'https://crm.apps.mandarinaec.com'

const modo = () => (process.env.AUTH_MODO || 'observar').trim().toLowerCase()

function tokenDeMaquina(req) {
  const esperado = String(process.env.INBOX_API_TOKEN || '').replace(/[^\x21-\x7E]/g, '')
  if (!esperado) return false
  const recibido = (req.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '').replace(/[^\x21-\x7E]/g, '')
  // Comparación de largo constante: el tiempo de respuesta no delata aciertos.
  if (recibido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < recibido.length; i++) dif |= recibido.charCodeAt(i) ^ esperado.charCodeAt(i)
  return dif === 0
}

export async function middleware(req) {
  if (modo() === 'apagado') return NextResponse.next()

  const { pathname } = req.nextUrl
  if (esRutaPublica(pathname)) return NextResponse.next()

  const esApi = pathname.startsWith('/api/')
  let motivo = null

  const secreto = secretoSesion()
  if (!secreto) {
    motivo = 'sin-SESSION_SECRET'
  } else {
    const sesion = await verificarSesion(req.cookies.get(COOKIE_SESION)?.value, secreto)
    if (!sesion) {
      motivo = tokenDeMaquina(req) ? null : 'sin-sesion'
    } else {
      const permiso = await puedeEntrar(sesion.id)
      if (!permiso.ok) motivo = permiso.motivo
    }
  }

  if (!motivo) return NextResponse.next()

  if (modo() !== 'bloquear') {
    // MODO OBSERVACIÓN: no se rechaza nada. Esta línea es el insumo para decidir
    // si ya se puede bloquear; se lee en los registros de Vercel buscando
    // "[auth] rechazaria".
    console.log(`[auth] rechazaria ${req.method} ${pathname} — ${motivo}`)
    return NextResponse.next()
  }

  if (esApi) return NextResponse.json({ error: 'No autenticado', motivo }, { status: 401 })

  if (motivo === 'sin-permiso' || motivo === 'inactivo') {
    return new NextResponse(
      'No tienes acceso a este inbox. Pídele a un administrador que te habilite INBOX MANDARINA en el CRM.',
      { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  const volver = `${req.nextUrl.origin}${pathname}${req.nextUrl.search}`
  return NextResponse.redirect(`${LOGIN}/?volver=${encodeURIComponent(volver)}`)
}

// Los webhooks quedan fuera ACÁ, a nivel de configuración: así el código de
// sesión ni siquiera corre para ellos. `lib/rutas-publicas.js` es la segunda
// capa, por si alguien toca esto sin pensar.
export const config = {
  matcher: [
    '/((?!api/webhook|api/social/webhook|api/cron/seguimientos|api/pago-dlocal|_next/static|_next/image|favicon.ico|sw.js|icon-|manifest.webmanifest).*)',
  ],
}
```

- [x] **Step 2: Comprobar que compila y que las pruebas siguen bien**

```bash
npm run build && npm test
```

- [x] **Step 3: Commit**

```bash
git add middleware.js
git commit -m "feat(auth): puerta del inbox en modo observacion (no rechaza nada todavia)"
git push origin main
```

- [x] **Step 4: Poner las variables en Vercel (proyecto `wa-inbox-v2`, Production)**

| Variable | Valor |
|---|---|
| `SESSION_SECRET` | **el mismo valor exacto** que en `mandarina-pro-sales` |
| `AUTH_MODO` | `observar` |

`SESSION_SECRET` hay que copiarlo a mano desde el panel del CRM: Vercel no deja leer variables cifradas por CLI. **Si los dos valores no coinciden, nadie podrá entrar cuando se active el bloqueo** — y en modo observación no se nota, porque no rechaza nada.

- [x] **Step 5: Comprobar que NADA cambió**

```bash
curl -sS -o /dev/null -w "inbox   -> %{http_code}\n" https://inbox.apps.mandarinaec.com/api/plantillas?canal=1024077200794372
curl -sS -o /dev/null -w "webhook -> %{http_code}\n" https://wa-inbox-v2.vercel.app/api/webhook
```

Esperado: iguales que antes del despliegue. En modo observación **todo tiene que seguir pasando**.

---

## Task 5: Mandar las páginas del host viejo al nuevo

Va **antes** de bloquear, a propósito. La cookie tiene `Domain=.apps.mandarinaec.com`, así que **`wa-inbox-v2.vercel.app` nunca la va a recibir**: si se bloquea con gente todavía usando esa URL, caen en el mismo bucle de login silencioso que tumbó al CRM el 7-ago. Moviéndolos antes, para cuando el candado se active ya están del lado bueno.

**Files:**
- Modify: `next.config.js`

**Interfaces:** ninguna.

- [ ] **Step 1: Agregar la redirección**

En `next.config.js`, dentro del objeto de configuración:

```js
  // Las PÁGINAS del host viejo se mandan al dominio nuevo, porque la cookie de
  // sesión solo viaja a *.apps.mandarinaec.com y ahí nunca llegaría.
  // Las rutas de API NO se tocan: por `/api/webhook` entra Meta y por
  // `/api/pago-dlocal` entra dLocal, las dos apuntando al host viejo.
  async redirects() {
    return [{
      source: '/:path((?!api/).*)',
      has: [{ type: 'host', value: 'wa-inbox-v2.vercel.app' }],
      destination: 'https://inbox.apps.mandarinaec.com/:path',
      permanent: false,   // 307: si algún día hay que revertir, nadie quedó con el 308 cacheado
    }]
  },
```

`permanent: false` a propósito: un 308 se queda cacheado en los navegadores y revertirlo es un dolor.

- [ ] **Step 2: Comprobar que compila**

```bash
npm run build
```

- [ ] **Step 3: Commit y desplegar**

```bash
git add next.config.js
git commit -m "feat(dominio): mandar las paginas del host viejo al nuevo, sin tocar las APIs"
git push origin main
```

- [ ] **Step 4: Verificar que las APIs del host viejo NO se redirigieron**

```bash
curl -sS -o /dev/null -w "webhook viejo   -> %{http_code}\n" https://wa-inbox-v2.vercel.app/api/webhook
curl -sS -o /dev/null -w "plantillas viejo-> %{http_code}\n" https://wa-inbox-v2.vercel.app/api/plantillas
curl -sS -o /dev/null -w "pagina vieja    -> %{http_code}\n" https://wa-inbox-v2.vercel.app/inbox
```

Esperado: los dos primeros **iguales que antes** (403 y 200). El tercero, **307** hacia el dominio nuevo.

⚠️ Si `/api/webhook` empezó a devolver 307, **revertir de inmediato**: Meta no sigue redirecciones y se estarían perdiendo mensajes.

- [ ] **Step 5: Confirmar que siguen entrando mensajes**

```sql
select count(*) filter (where direccion='ENTRANTE') as entrantes,
       max(fecha) as ultimo
from inbox.mensajes where fecha > now() - interval '30 minutes';
```

Esperado: sigue subiendo. Si se congeló, revertir.

---

## Task 6: La ventana de observación y el encendido

No es una tarea de código: es la que decide si el candado se puede cerrar.

**Files:** ninguno (variables de entorno y verificación).

- [ ] **Step 1: Dejar correr 24-48 h, incluyendo un fin de semana si se puede**

Con `AUTH_MODO=observar` en producción.

- [ ] **Step 2: Leer lo que el middleware anotó**

Con las herramientas de Vercel, sobre el proyecto `wa-inbox-v2`, entorno `production`, buscando el texto `[auth] rechazaria`, con la ventana más ancha que aguante la consulta.

Agrupar por ruta y por motivo. **Lo esperado es una lista larga de `sin-sesion` en rutas del navegador** (hoy nadie tiene sesión todavía, es normal). Lo que hay que buscar es otra cosa:

- ¿Aparece alguna ruta que el inventario dio por **pública**? → el `matcher` está mal.
- ¿Aparece `/api/conversacion`? → **alguien sí la usaba**; no borrarla y averiguar quién.
- ¿Aparece alguna ruta que nadie reconoce? → hay un llamador que el inventario no vio. **Ese es exactamente el motivo por el que existe esta ventana.**

- [ ] **Step 3: Que todo el mundo entre por el dominio nuevo**

Antes de bloquear: avisarle al equipo que use `https://inbox.apps.mandarinaec.com` y que **vuelva a aceptar los avisos push**, que se re-piden por ser otro origen.

- [ ] **Step 4: Encender el bloqueo**

En Vercel, proyecto `wa-inbox-v2`, Production: `AUTH_MODO=bloquear`. Redesplegar.

- [ ] **Step 5: Verificar, en este orden**

```bash
# 1. Sin cookie, la API rechaza
curl -sS -o /dev/null -w "api sin sesion -> %{http_code}\n" https://inbox.apps.mandarinaec.com/api/lista
# esperado: 401

# 2. Los webhooks SIGUEN abiertos
curl -sS -o /dev/null -w "webhook        -> %{http_code}\n" https://wa-inbox-v2.vercel.app/api/webhook
# esperado: 403 (la verificación de Meta), NO 401 ni 307
```

Y a mano, en el navegador:

1. Entrar a `https://inbox.apps.mandarinaec.com` sin sesión → manda al login del CRM y **vuelve al inbox** después de entrar.
2. Con una cuenta **sin** `INBOX_MANDARINA` → el mensaje de "no tienes acceso", no una pantalla en blanco.
3. Con una cuenta **con** el permiso → el inbox funciona completo: abrir un chat, ver fotos, escribir.

- [ ] **Step 6: La prueba que de verdad cierra la fase**

**Recibir un mensaje desde un celular y contestarlo desde el inbox.** Después:

```sql
select direccion, fecha, estado_entrega, left(coalesce(texto,''),40) as texto
from inbox.mensajes where fecha > now() - interval '15 minutes' order by fecha desc limit 5;
```

Esperado: el entrante y el saliente, con `estado_entrega` en `delivered` o `read`. **Si el saliente sale `failed` o no aparece, poner `AUTH_MODO=apagado` y diagnosticar.**

- [ ] **Step 7: Revisar que no se rompió nada más**

```sql
select count(*) filter (where direccion='ENTRANTE') as entrantes,
       count(*) filter (where direccion='SALIENTE') as salientes,
       count(*) filter (where direccion='SALIENTE' and estado_entrega='failed') as fallidos
from inbox.mensajes where fecha > now() - interval '3 hours';
```

Esperado: `fallidos = 0` y los otros dos subiendo.

---

## Verificación de la fase completa

- [ ] `npm test` en verde.
- [ ] Sin sesión: la API del inbox devuelve 401 y las páginas mandan al login del CRM.
- [ ] Con sesión pero sin permiso: mensaje claro, no pantalla en blanco.
- [ ] Con permiso: el inbox funciona completo.
- [ ] `/api/webhook` y `/api/pago-dlocal` **siguen respondiendo igual que antes** desde el host viejo.
- [ ] Un mensaje real entra y sale, con `delivered` confirmado.
- [ ] 3 h de tráfico posterior con `fallidos = 0`.
- [x] `AUTH_MODO=apagado` revierte todo (probado a propósito el 7-ago, antes de necesitarlo). **Resultado: NO revierte sin desplegar — hay que redesplegar.** Justo para esto servía probarlo antes.

## Lo que queda para después

- **Fase 3** — PEDIDO MANUAL: `nuevo-pedido` del CRM incrustada en el panel derecho.
- **Fase 4** — cerrar `mandi-agent/api/crear-pedido.js`, hoy abierto al mundo, y hacerle firmar quién vendió.
- **Fase 5** — repetir esto en `ind-inbox-next` con `INBOX_INDSTORE`. `lib/acceso.js` ya lo contempla con `INBOX_PERMISO`.
- Decidir qué hacer con `/api/conversacion` según lo que muestre la ventana de observación.
