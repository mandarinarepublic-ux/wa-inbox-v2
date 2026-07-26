# Avisos de mensajes nuevos por Web Push — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el inbox MANDI avise con sonido y popup del sistema cuando entra un mensaje de un cliente, incluso con el navegador cerrado.

**Architecture:** Web push estándar (VAPID) sin proveedor externo. El webhook de Meta, que ya guarda el mensaje entrante, dispara además un push a cada aparato suscrito. El service worker que ya existe recibe el push y muestra la notificación; si el inbox está al frente la suprime, y en todo caso avisa a las pestañas abiertas para que refresquen.

**Tech Stack:** Next.js 14 (App Router, runtime Node), Supabase (schema `inbox`), `web-push`, Service Worker API, `node:test` para las pruebas unitarias.

**Spec:** `docs/superpowers/specs/2026-07-26-push-avisos-mensajes-nuevos-design.md`

## Global Constraints

- **Solo la línea MANDI.** REPUBLIC y SOCIAL quedan fuera de este plan.
- **El webhook es crítico y no puede romperse.** Todo el código nuevo que toque
  `app/api/webhook/route.js` va dentro de `waitUntil` y con `.catch()`. Un fallo del
  push jamás puede afectar el 200 a Meta ni el guardado del mensaje.
- **Sin claves VAPID configuradas, `enviarPush` es un no-op silencioso.** Esto permite
  desplegar el código antes de configurar nada. Es un requisito, no una comodidad.
- **El enfriamiento se guarda en la base**, nunca en memoria: las funciones de Vercel
  son efímeras y un `Set` en RAM produce avisos duplicados desde instancias frías.
- **El cliente Supabase ya apunta al schema `inbox`** (`lib/supabase.js:30`), así que
  `sb.from('push_subs')` resuelve a `inbox.push_subs`. No anteponer el schema.
- **`public/sw.js` NO debe recibir un handler de `fetch`.** El archivo declara en su
  cabecera que nunca intercepta `/api/*`; esa propiedad se conserva.
- **Las variables de entorno se cargan desde el panel web de Vercel, a mano.**
  Cargarlas por PowerShell les pega un BOM invisible que revienta solo en producción.
- **Comandos de prueba:** `node --test tests/push.test.js`. La forma `node --test tests/`
  falla en Windows. El warning `MODULE_TYPELESS_PACKAGE_JSON` es esperado e inofensivo.

---

### Task 1: Migración de base de datos

**Files:**
- Create: `docs/sql/2026-07-26-push-subs.sql` (registro de lo aplicado)

**Interfaces:**
- Produces: tabla `inbox.push_subs` (`endpoint` PK, `p256dh`, `auth`, `user_agent`,
  `creado`, `fallos`) y columna `inbox.conversaciones.ultimo_push_at timestamptz`.

- [ ] **Step 1: Escribir el SQL**

Crear `docs/sql/2026-07-26-push-subs.sql`:

```sql
-- Suscripciones de web push (un aparato/navegador por fila).
create table if not exists inbox.push_subs (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  creado      timestamptz not null default now(),
  fallos      int not null default 0
);

-- Enfriamiento del aviso, por conversación. Misma convención que
-- ultimo_seguimiento_at y alerta_ventana_at.
alter table inbox.conversaciones
  add column if not exists ultimo_push_at timestamptz;

-- PostgREST cachea el esquema: sin esto la tabla nueva da 404 hasta el
-- siguiente reinicio.
notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar la migración**

Aplicarla en el proyecto Supabase `piingkecjgoisnxccvaa` (mandarina-DATA) con la
herramienta `apply_migration`, nombre `push_subs_y_ultimo_push_at`.

- [ ] **Step 3: Verificar que quedó**

Ejecutar:

```sql
select column_name from information_schema.columns
where table_schema='inbox' and table_name='push_subs' order by ordinal_position;

