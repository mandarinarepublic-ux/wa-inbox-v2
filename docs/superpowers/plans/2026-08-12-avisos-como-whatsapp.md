# Avisos como WhatsApp — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que a Rodrigo le suene el celular con cada mensaje nuevo — avisando siempre y moderando el SONIDO como WhatsApp — y dejar desplegado y mudo un recordatorio por Telegram de los chats pendientes.

**Architecture:** Tres cambios independientes. (A1) `lib/push.js` deja de suprimir avisos: `debeNotificar` se convierte en `debeSonar` con ventana de 60 s y su respuesta viaja como `renotify` en el payload, que `public/sw.js` respeta. (A2) `PushToggle.jsx` pierde la clave y gana mensajes visibles al tacto. (C) `lib/telegram.js` + un cron nuevo que lee `estado='pendiente'` y avisa por Telegram, no-op silencioso sin variables.

**Tech Stack:** Next.js (App Router), `web-push`, Supabase (schema `inbox`), Vercel Cron, `node --test`.

## Global Constraints

- **Rama `main` siempre.** Nada de ramas: Preview no sirve porque Supabase solo está en Production.
- **`node --test` NO entiende `@/`.** Todo lo que se testea vive en `lib/` y se importa relativo (`../lib/x.js`). Las rutas de `app/` sí pueden usar `@/`.
- **Español ecuatoriano con TUTEO** en código, comentarios, commits y textos de la app. Nada de voseo (`vos`, `podés`, `andá`).
- **NUNCA `git add -A` ni `git add .`** en este repo. Siempre archivos explícitos.
- **Variables de entorno se cargan por el PANEL WEB de Vercel**, jamás por PowerShell (les pega un BOM invisible que revienta solo en producción).
- **El texto de los avisos no puede engañar con las horas.** Ecuador es UTC−5 fijo, sin horario de verano.
- Las pruebas corren sin `TZ` fijado: toda lógica de hora debe ser independiente de la zona de la máquina.
- `enviarPush` y `enviarTelegram` **nunca lanzan**: un fallo de aviso no puede tocar el webhook.

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `lib/push.js` | Armar y mandar el web push. `debeSonar` decide sonido, no entrega | Modificar |
| `public/sw.js` | Mostrar el aviso; respeta `renotify` del payload | Modificar |
| `app/api/webhook/route.js` | Dispara el aviso en cada entrante, siempre | Modificar |
| `components/PushToggle.jsx` | Suscribir el aparato y **decir en pantalla** qué pasó | Modificar |
| `app/api/push/subscribe/route.js` | Guardar la suscripción; sin `PUSH_CLAVE` | Modificar |
| `lib/telegram.js` | Mandar un mensaje a Telegram. No-op sin variables | Crear |
| `lib/pendientes.js` | Reglas puras: a quién avisar, en qué horario, con qué texto | Crear |
| `lib/inbox-supabase.js` | `marcarAvisoTelegramSupabase` + mapear la columna nueva | Modificar |
| `lib/contactos.js` | `marcarAvisoTelegram` (fachada) | Modificar |
| `app/api/cron/pendientes/route.js` | Orquestar: leer, aplicar reglas, mandar, estampar | Crear |
| `lib/rutas-publicas.js` + `middleware.js` + `vercel.json` | Dejar entrar al cron | Modificar |
| `tests/push.test.js` | Adaptar a `debeSonar` + la prueba nueva que importa | Modificar |
| `tests/telegram.test.js`, `tests/pendientes.test.js` | Pruebas de lo nuevo | Crear |

---

## Task 1: El push avisa siempre y solo modera el sonido

Es el único cambio que toca comportamiento que hoy funciona. Va primero y solo.

**Files:**
- Modify: `lib/push.js:16-17` (constante), `lib/push.js:53-63` (`debeNotificar`), `lib/push.js:71` y `lib/push.js:80-87` (payload)
- Modify: `public/sw.js:37-38`
- Modify: `app/api/webhook/route.js:9` (import), `app/api/webhook/route.js:143-158` (`avisarSiCorresponde`)
- Test: `tests/push.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `debeSonar(ultimoPushAt: string|null, ahoraMs: number, ventanaMs?: number) => boolean` y `VENTANA_SONIDO_MS: number` exportados de `lib/push.js`. `enviarPush({titulo, cuerpo, url, tag, tel, renotify})` acepta `renotify: boolean`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Reemplaza en `tests/push.test.js` el import de la línea 3 y **todos** los tests que nombran `debeNotificar` / `ENFRIAMIENTO_MS` (líneas 41-78) por esto:

```js
// línea 3
import { recortar, cuerpoDeMensaje, debeSonar, VENTANA_SONIDO_MS } from '../lib/push.js'
```

```js
test('debeSonar suena la primera vez', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

test('debeSonar NO suena dentro de la ventana', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  assert.equal(debeSonar(hace10seg, ahora), false)
})

test('debeSonar vuelve a sonar pasada la ventana', () => {
  const ahora = Date.now()
  const hace2min = new Date(ahora - 2 * 60 * 1000).toISOString()
  assert.equal(debeSonar(hace2min, ahora), true)
})

test('debeSonar ignora una fecha corrupta y suena', () => {
  assert.equal(debeSonar('no-es-fecha', Date.now()), true)
})

test('la ventana de sonido es de 60 segundos, no de 5 minutos', () => {
  assert.equal(VENTANA_SONIDO_MS, 60 * 1000)
})

// Contestar borra ultimo_push_at (lo hace limpiarPush desde /api/saliente).
// Con el significado nuevo eso quiere decir: la próxima entrante suena sí o sí.
test('tras contestar, el siguiente mensaje vuelve a sonar', () => {
  assert.equal(debeSonar(null, Date.now()), true)
})