select column_name from information_schema.columns
where table_schema='inbox' and table_name='conversaciones' and column_name='ultimo_push_at';
```

Esperado: 6 columnas en `push_subs`, y una fila `ultimo_push_at`.

- [ ] **Step 4: Commit**

```bash
git add docs/sql/2026-07-26-push-subs.sql
git commit -m "feat(avisos): tabla push_subs y columna ultimo_push_at"
```

---

### Task 2: `lib/push.js` — envío, formato y enfriamiento

**Files:**
- Create: `lib/push.js`
- Create: `tests/push.test.js`
- Modify: `package.json` (dependencia `web-push` + script `test`)

**Interfaces:**
- Consumes: `getSupabase` de `lib/supabase.js`; tabla `inbox.push_subs` de la Task 1.
- Produces:
  - `pushConfigurado(): boolean`
  - `recortar(texto: string, max?: number): string`
  - `cuerpoDeMensaje({ tipo: string, contenido: string }): string`
  - `debeNotificar(ultimoPushAt: string|null, ahoraMs: number, ventanaMs?: number): boolean`
  - `enviarPush({ titulo, cuerpo, url, tag, tel }): Promise<{ok, enviados, borradas?}>`
  - `ENFRIAMIENTO_MS: number` (300000)

- [ ] **Step 1: Instalar la dependencia**

```bash
npm install web-push@^3.6.7
```

- [ ] **Step 2: Agregar el script de test a `package.json`**

En el bloque `"scripts"`, agregar:

```json
"test": "node --test tests/push.test.js"
```

- [ ] **Step 3: Escribir el test que falla**

Crear `tests/push.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { recortar, cuerpoDeMensaje, debeNotificar, ENFRIAMIENTO_MS } from '../lib/push.js'

test('recortar deja los textos cortos intactos', () => {
  assert.equal(recortar('hola'), 'hola')
})

test('recortar colapsa espacios y saltos de linea', () => {
  assert.equal(recortar('hola   \n  mundo'), 'hola mundo')
})

test('recortar corta y agrega puntos suspensivos', () => {
  const largo = 'a'.repeat(200)
  const r = recortar(largo, 10)
  assert.equal(r.length, 10)
  assert.ok(r.endsWith('…'))
})

test('recortar tolera null y undefined', () => {
  assert.equal(recortar(null), '')
  assert.equal(recortar(undefined), '')
})

test('cuerpoDeMensaje usa el texto cuando es un mensaje de texto', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: 'quiero el vestido' }), 'quiero el vestido')
})

test('cuerpoDeMensaje describe una foto sin caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: '' }), '📷 Foto')
})

test('cuerpoDeMensaje combina descriptor y caption', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'imagen', contenido: 'esta talla' }), '📷 Foto · esta talla')
})

test('cuerpoDeMensaje nunca queda vacio', () => {
  assert.equal(cuerpoDeMensaje({ tipo: 'texto', contenido: '   ' }), 'Mensaje nuevo')
})

test('debeNotificar deja pasar la primera vez', () => {
  assert.equal(debeNotificar(null, Date.now()), true)
})

test('debeNotificar bloquea dentro del enfriamiento', () => {
  const ahora = Date.parse('2026-07-26T12:00:00Z')
  const hace1min = new Date(ahora - 60_000).toISOString()
  assert.equal(debeNotificar(hace1min, ahora), false)
})

test('debeNotificar deja pasar despues del enfriamiento', () => {
  const ahora = Date.parse('2026-07-26T12:00:00Z')
  const hace6min = new Date(ahora - 6 * 60_000).toISOString()
  assert.equal(debeNotificar(hace6min, ahora), true)
})

test('debeNotificar ignora una fecha corrupta y deja pasar', () => {
  assert.equal(debeNotificar('no-es-fecha', Date.now()), true)
})

test('el enfriamiento es de 5 minutos', () => {
  assert.equal(ENFRIAMIENTO_MS, 5 * 60 * 1000)
})
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/push.js'`

- [ ] **Step 5: Escribir `lib/push.js`**

```js
// lib/push.js — Web push de avisos de mensajes nuevos (línea MANDI).
//
// Sin claves VAPID configuradas, enviarPush() es un NO-OP silencioso: así se puede
// desplegar el código antes de configurar nada, sin riesgo para el webhook.
//
// Config (Vercel, cargar desde el PANEL WEB — por PowerShell les pega un BOM que
// revienta solo en producción):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import webpush from 'web-push'
import { getSupabase } from './supabase.js'

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:mandarinarepublic@outlook.com'

/** Un aviso por conversación cada 5 minutos. */
export const ENFRIAMIENTO_MS = 5 * 60 * 1000

export function pushConfigurado() {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE)
}

let _listo = false
function configurar() {
  if (_listo) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  _listo = true
}

/** Texto en una línea y acotado: el payload de un push tiene límite de tamaño. */
export function recortar(texto, max = 120) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1).trimEnd() + '…'
}

const DESCRIPTOR = {
  imagen:    '📷 Foto',
  video:     '🎥 Video',
  audio:     '🎤 Audio',
  documento: '📄 Documento',
  sticker:   '💟 Sticker',
}

/** Cuerpo legible del aviso a partir del mensaje entrante. Nunca vacío. */
export function cuerpoDeMensaje({ tipo, contenido }) {
  const txt = recortar(contenido)
  if (tipo === 'texto') return txt || 'Mensaje nuevo'
  const d = DESCRIPTOR[tipo]
  if (!d) return txt || 'Mensaje nuevo'
  return txt ? `${d} · ${txt}` : d
}

/**
 * ¿Toca avisar de esta conversación? Bloquea si ya avisamos hace menos de la
 * ventana. Una fecha nula o corrupta deja pasar: mejor un aviso de más que perder
 * un lead.
 */
export function debeNotificar(ultimoPushAt, ahoraMs, ventanaMs = ENFRIAMIENTO_MS) {
  if (!ultimoPushAt) return true
  const prev = Date.parse(ultimoPushAt)
  if (Number.isNaN(prev)) return true
  return ahoraMs - prev >= ventanaMs
}

/**
 * Manda el aviso a todos los aparatos suscritos. NUNCA lanza.
 * Las suscripciones muertas (404/410) se borran solas.
 */
export async function enviarPush({ titulo, cuerpo, url, tag, tel }) {
  if (!pushConfigurado()) return { ok: false, motivo: 'sin-vapid', enviados: 0 }
  try {
    configurar()
    const sb = getSupabase()
    const { data, error } = await sb.from('push_subs').select('*')
    if (error) { console.error('[push] leer subs:', error.message); return { ok: false, enviados: 0 } }
    const subs = data || []
    if (!subs.length) return { ok: true, enviados: 0 }

    const payload = JSON.stringify({
      titulo: String(titulo || 'Mensaje nuevo'),
      cuerpo: recortar(cuerpo, 120),
      url:    url || '/inbox',
      tag:    tag || '',
      tel:    tel || '',   // para que la pestaña abra ESE chat al tocar el aviso
    })

    const muertas = []
    let enviados = 0
    await Promise.allSettled(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        enviados++
      } catch (e) {
        const code = e?.statusCode
        // 404/410 = el navegador tiró la suscripción (datos limpiados, app desinstalada).
        if (code === 404 || code === 410) muertas.push(s.endpoint)
        else console.error('[push] envío falló:', code, e?.message)
      }
    }))

    if (muertas.length) {
      const { error: errDel } = await sb.from('push_subs').delete().in('endpoint', muertas)
      if (errDel) console.error('[push] limpiar muertas:', errDel.message)
    }
    return { ok: true, enviados, borradas: muertas.length }
  } catch (e) {
    console.error('[push] error inesperado:', e?.message || e)
    return { ok: false, enviados: 0 }
  }
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — 13 tests, 0 fallos.

- [ ] **Step 7: Commit**

```bash
git add lib/push.js tests/push.test.js package.json package-lock.json
git commit -m "feat(avisos): lib/push con envio, formato y enfriamiento"
```

---

### Task 3: Alta y baja de suscripciones

**Files:**
- Create: `app/api/push/subscribe/route.js`

**Interfaces:**
- Consumes: `getSupabase` de `lib/supabase.js`; tabla `inbox.push_subs`.
- Produces: `POST /api/push/subscribe` (body `{ subscription, clave }` → 200 `{ok:true}`
  o 401) y `DELETE /api/push/subscribe` (body `{ endpoint }` → 200 `{ok:true}`).

- [ ] **Step 1: Escribir la ruta**

Crear `app/api/push/subscribe/route.js`:

```js
import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Barrera mínima: el inbox no tiene login, así que sin esto cualquiera con la URL
// podría suscribirse y recibir los mensajes de los clientes en su teléfono.
// No es seguridad de verdad — el arreglo real es un login (ver el spec).
const CLAVE = process.env.PUSH_CLAVE || ''