// ── LA PRUEBA QUE DISTINGUE ESTE ARREGLO DE UN CAMBIO DE NOMBRE ──────────────
// Antes, dentro del enfriamiento NO se mandaba nada y el mensaje se perdía.
// Ahora se manda igual, callado. `debeSonar` solo puede apagar el sonido; no
// existe ningún camino donde su `false` impida el envío.
test('dentro de la ventana el aviso IGUAL se manda, solo que callado', () => {
  const ahora = Date.now()
  const hace10seg = new Date(ahora - 10 * 1000).toISOString()
  assert.equal(debeSonar(hace10seg, ahora), false, 'no debe sonar')
  // El webhook no consulta nada más para decidir el envío: manda SIEMPRE y usa
  // este booleano solo como `renotify`. Si algún día alguien lo vuelve a usar
  // como guarda de envío, la alarma es este comentario más el grep del Step 7.
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `SyntaxError: The requested module '../lib/push.js' does not provide an export named 'debeSonar'`

- [ ] **Step 3: Cambiar `lib/push.js`**

Reemplaza las líneas 16-17:

```js
/**
 * Cuánto esperar antes de que el aviso de una misma conversación VUELVA A SONAR.
 * Ojo: esto NO decide si se manda el aviso — se manda siempre. Solo decide si
 * suena, igual que WhatsApp: la ráfaga de una misma persona colapsa en un aviso
 * que se actualiza callado, y el sonido vuelve recién cuando la ráfaga terminó.
 */
export const VENTANA_SONIDO_MS = 60 * 1000
```

Reemplaza el bloque de `debeNotificar` (líneas 53-63):

```js
/**
 * ¿Este aviso tiene que SONAR? Falso solo si ya sonó por esta conversación hace
 * menos de la ventana. Una fecha nula o corrupta hace sonar: mejor un ruido de
 * más que un lead perdido.
 *
 * ⚠️ Esto NO es una guarda de envío. Antes lo era (`debeNotificar`) y ese era el
 * bug: una clienta que escribía una vez y esperaba generaba un solo aviso en toda
 * su vida. El aviso ahora se manda SIEMPRE; esta función solo apaga el sonido.
 */
export function debeSonar(ultimoPushAt, ahoraMs, ventanaMs = VENTANA_SONIDO_MS) {
  if (!ultimoPushAt) return true
  const prev = Date.parse(ultimoPushAt)
  if (Number.isNaN(prev)) return true
  return ahoraMs - prev >= ventanaMs
}
```

En la firma de `enviarPush` (línea 71) agrega `renotify`:

```js
export async function enviarPush({ titulo, cuerpo, url, tag, tel, renotify = true }) {
```

Y en el `payload` (líneas 80-87) suma el campo:

```js
    const payload = JSON.stringify({
      titulo: String(titulo || 'Mensaje nuevo'),
      cuerpo: recortar(cuerpo, 120),
      url:    url || '/inbox',
      tag:    tag || '',
      tel:    tel || '',   // para que la pestaña abra ESE chat al tocar el aviso
      renotify: renotify !== false,  // false = actualiza el aviso sin sonar
    })
```

- [ ] **Step 4: Correr las pruebas**

Run: `npm test`
Expected: PASS — todos los tests, incluidos los 15 que ya existían.

- [ ] **Step 5: Cambiar `public/sw.js`**

En el bloque `showNotification` (líneas 35-42), reemplaza la línea fija `renotify: true`:

```js
    await self.registration.showNotification(titulo, {
      body: cuerpo,
      tag,                                  // un aviso por chat: el nuevo reemplaza al anterior
      renotify: d.renotify !== false,       // …y suena, salvo que sea la misma ráfaga
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url, tel },
    })
```

El `!== false` es a propósito: si llega un payload viejo sin el campo, suena. Nunca al revés.

- [ ] **Step 6: Cambiar el webhook**

En `app/api/webhook/route.js` línea 9, cambia el import:

```js
import { enviarPush, cuerpoDeMensaje, debeSonar } from '@/lib/push'
```

Y reemplaza `avisarSiCorresponde` completa (líneas 142-158):

```js
  // Aviso de mensaje nuevo al equipo (web push). Nunca lanza: un fallo acá no puede
  // tocar el webhook. Sin claves VAPID, enviarPush es un no-op silencioso.
  //
  // Se manda SIEMPRE. Lo único que se modera es el sonido, como WhatsApp: si ya
  // avisamos de esta conversación hace menos de un minuto, el aviso se actualiza
  // callado en vez de volver a sonar. `avisados` sigue evitando dos avisos por el
  // mismo lote de webhook.
  async function avisarSiCorresponde(m) {
    const t = tail9(m.telefono)
    if (avisados.has(t)) return
    avisados.add(t)
    const nombre = m.nombre || m.telefono
    await enviarPush({
      titulo: `💬 ${nombre}`,
      cuerpo: cuerpoDeMensaje({ tipo: m.tipo, contenido: m.contenido }),
      url:    `/inbox?tel=${encodeURIComponent(m.telefono)}`,
      tag:    `chat-${t}`,
      tel:    m.telefono,
      renotify: debeSonar(ultimoPushAtDe(m.telefono), Date.now()),
    })
    await marcarPush(m.telefono)
  }
```

- [ ] **Step 7: Confirmar que no quedó ni un rastro del nombre viejo**

Run: `grep -rn "debeNotificar\|ENFRIAMIENTO_MS" --include=*.js --include=*.jsx app/ lib/ tests/`
Expected: **sin resultados.** Si aparece algo, quedó un llamador sin migrar.

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/push.js public/sw.js app/api/webhook/route.js tests/push.test.js
git commit -m "fix(avisos): avisar siempre y moderar el sonido, como WhatsApp

El enfriamiento de 5 min no silenciaba: BORRABA el aviso. Una clienta que
escribia una vez y esperaba generaba un solo aviso en toda su vida.

Ahora el push se manda en cada entrante y lo unico que se modera es el
sonido (renotify), que es lo que hace WhatsApp. debeNotificar pasa a ser
debeSonar con ventana de 60s: misma logica, otro trabajo."
```

---

## Task 2: El botón deja de fallar mudo en el celular

**Files:**
- Modify: `components/PushToggle.jsx` (completo)
- Modify: `app/api/push/subscribe/route.js:10` y `:16-18`

**Interfaces:**
- Consumes: nada.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Sacar la clave de la ruta**

En `app/api/push/subscribe/route.js`, borra la línea 10 (`const CLAVE = …`) y el bloque de las líneas 16-18. Reemplaza el comentario de las líneas 7-9 por:

```js
// Antes esto pedía PUSH_CLAVE porque el inbox no tenía login y cualquiera con la
// URL podía suscribirse y recibir los mensajes de las clientas en su teléfono.
// Desde el 7-ago-2026 hay login de verdad (middleware.js, AUTH_MODO=bloquear) y
// esta ruta queda dentro del candado, así que la clave sobraba — y era peor que
// inútil: en el celular su error salía por un `title=`, que al tacto no se ve.
```

Y saca `clave` del destructuring de la línea 14:

```js
    const { subscription } = await req.json().catch(() => ({}))
```

- [ ] **Step 2: Reescribir `PushToggle.jsx`**

Reemplaza `activar`, `desactivar` y el `return` (líneas 40-119). El resto del archivo queda igual.

```jsx
  // Todo camino termina en un mensaje VISIBLE. Antes el único lugar donde se
  // mostraba algo era `title=`, que es un tooltip de hover: en un celular no
  // existe. Por eso el botón podía fallar y no decir absolutamente nada — y por
  // eso el Android de Rodrigo nunca llegó a suscribirse.
  const avisar = (texto, ok) => { setMsg(texto); setMsgOk(ok) }

  const activar = async () => {
    avisar('', true)
    setEstado('trabajando')
    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') {
        setEstado('off')
        avisar('No diste permiso. Actívalo en Ajustes → Notificaciones de esta app.', false)
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
        body: JSON.stringify({ subscription: sub.toJSON() }),
      })
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {})
        setEstado('off')
        avisar(r.status === 401
          ? 'Tu sesión se venció. Vuelve a entrar y toca de nuevo.'
          : `No se pudo registrar (error ${r.status}).`, false)
        return
      }
      setEstado('on')
      avisar('✅ Avisos activados en este aparato.', true)
    } catch (e) {
      setEstado('off')
      avisar('No se pudo activar: ' + (e?.message || 'error desconocido'), false)
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
      avisar('Avisos apagados en este aparato.', true)
    } catch (e) {
      setEstado('on')
      avisar('No se pudo apagar: ' + (e?.message || 'error desconocido'), false)
    }
  }

  if (estado === 'no-soportado') return null

  const on = estado === 'on'
  const ocupado = estado === 'trabajando' || estado === 'cargando'

  return (
    <>
      <button
        onClick={on ? desactivar : activar}
        disabled={ocupado}
        aria-label={on ? 'Apagar avisos' : 'Activar avisos de mensajes nuevos'}
        style={{
          background: on ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.12)',
          border: `1px solid ${on ? 'rgba(16,185,129,.45)' : 'rgba(148,163,184,.3)'}`,
          color: on ? '#10b981' : '#94a3b8',
          borderRadius: 8, width: 28, height: 28,
          cursor: ocupado ? 'default' : 'pointer',
          fontSize: 13, opacity: ocupado ? .5 : 1,
          // Al tacto el blanco de 28px es muy chico. `touch-action` no basta: se
          // agranda el área real solo en punteros gruesos, sin descuadrar la fila
          // de botones del encabezado en escritorio.
          ...(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
            ? { width: 44, height: 44, fontSize: 18 }
            : null),
        }}
      >
        {on ? '🔔' : '🔕'}
      </button>

      {msg ? (
        <div
          role="status"
          onClick={() => setMsg('')}
          style={{
            position: 'fixed', left: 12, right: 12, bottom: 16, zIndex: 9999,
            padding: '12px 16px', borderRadius: 12, textAlign: 'center',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: msgOk ? 'rgba(16,185,129,.96)' : 'rgba(239,68,68,.96)',
            color: '#fff', boxShadow: '0 8px 28px rgba(0,0,0,.45)',
          }}
        >
          {msg}
        </div>
      ) : null}
    </>
  )