export async function POST(req) {
  try {
    const { subscription, clave } = await req.json().catch(() => ({}))

    if (CLAVE && String(clave || '') !== CLAVE) {
      return NextResponse.json({ ok: false, error: 'clave incorrecta' }, { status: 401 })
    }
    const endpoint = subscription?.endpoint
    const p256dh   = subscription?.keys?.p256dh
    const auth     = subscription?.keys?.auth
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ ok: false, error: 'suscripción incompleta' }, { status: 400 })
    }

    const sb = getSupabase()
    const { error } = await sb.from('push_subs').upsert({
      endpoint, p256dh, auth,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
      fallos: 0,
    }, { onConflict: 'endpoint' })
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[/api/push/subscribe] POST:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'error interno' }, { status: 500 })
  }
}

// Darse de baja NO pide clave: siempre debe poder hacerse.
export async function DELETE(req) {
  try {
    const { endpoint } = await req.json().catch(() => ({}))
    if (!endpoint) return NextResponse.json({ ok: false, error: 'falta endpoint' }, { status: 400 })
    const sb = getSupabase()
    const { error } = await sb.from('push_subs').delete().eq('endpoint', endpoint)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[/api/push/subscribe] DELETE:', e?.message || e)
    return NextResponse.json({ ok: false, error: 'error interno' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build exitoso, sin errores de import.

- [ ] **Step 3: Commit**

```bash
git add app/api/push/subscribe/route.js
git commit -m "feat(avisos): alta y baja de suscripciones push"
```

---

### Task 4: Endpoint de prueba

**Files:**
- Create: `app/api/push/test/route.js`

**Interfaces:**
- Consumes: `enviarPush` de `lib/push.js`.
- Produces: `GET /api/push/test?key=<CRON_SECRET>` → `{ok, enviados, borradas}`.

Sin esto, probar el push exige que un cliente real escriba. Se protege con la misma
llave que ya usa el cron (`app/api/cron/seguimientos/route.js:25`).

- [ ] **Step 1: Escribir la ruta**

Crear `app/api/push/test/route.js`:

```js
import { NextResponse } from 'next/server'
import { enviarPush, pushConfigurado } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req) {
  const secret = process.env.CRON_SECRET
  const auth   = req.headers.get('authorization') || ''
  const keyQ   = new URL(req.url).searchParams.get('key')
  if (!secret || (auth !== `Bearer ${secret}` && keyQ !== secret)) {
    return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 })
  }

  if (!pushConfigurado()) {
    return NextResponse.json({ ok: false, error: 'faltan las claves VAPID' }, { status: 503 })
  }

  const r = await enviarPush({
    titulo: '🔔 Prueba de avisos',
    cuerpo: 'Si ves esto, los avisos del inbox funcionan.',
    url:    '/inbox',
    tag:    'prueba',
  })
  return NextResponse.json(r)
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build exitoso.

- [ ] **Step 3: Commit**

```bash
git add app/api/push/test/route.js
git commit -m "feat(avisos): endpoint de prueba de push"
```

---

### Task 5: Handlers de push en el service worker

**Files:**
- Modify: `public/sw.js`

**Interfaces:**
- Consumes: el payload JSON que manda `enviarPush` (`{titulo, cuerpo, url, tag, tel}`).
- Produces: dos `postMessage` a las ventanas abiertas —
  `{tipo:'push-recibido', url}` al recibir (lo consume la Task 8) y
  `{tipo:'abrir-chat', tel}` al hacer click (lo consume la Task 9).

- [ ] **Step 1: Agregar los handlers**

Reemplazar el contenido de `public/sw.js` por:

```js
// Service worker — habilita la instalación como app y recibe los avisos de push.
// NO tiene handler de fetch → nunca intercepta ni cachea /api/* (van a la red).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ── Avisos de mensajes nuevos ────────────────────────────────────────────────
// Si el inbox está al FRENTE no molestamos (lo pidió el usuario): igual avisamos a
// la pestaña para que refresque su contador.
//
// Ojo: el navegador espera que todo push recibido muestre algo. Suprimir consume un
// presupuesto; si se agota, Chrome muestra un genérico "Este sitio se actualizó en
// segundo plano". Si eso aparece, la salida es mostrar siempre.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = {} }

  const titulo = d.titulo || 'Mensaje nuevo'
  const cuerpo = d.cuerpo || ''
  const url    = d.url || '/inbox'
  const tag    = d.tag || 'inbox'
  const tel    = d.tel || ''

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    // Avisar SIEMPRE a las pestañas abiertas para que refresquen.
    for (const w of wins) {
      w.postMessage({ tipo: 'push-recibido', url })
    }

    // ¿Hay una ventana del inbox enfocada? Entonces el usuario ya está mirando.
    const mirando = wins.some((w) => w.focused)
    if (mirando) return

    await self.registration.showNotification(titulo, {
      body: cuerpo,
      tag,                       // un aviso por chat: el nuevo reemplaza al anterior
      renotify: true,            // pero vuelve a sonar
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url, tel },
    })
  })())
})