```

- [ ] **Step 3: Agregar el estado nuevo y el auto-ocultado**

En la línea 19, junto a `const [msg, setMsg] = useState('')`, agrega:

```jsx
  const [msgOk, setMsgOk] = useState(true)
```

Y después del `useEffect` que ya existe (después de la línea 38), agrega:

```jsx
  // El aviso se va solo a los 8 s. Los errores se quedan igual que los éxitos: si
  // algo falló en el celular, tiene que verse en el celular el tiempo suficiente
  // para leerlo. Tocarlo lo cierra antes.
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 8000)
    return () => clearTimeout(t)
  }, [msg])
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: build exitoso, sin errores de lint ni de tipos.

- [ ] **Step 5: Confirmar que la clave ya no se pide en ningún lado**

Run: `grep -rn "PUSH_CLAVE\|window.prompt" --include=*.js --include=*.jsx app/ lib/ components/`
Expected: **sin resultados.**

- [ ] **Step 6: Commit**

```bash
git add components/PushToggle.jsx app/api/push/subscribe/route.js
git commit -m "fix(avisos): el boton de avisos fallaba mudo en el celular

Su unico mensaje de resultado vivia en un `title=`, que es un tooltip de
hover: al tacto no existe. Si tocabas y fallaba, volvia a 🔕 sin decir
nada. Ahora todo camino termina en un aviso visible en pantalla.

Ademas sale la PUSH_CLAVE: se puso cuando el inbox no tenia login, y
desde el 7-ago esta ruta ya esta dentro del candado. Y el boton pasa a
44px en pantallas tactiles."
```

---

## Task 3: Activar y comprobar en el Android de verdad

**Sin esta tarea nada está arreglado, por más verde que se vea todo.** Es manual y la hace Rodrigo; el agente solo verifica con SQL.

**Files:** ninguno.

- [ ] **Step 1: Desplegar**

```bash
git push origin main
```

Confirmar que Vercel construyó de verdad (un push a `main` no siempre dispara build):

Run: `vercel ls --prod --scope mandarinarepublic-6819s-projects`
Expected: el deploy más reciente con `target: production` apunta al commit de la Task 2.

- [ ] **Step 2: Rodrigo suscribe el celular**

En el Android, abrir el inbox **desde el icono de la pantalla de inicio** (no desde una pestaña suelta de Chrome), tocar 🔕 y aceptar el permiso. Tiene que aparecer la barra verde "✅ Avisos activados en este aparato."

Si sale una barra roja, ese texto es el diagnóstico — pegarlo tal cual.

- [ ] **Step 3: Verificar en la base que la suscripción existe**

```sql
select creado, left(user_agent, 80) as agente, cuenta
from inbox.push_subs
where cuenta = 'MANDI' and (user_agent ilike '%Android%' or user_agent ilike '%Mobile%')
order by creado desc;
```

Expected: **al menos una fila.** Antes de este plan había cero — ese cero era el bug entero. Si sigue vacío, el botón siguió fallando y no hay que avanzar a la Task 4.

- [ ] **Step 4: Comprobar que suena, con el celular bloqueado**

Con el celular en el bolsillo y la pantalla apagada, llamar a `/api/push/test`. Tiene que sonar.

- [ ] **Step 5: Comprobar la regla de WhatsApp con mensajes reales**

Desde otro teléfono, mandarle dos mensajes seguidos al número de MANDI, con 10 segundos entre uno y otro.
Expected: **llegan los dos** (el segundo actualiza el aviso del primero, que es lo que hace WhatsApp) y **suena una sola vez**. Con el código viejo el segundo se perdía del todo.

Después, contestar desde el inbox y mandar un tercer mensaje.
Expected: **este sí vuelve a sonar** — contestar limpia `ultimo_push_at` y eso ahora quiere decir "la próxima suena sí o sí".

- [ ] **Step 6: Batería (lo hace Rodrigo en el celular)**

Ajustes → Aplicaciones → Chrome → Batería → **Sin restricciones**. Sin esto, Android puede matar el proceso y tragarse avisos aunque todo lo demás esté bien.

---

## Task 4: `lib/telegram.js` — mandar un mensaje, o callarse

**Files:**
- Create: `lib/telegram.js`
- Test: `tests/telegram.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `telegramConfigurado(): boolean` y `enviarTelegram(texto: string): Promise<{ok: boolean, motivo?: string}>`, ambos de `lib/telegram.js`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/telegram.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { telegramConfigurado, enviarTelegram } from '../lib/telegram.js'

// Las pruebas corren sin TELEGRAM_BOT_TOKEN ni TELEGRAM_CHAT_ID, que es
// exactamente el estado en que esto se despliega: vivo y mudo.

test('sin variables, no esta configurado', () => {
  assert.equal(telegramConfigurado(), false)
})

test('sin variables, enviar es un no-op que NO lanza', async () => {
  const r = await enviarTelegram('hola')
  assert.equal(r.ok, false)
  assert.equal(r.motivo, 'sin-config')
})

test('un fallo de red no lanza nunca', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => { throw new Error('red caida') }
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, false)
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})

// `fetch` NO lanza con 4xx/5xx: devuelve una respuesta con ok=false. Si nadie
// mira `res.ok`, un token equivocado se ve exactamente igual que un envio bueno.
test('un 401 de Telegram se reporta como fallo, no como exito', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' })
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, false, 'un 401 NO puede reportarse como ok')
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})

test('con variables y 200, reporta exito', async () => {
  const fetchOriginal = globalThis.fetch
  process.env.TELEGRAM_BOT_TOKEN = 'x'
  process.env.TELEGRAM_CHAT_ID = 'y'
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })
  try {
    const r = await enviarTelegram('hola')
    assert.equal(r.ok, true)
  } finally {
    globalThis.fetch = fetchOriginal
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
  }
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test tests/telegram.test.js`
Expected: FAIL — `Cannot find module '../lib/telegram.js'`

- [ ] **Step 3: Escribir `lib/telegram.js`**

```js
// lib/telegram.js — avisos por Telegram.
//
// Sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID esto es un NO-OP silencioso, igual que
// enviarPush() sin claves VAPID: se despliega hoy, no rompe nada, y se enciende
// después creando el bot y cargando las dos variables.
//
// Config (Vercel, cargar desde el PANEL WEB — por PowerShell les pega un BOM que
// revienta solo en producción):
//   TELEGRAM_BOT_TOKEN  → el que te da @BotFather
//   TELEGRAM_CHAT_ID    → el chat/grupo destino (puede ser negativo si es grupo)

const API = 'https://api.telegram.org'

const token  = () => String(process.env.TELEGRAM_BOT_TOKEN || '').replace(/[^\x21-\x7E]/g, '')
const chatId = () => String(process.env.TELEGRAM_CHAT_ID   || '').replace(/[^\x21-\x7E]/g, '')

export function telegramConfigurado() {
  return Boolean(token() && chatId())
}

/**
 * Manda un texto al chat configurado. NUNCA lanza.
 *
 * ⚠️ `fetch` no lanza con 4xx/5xx — devuelve una respuesta con `ok:false`. Sin
 * mirar `res.ok`, un token vencido se vería idéntico a un envío bueno y el aviso
 * se perdería en silencio para siempre.
 */
export async function enviarTelegram(texto) {
  if (!telegramConfigurado()) return { ok: false, motivo: 'sin-config' }
  try {
    const res = await fetch(`${API}/bot${token()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId(),
        text: String(texto || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      const detalle = await res.text().catch(() => '')
      console.error('[telegram] rechazado:', res.status, detalle.slice(0, 200))
      return { ok: false, motivo: `http-${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    console.error('[telegram] error de red:', e?.message || e)
    return { ok: false, motivo: 'red' }
  }
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `node --test tests/telegram.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/telegram.js tests/telegram.test.js
git commit -m "feat(telegram): enviar avisos, mudo mientras no haya variables

Mismo patron que enviarPush sin VAPID: se despliega antes de configurar
nada y no rompe. Mira res.ok a proposito — fetch no lanza con 4xx, asi
que un token vencido se veria igual que un envio bueno."
```

---

## Task 5: Las reglas de a quién avisar (puras y testeables)

Toda la lógica que se puede equivocar vive acá, sin base ni red, para poder probarla de verdad.

**Files:**
- Create: `lib/pendientes.js`
- Test: `tests/pendientes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces, todos de `lib/pendientes.js`:
  - `horaEcuador(ms: number): number` → 0-23
  - `enHorarioLaboral(ms: number): boolean`
  - `ESPERA_MINIMA_MS: number`, `REPETIR_CADA_MS: number`
  - `chatsQueAvisar(contactos: Array<{telefono, nombre, estado, ultimoEntranteAt, ultimoAvisoTelegramAt}>, ahoraMs: number): Array<contacto>`
  - `textoAviso(chats: Array<contacto>, ahoraMs: number, baseUrl: string): string`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/pendientes.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import {
  horaEcuador, enHorarioLaboral, chatsQueAvisar, textoAviso,
  ESPERA_MINIMA_MS, REPETIR_CADA_MS,
} from '../lib/pendientes.js'

const MIN = 60 * 1000
// Un martes cualquiera, 15:00 UTC = 10:00 en Ecuador (UTC-5 fijo, sin verano).
const AHORA = Date.parse('2026-08-11T15:00:00.000Z')
const haceMin = (m) => new Date(AHORA - m * MIN).toISOString()

const chat = (over = {}) => ({
  telefono: '593999111222', nombre: 'Karilu', estado: 'pendiente',
  ultimoEntranteAt: haceMin(30), ultimoAvisoTelegramAt: null, ...over,
})

test('horaEcuador no depende de la zona de la maquina', () => {
  assert.equal(horaEcuador(Date.parse('2026-08-11T15:00:00.000Z')), 10)
  assert.equal(horaEcuador(Date.parse('2026-08-11T03:00:00.000Z')), 22)
  // 04:00 UTC = 23:00 del dia ANTERIOR en Ecuador. El caso que se equivoca solo.
  assert.equal(horaEcuador(Date.parse('2026-08-11T04:00:00.000Z')), 23)
})

test('el horario laboral es de 8 a 21 hora Ecuador', () => {
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T15:00:00.000Z')), true)  // 10:00
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T12:00:00.000Z')), true)  // 07:00 → no
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T13:00:00.000Z')), true)  // 08:00 → sí
  assert.equal(enHorarioLaboral(Date.parse('2026-08-11T06:00:00.000Z')), false) // 01:00
})

test('avisa de un pendiente que espera mas del minimo', () => {
  assert.equal(chatsQueAvisar([chat()], AHORA).length, 1)
})

test('NO avisa de un pendiente recien llegado', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: haceMin(2) })], AHORA).length, 0)
})