// Al tocar el aviso: si ya hay una pestaña del inbox abierta la enfocamos y le
// decimos por postMessage qué chat abrir (más confiable que navegar por URL, que en
// una app de una sola página puede no re-montar nada). Si no hay ninguna, abrimos
// una con ?tel= en el enlace, que la Task 9 lee al arrancar.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = event.notification.data?.url || '/inbox'
  const tel     = event.notification.data?.tel || ''

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus()
        w.postMessage({ tipo: 'abrir-chat', tel })
        return
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino)
  })())
})
```

- [ ] **Step 2: Verificar la sintaxis**

Run: `node --check public/sw.js`
Expected: sin salida (sintaxis correcta).

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat(avisos): handlers de push y click en el service worker"
```

---

### Task 6: Botón para activar los avisos

**Files:**
- Create: `components/PushToggle.jsx`
- Modify: `components/App.jsx` (importar y montar el botón; quitar `pedirPermisoNotif`)

**Interfaces:**
- Consumes: `POST/DELETE /api/push/subscribe` de la Task 3.
- Produces: componente `<PushToggle />` sin props.

Pedir el permiso **dentro del click** es el arreglo del hallazgo 5 del diagnóstico:
hoy se pide en un `useEffect` al montar (`App.jsx:399`) y Chrome lo silencia.

- [ ] **Step 1: Escribir el componente**

Crear `components/PushToggle.jsx`:

```jsx
'use client'
import { useEffect, useState } from 'react'

// La clave pública VAPID viaja al navegador como base64url y hay que convertirla
// al Uint8Array que espera pushManager.subscribe.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

export default function PushToggle() {
  const [estado, setEstado] = useState('cargando') // cargando|no-soportado|off|on|trabajando
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID) {
        if (vivo) setEstado('no-soportado')
        return
      }
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (vivo) setEstado(sub ? 'on' : 'off')
      } catch (e) {
        if (vivo) setEstado('off')
      }
    })()
    return () => { vivo = false }
  }, [])

  const activar = async () => {
    setMsg('')
    const clave = window.prompt('Clave para activar los avisos:')
    if (clave === null) return
    setEstado('trabajando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado('off')
        setMsg('Diste "bloquear". Hay que permitirlo desde el candado de la barra de direcciones.')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      })
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), clave }),
      })
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {})
        setEstado('off')
        setMsg(r.status === 401 ? 'Clave incorrecta.' : 'No se pudo registrar.')
        return
      }
      setEstado('on')
      setMsg('Avisos activados en este aparato.')
    } catch (e) {
      setEstado('off')
      setMsg('No se pudo activar: ' + (e?.message || 'error'))
    }
  }

  const desactivar = async () => {
    setEstado('trabajando')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setEstado('off')
      setMsg('Avisos apagados en este aparato.')
    } catch (e) {
      setEstado('on')
      setMsg('No se pudo apagar.')
    }
  }

  if (estado === 'no-soportado') return null

  const on = estado === 'on'
  const ocupado = estado === 'trabajando' || estado === 'cargando'

  return (
    <button
      onClick={on ? desactivar : activar}
      disabled={ocupado}
      title={msg || (on ? 'Avisos activados — click para apagarlos' : 'Activar avisos de mensajes nuevos')}
      style={{
        background: on ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.12)',
        border: `1px solid ${on ? 'rgba(16,185,129,.45)' : 'rgba(148,163,184,.3)'}`,
        color: on ? '#10b981' : '#94a3b8',
        borderRadius: 8, width: 28, height: 28,
        cursor: ocupado ? 'default' : 'pointer',
        fontSize: 13, opacity: ocupado ? .5 : 1,
      }}
    >
      {on ? '🔔' : '🔕'}
    </button>
  )
}
```