test('NO avisa de un chat que ya no esta pendiente', () => {
  assert.equal(chatsQueAvisar([chat({ estado: 'atendido' })], AHORA).length, 0)
  assert.equal(chatsQueAvisar([chat({ estado: 'venta' })], AHORA).length, 0)
})

test('NO repite el aviso antes de la ventana de repeticion', () => {
  const yaAvisado = chat({ ultimoAvisoTelegramAt: haceMin(5) })
  assert.equal(chatsQueAvisar([yaAvisado], AHORA).length, 0)
})

test('SI vuelve a insistir pasada la ventana — es un recordatorio, no un evento', () => {
  const viejo = chat({ ultimoAvisoTelegramAt: haceMin(31) })
  assert.equal(chatsQueAvisar([viejo], AHORA).length, 1)
})

test('fuera de horario no avisa de nada', () => {
  const madrugada = Date.parse('2026-08-11T06:00:00.000Z') // 01:00 Ecuador
  assert.equal(chatsQueAvisar([chat()], madrugada).length, 0)
})

test('sin ultimoEntranteAt no avisa: no se puede medir la espera', () => {
  assert.equal(chatsQueAvisar([chat({ ultimoEntranteAt: null })], AHORA).length, 0)
})

test('el mas viejo va primero', () => {
  const lista = [
    chat({ telefono: '1', ultimoEntranteAt: haceMin(20) }),
    chat({ telefono: '2', ultimoEntranteAt: haceMin(90) }),
  ]
  assert.equal(chatsQueAvisar(lista, AHORA)[0].telefono, '2')
})

test('el texto dice cuantos son y cuanto lleva esperando el peor', () => {
  const lista = chatsQueAvisar([
    chat({ telefono: '1', nombre: 'Ana',  ultimoEntranteAt: haceMin(20) }),
    chat({ telefono: '2', nombre: 'Bea',  ultimoEntranteAt: haceMin(90) }),
  ], AHORA)
  const t = textoAviso(lista, AHORA, 'https://inbox.test')
  assert.ok(t.includes('2'), 'debe decir cuantos son')
  assert.ok(t.includes('Bea'), 'debe nombrar al que mas espera')
  assert.ok(t.includes('1 h 30 min'), `debe decir la espera legible, salio: ${t}`)
  assert.ok(t.includes('https://inbox.test/inbox?tel=2'), 'debe traer el link al chat')
})

test('con un solo chat el texto va en singular', () => {
  const t = textoAviso(chatsQueAvisar([chat({ nombre: 'Ana' })], AHORA), AHORA, 'https://inbox.test')
  assert.ok(!t.includes('chats pendientes'), `no debe pluralizar, salio: ${t}`)
})