- [ ] **Step 2: Montarlo en la cabecera de MANDI**

En `components/App.jsx`, agregar el import junto a los demás (cerca de la línea 12):

```jsx
import PushToggle from '@/components/PushToggle'
```

Y montarlo junto al botón 👋 de automatizaciones (`App.jsx:1069`), inmediatamente
antes de ese `<button>`:

```jsx
<PushToggle />
```

- [ ] **Step 3: Quitar el pedido de permiso roto**

En `components/App.jsx`, borrar la línea 399:

```jsx
useEffect(() => { pedirPermisoNotif() }, [])
```

Y quitar `pedirPermisoNotif` del import de la línea 13, que queda:

```jsx
import { actualizarNoLeidos, notificar } from '@/lib/notif'
```

`notificar` se conserva: lo sigue usando la alerta de leads calientes (`App.jsx:413`).

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: build exitoso. Si aparece `'pedirPermisoNotif' is not defined`, quedó una
referencia sin borrar.

- [ ] **Step 5: Commit**

```bash
git add components/PushToggle.jsx components/App.jsx
git commit -m "feat(avisos): boton para activar avisos, con permiso pedido en el click"
```

---

### Task 7: Disparar el aviso desde el webhook

**Files:**
- Modify: `lib/inbox-supabase.js` (mapear `ultimo_push_at`, marcar el envío)
- Modify: `lib/contactos.js` (exponer `marcarPush`)
- Modify: `app/api/webhook/route.js` (disparar dentro de `procesar`)

**Interfaces:**
- Consumes: `enviarPush`, `cuerpoDeMensaje`, `debeNotificar` de `lib/push.js`.
- Produces: `marcarPushSupabase(telefono, ts?)` y `marcarPush(telefono, ts?)`; y el
  campo `ultimoPushAt` en el shape de contacto.

- [ ] **Step 1: Mapear el campo nuevo**

En `lib/inbox-supabase.js`, dentro de `toContacto` (línea 39), agregar después de
`alertaVentanaAt`:

```js
    ultimoPushAt: c.ultimo_push_at || null,           // último aviso de mensaje nuevo
```

- [ ] **Step 2: Agregar la función que marca el envío**

En `lib/inbox-supabase.js`, justo después de `marcarAlertaVentanaSupabase` (línea 114):

```js
export async function marcarPushSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'ultimo_push_at', ts || new Date().toISOString())
}
```

- [ ] **Step 3: Exponerla en la capa de contactos**

En `lib/contactos.js`, después de `marcarAlertaVentana` (línea 69):

```js
export async function marcarPush(telefono, ts = null) {
  if (typeof SB.marcarPushSupabase !== 'function') return { ok: false }
  return SB.marcarPushSupabase(telefono, ts)
}
```

- [ ] **Step 4: Enganchar en el webhook**

En `app/api/webhook/route.js`, agregar a los imports (después de la línea 8):

```js
import { enviarPush, cuerpoDeMensaje, debeNotificar } from '@/lib/push'
```

Y agregar `marcarPush` al import de contactos de la línea 3, que queda:

```js
import { registrarContactoEntrante, getContactos, updateEstado, updateModoIA, marcarPush } from '@/lib/contactos'
```

Dentro de `procesar()`, junto a los demás helpers del snapshot (después de
`ultimoEntranteAtDe`, línea 199), agregar:

```js
  // Último aviso push enviado por conversación (del snapshot de este ciclo).
  const ultimoPushAtDe = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c?.ultimoPushAt || null
  }
  // Anti doble-aviso dentro del mismo lote: el snapshot no se entera de lo que
  // acabamos de mandar hace dos mensajes.
  const avisados = new Set()

  // Aviso de mensaje nuevo. Nunca lanza: un fallo acá no puede tocar el webhook.
  async function avisarSiCorresponde(m) {
    const t = tail9(m.telefono)
    if (avisados.has(t)) return
    if (!debeNotificar(ultimoPushAtDe(m.telefono), Date.now())) return
    avisados.add(t)
    const nombre = m.nombre || m.telefono
    await enviarPush({
      titulo: `💬 ${nombre}`,
      cuerpo: cuerpoDeMensaje({ tipo: m.tipo, contenido: m.contenido }),
      url:    `/inbox?tel=${encodeURIComponent(m.telefono)}`,
      tag:    `chat-${t}`,
      tel:    m.telefono,
    })
    await marcarPush(m.telefono)
  }
```