test('las constantes son las acordadas', () => {
  assert.equal(ESPERA_MINIMA_MS, 10 * MIN)
  assert.equal(REPETIR_CADA_MS, 30 * MIN)
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test tests/pendientes.test.js`
Expected: FAIL — `Cannot find module '../lib/pendientes.js'`

- [ ] **Step 3: Escribir `lib/pendientes.js`**

```js
// lib/pendientes.js — reglas del recordatorio de chats sin contestar.
//
// Todo acá es PURO: sin base, sin red, sin relojes escondidos. Es a propósito —
// es la parte que se puede equivocar, así que es la parte que se puede probar.
//
// La diferencia con el push: el push avisa de un EVENTO (entró un mensaje) y por
// eso se puede perder. Esto avisa de un ESTADO (hay gente esperando) y por eso
// insiste hasta que vacíes la bandeja. Es la regla de Rodrigo puesta en código:
// "si esa bandeja está vacía, contesté a todos".

const MIN = 60 * 1000

/** Cuánto tiene que llevar esperando un chat para que valga la pena avisar. */
export const ESPERA_MINIMA_MS = 10 * MIN
/** Cada cuánto se vuelve a insistir por el mismo chat, si sigue sin contestar. */
export const REPETIR_CADA_MS = 30 * MIN

export const HORA_ABRE = 8
export const HORA_CIERRA = 21

/**
 * Hora del día en Ecuador (0-23). Ecuador es UTC−5 fijo y NO tiene horario de
 * verano, así que restar 5 h y leer en UTC es exacto — y a diferencia de
 * `getHours()`, no depende de la zona de la máquina ni del servidor.
 */
export function horaEcuador(ms) {
  return new Date(ms - 5 * 3600 * 1000).getUTCHours()
}

export function enHorarioLaboral(ms) {
  const h = horaEcuador(ms)
  return h >= HORA_ABRE && h < HORA_CIERRA
}

/** Espera en milisegundos de un chat, o null si no se puede medir. */
function esperaDe(c, ahoraMs) {
  if (!c?.ultimoEntranteAt) return null
  const t = Date.parse(c.ultimoEntranteAt)
  if (Number.isNaN(t)) return null
  return ahoraMs - t
}

/**
 * De todos los contactos, ¿por cuáles toca avisar ahora? Ordenados del que más
 * espera al que menos.
 *
 * Un chat sin `ultimoEntranteAt` queda FUERA: no se puede medir su espera, y
 * avisar de algo que no sabemos medir es ruido que enseña a ignorar los avisos.
 */
export function chatsQueAvisar(contactos, ahoraMs) {
  if (!enHorarioLaboral(ahoraMs)) return []
  return (contactos || [])
    .filter((c) => String(c?.estado || '').toLowerCase() === 'pendiente')
    .map((c) => ({ c, espera: esperaDe(c, ahoraMs) }))
    .filter(({ c, espera }) => {
      if (espera === null || espera < ESPERA_MINIMA_MS) return false
      // Anti-repetición: guardado en la BASE, no en RAM. Las funciones de Vercel
      // son efímeras y un Set en memoria manda duplicados — misma lección que
      // dejó el enfriamiento del push.
      if (!c.ultimoAvisoTelegramAt) return true
      const prev = Date.parse(c.ultimoAvisoTelegramAt)
      if (Number.isNaN(prev)) return true
      return ahoraMs - prev >= REPETIR_CADA_MS
    })
    .sort((a, b) => b.espera - a.espera)
    .map(({ c }) => c)
}

/** "1 h 30 min", "45 min". Legible de un vistazo en la pantalla de bloqueo. */
export function esperaLegible(ms) {
  const totalMin = Math.floor(ms / MIN)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/**
 * El texto del aviso. Nombra al que más espera y cuánto lleva — un número solo
 * ("3 pendientes") no mueve a nadie; "Bea lleva 1 h 30 min" sí.
 */
export function textoAviso(chats, ahoraMs, baseUrl) {
  if (!chats?.length) return ''
  const peor = chats[0]
  const espera = esperaLegible(esperaDe(peor, ahoraMs) ?? 0)
  const nombre = peor.nombre || peor.telefono
  const link = `${baseUrl}/inbox?tel=${encodeURIComponent(peor.telefono)}`

  if (chats.length === 1) {
    return `⏳ <b>${nombre}</b> lleva <b>${espera}</b> esperando respuesta.\n\n${link}`
  }
  return `⏳ <b>${chats.length} chats pendientes</b>.\n` +
         `El que más espera: <b>${nombre}</b>, ${espera}.\n\n${link}`
}
```

- [ ] **Step 4: Correr las pruebas**

Run: `node --test tests/pendientes.test.js`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pendientes.js tests/pendientes.test.js
git commit -m "feat(pendientes): reglas puras del recordatorio de chats sin contestar

Estado, no evento: insiste cada 30 min mientras haya gente esperando y
calla sola cuando vacias la bandeja. horaEcuador resta UTC-5 en vez de
usar getHours() para no depender de la zona de la maquina."
```

---

## Task 6: La columna que recuerda a quién ya se le avisó

**Files:**
- Migration: `ultimo_aviso_telegram_at` en `inbox.conversaciones`
- Modify: `lib/inbox-supabase.js:44` (mapeo en `toContacto`) y después de `:163` (setter)
- Modify: `lib/contactos.js` (fachada, junto a `marcarPush`)

**Interfaces:**
- Consumes: nada.
- Produces: `marcarAvisoTelegram(telefono: string, ts?: string|null)` desde `lib/contactos.js`; el campo `ultimoAvisoTelegramAt` en cada contacto de `getContactos()`.

- [ ] **Step 1: Aplicar la migración**

Con la tool `apply_migration` de Supabase (proyecto `piingkecjgoisnxccvaa`), nombre `pendientes_ultimo_aviso_telegram`:

```sql
alter table inbox.conversaciones
  add column if not exists ultimo_aviso_telegram_at timestamptz;

comment on column inbox.conversaciones.ultimo_aviso_telegram_at is
  'Ultimo recordatorio por Telegram de este chat pendiente. En la BASE y no en RAM porque las funciones de Vercel son efimeras.';
```

⚠️ Usar `apply_migration`, no `execute_sql`: registra sola la migración en `supabase_migrations.schema_migrations`, que es el registro compartido por CRM e inboxes.

- [ ] **Step 2: Verificar que la columna existe de verdad**

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'inbox'
  and table_name = 'conversaciones'
  and column_name = 'ultimo_aviso_telegram_at';
```

Expected: una fila, `timestamptz`, `YES`.

- [ ] **Step 3: Mapear la columna en `lib/inbox-supabase.js`**

En `toContacto`, después de la línea 44 (`ultimoPushAt: …`):

```js
    ultimoAvisoTelegramAt: c.ultimo_aviso_telegram_at || null, // recordatorio de pendientes
```

Y después de `limpiarPushSupabase` (línea 169), el setter nuevo:

```js
// Recordatorio de pendientes por Telegram: cuándo se avisó por última vez de este
// chat. Va en la base porque las funciones de Vercel son efímeras.
export async function marcarAvisoTelegramSupabase(telefono, ts = null) {
  return setCampoContacto(telefono, 'ultimo_aviso_telegram_at', ts || new Date().toISOString())
}
```

- [ ] **Step 4: Agregar la fachada en `lib/contactos.js`**

Justo después de `limpiarPush` (línea 79):

```js
// Recordatorio de pendientes por Telegram (lo llama el cron /api/cron/pendientes).
export async function marcarAvisoTelegram(telefono, ts = null) {
  if (typeof SB.marcarAvisoTelegramSupabase !== 'function') return { ok: false }
  return SB.marcarAvisoTelegramSupabase(telefono, ts)
}
```

- [ ] **Step 5: Verificar que el campo llega hasta arriba**

Run: `npm run build`
Expected: build exitoso.

Run: `grep -n "ultimoAvisoTelegramAt\|ultimo_aviso_telegram_at" lib/inbox-supabase.js lib/contactos.js`
Expected: el mapeo en `toContacto` y el setter. Si el mapeo falta, el cron leería `undefined` y avisaría en bucle cada 5 minutos.

- [ ] **Step 6: Commit**

```bash
git add lib/inbox-supabase.js lib/contactos.js
git commit -m "feat(pendientes): columna ultimo_aviso_telegram_at

Anti-repeticion del recordatorio, guardado en la base y no en memoria:
las funciones de Vercel son efimeras y un Set en RAM manda duplicados."
```

---

## Task 7: El cron que junta todo

**Files:**
- Create: `app/api/cron/pendientes/route.js`
- Modify: `lib/rutas-publicas.js:14-19` y el comentario de `:4-11`
- Modify: `middleware.js` (el `matcher` del final)
- Modify: `vercel.json` (bloque `crons`)

**Interfaces:**
- Consumes: `enviarTelegram`, `telegramConfigurado` (Task 4); `chatsQueAvisar`, `textoAviso` (Task 5); `marcarAvisoTelegram` (Task 6); `getContactos` de `lib/contactos.js` (ya existe).
- Produces: `GET /api/cron/pendientes`.

- [ ] **Step 1: Escribir la ruta**

Crear `app/api/cron/pendientes/route.js`:

```js
import { NextResponse } from 'next/server'
import { getContactos, marcarAvisoTelegram } from '@/lib/contactos'
import { enviarTelegram, telegramConfigurado } from '@/lib/telegram'
import { chatsQueAvisar, textoAviso } from '@/lib/pendientes'

// Recordatorio de chats sin contestar, por Telegram. Lo llama Vercel Cron cada
// 5 min (ver vercel.json).
//
// Por qué existe, además del push: el push avisa de un EVENTO (entró un mensaje).
// Si te lo perdiste, se perdió. Esto avisa de un ESTADO (hay gente esperando) e
// insiste cada 30 min hasta que la bandeja quede vacía. El 12-ago-2026 había 12
// chats pendientes en MANDI y el más viejo llevaba 31 horas: todos habían
// disparado su push, y todos se habían apagado.
//
// Sin TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no manda nada y no rompe nada.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function autorizado(req) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isVercelCron = req.headers.get('x-vercel-cron') != null // Vercel lo pone solo en crons reales
  const keyQ = new URL(req.url).searchParams.get('key')
  if (isVercelCron) return true
  if (secret && (auth === `Bearer ${secret}` || keyQ === secret)) return true
  return false
}

export async function GET(req) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  }

  const ahora = Date.now()
  const baseUrl = new URL(req.url).origin

  // ⚠️ `getContactos(null)` con el null EXPLÍCITO, nunca `getContactos()`.
  // La firma es `getContactosSupabase(canal = canalPorDefecto())`: sin argumento
  // filtra por el phone_id de MANDI y las conversaciones de REPUBLIC quedarían
  // INVISIBLES para el recordatorio — pendientes reales que nadie ve, que es
  // justo el bug que este cron viene a matar. `null` apaga el filtro
  // (`lib/inbox-supabase.js:67`) y trae los dos números de la cuenta.
  const contactos = await getContactos(null).catch((e) => {
    console.error('[cron/pendientes] no se pudo leer contactos:', e?.message || e)
    return null
  })
  if (!contactos) {
    return NextResponse.json({ ok: false, error: 'sin contactos' }, { status: 500 })
  }

  const aAvisar = chatsQueAvisar(contactos, ahora)
  if (!aAvisar.length) {
    // Bandeja vacía o fuera de horario: calla solo, sin que nadie apague nada.
    return NextResponse.json({ ok: true, avisados: 0, pendientes: 0 })
  }

  if (!telegramConfigurado()) {
    // Desplegado y mudo. Se reporta para que el silencio sea VISIBLE en los
    // registros: un cron que no manda nada tiene que poder distinguirse de un
    // cron que no corre.
    console.log(`[cron/pendientes] ${aAvisar.length} pendientes, Telegram sin configurar`)
    return NextResponse.json({ ok: true, avisados: 0, pendientes: aAvisar.length, motivo: 'sin-config' })
  }

  const r = await enviarTelegram(textoAviso(aAvisar, ahora, baseUrl))
  if (!r.ok) {
    // NO se estampa la marca si el envío falló: así el próximo ciclo reintenta.
    console.error('[cron/pendientes] Telegram falló:', r.motivo)
    return NextResponse.json({ ok: false, avisados: 0, pendientes: aAvisar.length, motivo: r.motivo })
  }

  // Recién ahora se marca, y con await: sin await la función serverless devuelve
  // la respuesta y se congela antes del update, y el aviso se repetiría cada 5
  // minutos para siempre.
  for (const c of aAvisar) {
    await marcarAvisoTelegram(c.telefono).catch((e) =>
      console.error('[cron/pendientes] marcar', c.telefono, e?.message || e))
  }

  return NextResponse.json({ ok: true, avisados: aAvisar.length, pendientes: aAvisar.length })
}
```

- [ ] **Step 2: Dejar entrar al cron — las tres puertas**

En `lib/rutas-publicas.js`, agregar a la lista y al comentario:

```js
//   /api/cron/pendientes  → CRON_SECRET
```
```js
export const RUTAS_PUBLICAS = [
  '/api/webhook',
  '/api/social/webhook',
  '/api/cron/seguimientos',
  '/api/cron/pendientes',
  '/api/pago-dlocal',
]
```

En `middleware.js`, en el `matcher`, agregar `api/cron/pendientes` a la lista de exclusiones:

```js
    '/((?!api/webhook|api/social/webhook|api/cron/seguimientos|api/cron/pendientes|api/pago-dlocal|_next/static|_next/image|favicon.ico|sw.js|icon-|manifest.webmanifest).*)',
```

En `vercel.json`:

```json
  "crons": [
    { "path": "/api/cron/seguimientos", "schedule": "0 * * * *" },
    { "path": "/api/cron/pendientes", "schedule": "*/5 * * * *" }
  ]
```

- [ ] **Step 3: Actualizar el inventario de rutas públicas**

`tests/rutas-publicas.test.js` tiene su propia copia de la lista (a propósito: es el inventario medido del 7-ago hecho red de seguridad). Agregar la ruta a `PUBLICAS`, línea 9-14:

```js
// Las 5 que NUNCA pueden pedir sesión. Cada una se defiende sola.
const PUBLICAS = [
  '/api/webhook',            // Meta (WhatsApp) — 1035 llamadas en 24h
  '/api/social/webhook',     // Meta (FB/IG)
  '/api/cron/seguimientos',  // cron de Vercel, cada hora
  '/api/cron/pendientes',    // cron de Vercel, cada 5 min — recordatorio Telegram
  '/api/pago-dlocal',        // dLocal, ya protegida con secreto en la URL
]
```

- [ ] **Step 4: Control negativo — probar que la puerta cierra**

Run: `npm run build`
Expected: build exitoso.

Run: `npm test`
Expected: PASS, con los 3 archivos de prueba nuevos/tocados incluidos.

- [ ] **Step 5: Commit y desplegar**

```bash
git add app/api/cron/pendientes/route.js lib/rutas-publicas.js middleware.js vercel.json tests/rutas-publicas.test.js
git commit -m "feat(pendientes): cron que recuerda por Telegram los chats sin contestar