Y dentro del bucle `for (const m of nuevos)`, inmediatamente después del bloque
`registrarContactoEntrante` (línea 252, el `catch` que cierra ese `try`), agregar:

```js
    // Aviso al equipo. Va después de registrarContactoEntrante para que la
    // conversación exista y se le pueda escribir ultimo_push_at.
    await avisarSiCorresponde(m)
      .catch(e => console.error('[/api/webhook] aviso push:', e.message))
```

- [ ] **Step 5: Verificar que compila y que los tests siguen pasando**

Run: `npm run build && npm test`
Expected: build exitoso y 13 tests en verde.

- [ ] **Step 6: Commit**

```bash
git add lib/inbox-supabase.js lib/contactos.js app/api/webhook/route.js
git commit -m "feat(avisos): el webhook dispara el push del mensaje entrante"
```

---

### Task 8: Refrescar la pestaña al recibir un push

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: el `postMessage` `{tipo:'push-recibido'}` del service worker (Task 5).

Esto arregla el hallazgo 4 del diagnóstico sin dejar el polling corriendo en segundo
plano: la pestaña solo refresca cuando de verdad llegó algo, así que no sube el
consumo de Supabase. El efecto que ya existe en `App.jsx:321-333` recalcula el
contador solo, y como la pestaña está oculta en ese momento, el número sube.

- [ ] **Step 1: Escuchar los mensajes del service worker**

En `components/App.jsx`, agregar este `useEffect` justo después del bloque que
maneja `visibilitychange` (después de la línea 347):

```jsx
  // El service worker avisa cuando llegó un push: refrescamos al instante en vez de
  // dejar el polling corriendo en segundo plano (que costaría llamadas de más).
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onMsg = (ev) => { if (ev.data?.tipo === 'push-recibido') load() }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [load])
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build exitoso. Si avisa que `load` no está definida en ese punto, mover el
`useEffect` para después de la declaración de `load`.

- [ ] **Step 3: Commit**

```bash
git add components/App.jsx
git commit -m "fix(avisos): la pestana refresca al recibir un push y el contador sube"
```

---

### Task 9: Abrir el chat correcto al tocar el aviso

**Files:**
- Modify: `components/App.jsx`

**Interfaces:**
- Consumes: `{tipo:'abrir-chat', tel}` del service worker (Task 5), y el parámetro
  `?tel=` de la URL cuando el aviso abre una ventana nueva.

Sin esto el aviso abre el inbox pero **no** la conversación: hoy nada en `App.jsx`
lee la query string. El teléfono se matchea por los últimos 9 dígitos, igual que
`abrirChatDesdeContactos` (`App.jsx:390`), porque el formato del webhook y el
canónico de la base pueden diferir.

- [ ] **Step 1: Agregar el manejador**

En `components/App.jsx`, justo después del `useEffect` agregado en la Task 8:

```jsx
  // Abrir un chat puntual: lo pide el service worker al tocar un aviso, o viene en
  // ?tel= cuando el aviso tuvo que abrir una ventana nueva. Espera a que la
  // conversación esté cargada para poder saltar a ella.
  const pedidoRef = useRef(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const tel = new URLSearchParams(window.location.search).get('tel')
    if (tel) pedidoRef.current = tel
    if (!('serviceWorker' in navigator)) return
    const onMsg = (ev) => {
      if (ev.data?.tipo === 'abrir-chat' && ev.data.tel) pedidoRef.current = ev.data.tel
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    const pedido = pedidoRef.current
    if (!pedido || !convs.length) return
    const t9 = String(pedido).replace(/\D/g, '').slice(-9)
    const conv = convs.find(c => String(c.telefono).replace(/\D/g, '').slice(-9) === t9)
    if (!conv) return          // aún no llegó en este ciclo: reintenta al siguiente
    pedidoRef.current = null
    setLinea('MANDI')
    openConv(conv.telefono)
  }, [convs])
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: build exitoso. Si avisa que `openConv` o `setLinea` no están definidas en
ese punto, mover el segundo `useEffect` para después de la declaración de `openConv`
(`App.jsx:371`).

- [ ] **Step 3: Commit**

```bash
git add components/App.jsx
git commit -m "feat(avisos): tocar el aviso abre esa conversacion"
```