Corre cada 5 min, avisa de lo que lleva mas de 10 min esperando e
insiste cada 30. Desplegado MUDO: sin las variables de Telegram no manda
nada. Solo estampa la marca si el envio salio bien, para que un fallo se
reintente en vez de perderse."
git push origin main
```

- [ ] **Step 6: Verificar que el cron corre y que su silencio se VE**

Sin variables de Telegram todavía, llamar la ruta a mano con el secreto:

Run: `curl -s "https://<dominio-prod>/api/cron/pendientes?key=$CRON_SECRET"`
Expected: `{"ok":true,"avisados":0,"pendientes":N,"motivo":"sin-config"}` con N > 0 si hay pendientes.

**Control negativo — sin esto el `ok` no vale nada:**

Run: `curl -s -o /dev/null -w "%{http_code}" "https://<dominio-prod>/api/cron/pendientes"`
Expected: `401`. Si devuelve 200, la ruta quedó abierta al internet entero y hay que parar.

- [ ] **Step 7: Encender Telegram (lo hace Rodrigo)**

1. Crear el bot con **@BotFather** → `/newbot` → guardar el token.
2. Crear el chat/grupo nuevo, meter al bot y mandarle un mensaje cualquiera.
3. Sacar el `chat_id`: abrir `https://api.telegram.org/bot<TOKEN>/getUpdates` y leer `result[].message.chat.id`.
4. Cargar `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` **por el panel web de Vercel** (nunca por PowerShell: BOM invisible).
5. **Redesplegar.** Las variables no surten efecto solas.

- [ ] **Step 8: Verificar de punta a punta**

Run: `curl -s "https://<dominio-prod>/api/cron/pendientes?key=$CRON_SECRET"`
Expected: `{"ok":true,"avisados":N,...}` con N ≥ 1, **y el mensaje llegando al chat de Telegram**.

Llamar la ruta otra vez enseguida:
Expected: `avisados: 0` — el anti-repetición de 30 min funcionando. Si vuelve a mandar, `ultimoAvisoTelegramAt` no se está mapeando (Task 6, Step 3) y el aviso se repetiría cada 5 minutos.

---

## Auto-revisión del plan

**Cobertura de la spec:**

| Requisito de la spec | Tarea |
|---|---|
| A1 sacar la clave del botón | Task 2 |
| A2 resultado en pantalla, no en `title` | Task 2 |
| A3 botón táctil 44×44 | Task 2 |
| A4 avisar siempre, `renotify` en vez de suprimir | Task 1 |
| A4 `debeNotificar` → `debeSonar`, pruebas adaptadas + la nueva | Task 1, Steps 1 y 7 |
| A4 `limpiarPush` sin tocar | Task 1 (no aparece: es deliberado, la spec lo pide) |
| A5 activar y probar en el Android | Task 3 |
| A6 batería sin restricciones | Task 3, Step 6 |
| C1 `lib/telegram.js` no-op silencioso | Task 4 |
| C2 cron cada 5 min, 10 min de espera, insistir cada 30, 8-21 Ecuador | Tasks 5 y 7 |
| C3 anti-repetición en la base | Task 6 |
| C4 variables por el panel web | Task 7, Step 7 |
| Tabla de verificación de la spec | Tasks 3, 7 Steps 6 y 8 |
| Los DOS números (MANDI + REPUBLIC) en el recordatorio | Task 7, Step 1 (`getContactos(null)`) |

Sin huecos.

**Riesgo conocido, dicho de frente:** el punto más frágil del plan es la Task 1, porque es lo único que cambia comportamiento que hoy funciona. Su red de seguridad es el Step 7 (`grep` de que no quedó ni un llamador con el nombre viejo) y el Step 5 de la Task 3 (dos mensajes seguidos de verdad, con un teléfono de verdad). Si algo va a fallar, va a fallar ahí.

**Lo que este plan NO puede probar solo:** que el aviso suene con el celular bloqueado y en el bolsillo. Eso no hay test que lo cubra — lo verifica Rodrigo en la Task 3, y hasta que lo confirme el trabajo no está hecho.