---

### Task 10: Configurar y desplegar a producción

**Files:** ninguno (configuración y despliegue)

El usuario pidió expresamente probar **con todo ya en producción**, no en preview.

- [ ] **Step 1: Generar las claves VAPID**

```bash
npx web-push generate-vapid-keys
```

Guarda la salida: da una `Public Key` y una `Private Key`.

- [ ] **Step 2: Cargar las variables en Vercel**

⚠️ **Desde el panel web de Vercel, a mano.** Cargarlas por PowerShell les pega un BOM
invisible que revienta solo en producción.

Proyecto `wa-inbox-v2`, entorno **Production**:

| Variable | Valor |
|---|---|
| `VAPID_PUBLIC_KEY` | la Public Key generada |
| `VAPID_PRIVATE_KEY` | la Private Key generada |
| `VAPID_SUBJECT` | `mailto:mandarinarepublic@outlook.com` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | la **misma** Public Key |
| `PUSH_CLAVE` | una palabra corta que elija el usuario |

Verificar que `CRON_SECRET` ya exista (lo usa el endpoint de prueba).

- [ ] **Step 3: Desplegar a producción**

```bash
git push origin main
```

Vercel despliega `main` a producción automáticamente. Confirmar en el dashboard que
el deployment más reciente tiene `target: production` y que su `meta.githubCommitSha`
coincide con el commit local.

- [ ] **Step 4: Probar el endpoint de prueba**

Abrir en el navegador (con la clave del cron):

```
https://wa-inbox-v2.vercel.app/api/push/test?key=<CRON_SECRET>
```

Esperado antes de suscribirse: `{"ok":true,"enviados":0,"borradas":0}`.
Si devuelve `503 faltan las claves VAPID`, las variables no quedaron bien cargadas.

- [ ] **Step 5: Checklist de pruebas manuales**

Con el inbox abierto en `https://wa-inbox-v2.vercel.app/inbox`:

1. **Activar** — click en 🔕, escribir la `PUSH_CLAVE`. El botón queda 🔔 verde.
   Verificar la fila: `select endpoint, user_agent, creado from inbox.push_subs;`
2. **Prueba directa** — abrir `/api/push/test?key=...` en otra ventana. Debe
   responder `enviados: 1` y aparecer la notificación.
3. **Supresión** — con el inbox **al frente**, disparar la prueba otra vez. NO debe
   aparecer la notificación (pero el contador de la pestaña sí debe moverse).
4. **Mensaje real** — escribirle al WhatsApp de MANDI desde otro teléfono. Debe
   llegar el aviso con el nombre y el texto, y al tocarlo debe abrir ese chat.
5. **Enfriamiento** — mandar 3 mensajes seguidos desde el mismo número en menos de
   5 minutos. Debe llegar **un solo** aviso.
6. **Dos clientes** — mandar desde dos números distintos. Deben llegar **dos** avisos.
7. **Navegador cerrado** — cerrar Chrome por completo y mandar un mensaje. Debe
   llegar igual. Si no llega, revisar en `chrome://settings/system` que esté activo
   *"Seguir ejecutando aplicaciones en segundo plano al cerrar Google Chrome"*.
8. **Android** — repetir el paso 1 en el celular y verificar que llega con la app
   cerrada.
9. **Limpieza automática** — en un navegador secundario: activar, luego borrar los
   datos del sitio, luego disparar la prueba. La fila de ese endpoint debe
   desaparecer sola de `inbox.push_subs`.

- [ ] **Step 6: Revisar los logs**

En Vercel, buscar en los runtime logs de producción entradas `[push]`. No debería
haber ninguna en una corrida sana; `[push] envío falló:` con un código repetido
indica un problema con las claves.

---

## Notas para después (fuera de este plan)

- **Replicar en el inbox de IND** (`ind-inbox-next`): el diseño es idéntico. Cambia
  `CUENTA` a `'IND'`, y hay que generar un par de claves VAPID **propio** y su
  propia tabla `push_subs` (o compartir la tabla agregándole una columna `cuenta`).
- **Login del inbox**: deuda abierta, registrada en el spec. Es lo que haría
  innecesaria la `PUSH_CLAVE`.
- **Sonido propio con la pestaña abierta**: no se puede con el navegador cerrado,
  pero sí mientras el inbox está abierto.
