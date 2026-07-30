# El cron despierta a la IA — Plan de implementación (solo MANDI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cron de seguimientos despierte al bot cuando está activo, en vez de saltarse el chat, y siga mandando el texto automático cuando está apagado.

**Architecture:** El cron decide con `decidirIA()`, la misma función que usa el webhook. Si el bot está activo, llama al agente con `source: 'seguimiento'` y sin mensaje de cliente; el agente reconoce ese origen y construye él la reanudación. La lógica de llamar al agente y mandar su respuesta se mueve a un módulo compartido. La funcionalidad sale a producción **apagada** por configuración.

**Tech Stack:** Next.js 14 (App Router), Vercel Cron, Supabase, API de Anthropic (dentro de `mandi-agent`), `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-cron-despierta-la-ia-design.md` (repo de MANDI). Ante duda, manda el spec.
- **DOS repos:** `C:\Users\RodrigoWork\Desktop\mandi-agent` (proyecto Vercel `mandi-agent`) y `C:\Users\RodrigoWork\Desktop\wa-inbox-next` (proyecto `wa-inbox-v2`). Las carpetas no se llaman como los proyectos.
- **El agente va PRIMERO.** Hoy `api/agent.js` devuelve **400** si no hay `message` ni imagen: si el cron mandara la señal antes, cada despertar fallaría.
- **Producción = `main`** en los dos. Sin ramas.
- **El despliegue no debe cambiar nada:** `seguimientos.solo_ia_apagada` sigue en `true`, y con ese valor el cron se comporta exactamente como hoy.
- **Solo MANDI.** IND no se toca en este plan.
- Comentarios y textos en **español**; mensajes de commit en español **sin tildes**.
- Baseline de pruebas: **wa-inbox-next 78**. `mandi-agent` **no tiene** script de pruebas y este plan no lo añade.
- **No usar `git add -A`** en estos repos: hay archivos sin commitear del dueño.

---

### Task 1: El agente entiende que lo están despertando (`mandi-agent`)

**Files (en `C:\Users\RodrigoWork\Desktop\mandi-agent`):**
- Modify: `api/agent.js` (validación de entrada ~línea 191; construcción del turno ~líneas 265-272)

**Interfaces:**
- Produces: `POST /api/agent` acepta `{ phone, name, message: '', source: 'seguimiento' }` y responde con la misma forma de siempre (`{ reply_clean | reply, imagenes }`).

- [ ] **Step 1: Ver cómo valida hoy**

Run: `grep -n "Faltan campos" -B 3 -A 1 api/agent.js`
Expected: la condición `if (!phone || (!message && !image_url && !media_url))` que devuelve 400.

- [ ] **Step 2: Dejar pasar la señal de seguimiento**

Reemplazar esa condición por:

```js
  // El cron de seguimientos despierta al bot SIN mensaje de cliente: no hay ninguno,
  // el chat lleva horas callado. Por eso ese origen se valida aparte.
  const esSeguimiento = source === 'seguimiento'

  if (!phone || (!esSeguimiento && !message && !image_url && !media_url)) {
    return res.status(400).json({ error: 'Faltan campos: phone y message (o image_url)' });
  }
```

- [ ] **Step 3: Construir el turno de reanudación**

Alrededor de la línea 265 hay exactamente esto:

```js
    let userContent;
    if (imageUrl) {
      userContent = [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: message || 'El cliente envió esta imagen' }
      ];
    } else {
      userContent = message;
    }
```

Reemplazarlo por esto — las dos ramas que ya existían quedan **idénticas**, solo se antepone una nueva:

```js
    let userContent;
    // Despertar del cron: no hay mensaje del cliente. La instrucción se arma ACÁ
    // DENTRO y no en el inbox, para que no pueda filtrarse al texto que ve el
    // cliente: si el inbox la mandara dentro de `message`, el agente la trataría
    // como algo que dijo el cliente y podría contestarle a esa frase.
    if (esSeguimiento) {
      userContent = 'INSTRUCCION DEL SISTEMA (no es un mensaje del cliente, no la menciones ni la repitas): este chat lleva horas sin respuesta del cliente y la ventana de 24 horas esta por cerrarse. Retoma la conversacion en un solo mensaje corto y natural, apoyandote en lo ultimo que se hablo. No saludes de nuevo como si fuera un contacto nuevo. No inventes promociones ni precios que no esten en el historial.';
    } else if (imageUrl) {
      userContent = [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: message || 'El cliente envió esta imagen' }
      ];
    } else {
      userContent = message;
    }
```

- [ ] **Step 4: Comprobar que no rompiste el camino normal**

Run: `node --check api/agent.js`
Expected: sin errores de sintaxis.

Run: `grep -n "userContent" api/agent.js`
Expected: la asignación nueva más las que ya existían, y **un solo** uso de `userContent` en la construcción de los mensajes (alrededor de la línea 301). Si aparece asignada en un camino que no la usa, algo quedó mal enganchado.

- [ ] **Step 5: Commit**

```bash
git add api/agent.js
git commit -m "feat(seguimiento): el agente acepta que lo despierten sin mensaje del cliente

El cron de seguimientos va a llamar al agente cuando un chat lleva horas callado y
la ventana de 24h esta por cerrarse. En ese caso NO hay mensaje del cliente, y hoy
el endpoint devolvia 400 si faltaba.

La instruccion de reanudacion se arma AQUI DENTRO y no en el inbox: si el inbox la
mandara dentro de `message`, el agente la tratatia como algo que dijo el cliente y
podria contestarle a esa frase o mezclarla en la respuesta que el cliente ve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mover a `lib/responder-ia.js` lo que llama al agente (`wa-inbox-next`)

Hoy vive dentro del webhook. El cron necesita lo mismo, y copiarlo sería repetir el error que produjo el bug de las fotos saliendo por el número equivocado — con el agravante de que este código decide **qué se le manda a un cliente**.

**Files (en `C:\Users\RodrigoWork\Desktop\wa-inbox-next`):**
- Create: `lib/responder-ia.js`
- Modify: `app/api/webhook/route.js`

**Interfaces:**
- Produces:
  - `enviarSaliente(origin, body)` — POST a `/api/saliente` con `auto: true`.
  - `responderConIA(origin, phone, name, message, canal, source = 'webhook')` — llama al agente y manda su respuesta (texto primero, luego cada foto).

- [ ] **Step 1: Crear el módulo con las piezas movidas**

Crear `lib/responder-ia.js` moviendo **tal cual**, sin cambiar lógica: la constante `RE_IMG` (hoy línea 53), `AGENT_URL` y `AGENT_KEY` (líneas 28-29), `enviarSaliente` (líneas 64-70) y `responderConIA` (líneas 86-122).

Dos únicos cambios permitidos:
1. `export` delante de `enviarSaliente` y `responderConIA`.
2. `responderConIA` gana un parámetro final `source = 'webhook'`, y en el cuerpo del `fetch` pasa `source` en vez del literal `'webhook'`.

Encabezar el archivo con:

```js
// lib/responder-ia.js — Llamar al agente y mandar su respuesta al cliente.
//
// Vive acá y no dentro del webhook porque hay DOS orígenes: un mensaje entrante
// (source 'webhook') y el cron de seguimientos despertando al bot en un chat
// callado (source 'seguimiento'). El agente distingue por ese campo.
//
// Copiar este código en vez de compartirlo es lo que produjo el bug de las fotos
// saliendo por el número equivocado — y acá el trozo duplicado decidiría QUÉ se le
// manda a un cliente.
```

- [ ] **Step 2: Enchufarlo en el webhook**

En `app/api/webhook/route.js`: borrar las cuatro piezas movidas y añadir junto a los demás imports de `@/lib`:

```js
import { enviarSaliente, responderConIA } from '@/lib/responder-ia'
```

`MSG_ESPERA` **se queda** en el webhook: es del handoff a soporte, no del agente.

- [ ] **Step 3: Comprobar que no quedó nada suelto**

Run: `grep -n "async function enviarSaliente\|async function responderConIA\|const RE_IMG\|const AGENT_URL\|const AGENT_KEY" app/api/webhook/route.js`
Expected: **sin resultados**. Si aparece alguna, quedó una copia.

Run: `grep -n "enviarSaliente(\|responderConIA(" app/api/webhook/route.js`
Expected: las llamadas de siempre (el mensaje de espera, los dos saludos, LINKPAGO y la auto-respuesta), todas resolviéndose ahora contra el import.

- [ ] **Step 4: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: **78** pruebas en verde y build limpio. Si alguna de las 78 se rompe, el movimiento no fue puro.

- [ ] **Step 5: Commit**

```bash
git add lib/responder-ia.js app/api/webhook/route.js
git commit -m "refactor(ia): mover a lib/responder-ia.js lo que llama al agente

El cron de seguimientos necesita exactamente esto para despertar al bot. Se mueve
en vez de copiarse: copiarlo es lo que produjo el bug de las fotos saliendo por el
numero equivocado, y aqui el codigo duplicado decidiria QUE se le manda a un
cliente.

Movimiento puro, sin cambios de logica. Lo unico que se agrega es un parametro
`source` con valor por defecto 'webhook', para que el cron pueda pasar
'seguimiento' sin alterar el comportamiento actual.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: La función que decide el camino (`wa-inbox-next`)

**Files:**
- Create: `lib/camino-seguimiento.js`
- Test: `tests/camino-seguimiento.test.js`

**Interfaces:**
- Consumes: `decidirIA({ config, phoneId, contacto })` de `lib/ia-canal.js`.
- Produces: `caminoDeSeguimiento({ config, contacto }) → 'despertar' | 'texto' | 'saltar'`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/camino-seguimiento.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { caminoDeSeguimiento } from '../lib/camino-seguimiento.js'

const MANDI = '1024077200794372'
const cfgConBot    = { ia: { MANDI: true },  seguimientos: { solo_ia_apagada: false } }
const cfgSinBot    = { ia: { MANDI: false }, seguimientos: { solo_ia_apagada: false } }
const cfgViejo     = { ia: { MANDI: true },  seguimientos: { solo_ia_apagada: true } }
const chatConIA    = { phoneId: MANDI, modoIA: true }
const chatSinIA    = { phoneId: MANDI, modoIA: false }

test('bot activo y funcion encendida: se DESPIERTA al bot', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgConBot, contacto: chatConIA }), 'despertar')
})

test('bot apagado por el chat: sale el TEXTO automatico', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgConBot, contacto: chatSinIA }), 'texto')
})

test('bot apagado por el canal: sale el TEXTO, aunque el chat diga IA', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgSinBot, contacto: chatConIA }), 'texto')
})

test('con solo_ia_apagada en true se conserva lo de hoy: SALTAR', () => {
  assert.equal(caminoDeSeguimiento({ config: cfgViejo, contacto: chatConIA }), 'saltar')
})

test('con solo_ia_apagada en true y el bot apagado, igual sale el TEXTO', () => {
  assert.equal(caminoDeSeguimiento({ config: { ia: { MANDI: false }, seguimientos: { solo_ia_apagada: true } }, contacto: chatSinIA }), 'texto')
})

test('sin config no lanza y trata al bot como activo', () => {
  assert.equal(caminoDeSeguimiento({ config: null, contacto: chatConIA }), 'saltar')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/camino-seguimiento.js'`

- [ ] **Step 3: Escribir el módulo**

Crear `lib/camino-seguimiento.js`:

```js
// lib/camino-seguimiento.js — ¿Qué hace el cron con este chat?
//
// Antes el cron decidía con `seg.solo_ia_apagada && c.modoIA === true`, que mira el
// interruptor por CHAT y no el cortafuegos por NÚMERO. Con el número apagado pero el
// chat marcado en IA, se saltaba el chat creyendo que "lo maneja el bot" — y el bot
// estaba detenido. Ese lead se quedaba sin nadie.
//
// `solo_ia_apagada` pasa a ser el interruptor de la funcionalidad nueva:
//   true  (como está hoy) → los chats con el bot activo se SALTAN, igual que antes.
//   false                 → esos chats DESPIERTAN al bot.
import { decidirIA } from './ia-canal.js'

/**
 * @returns {'despertar'|'texto'|'saltar'}
 *   'despertar' → llamar al agente para que retome él la conversación
 *   'texto'     → mandar el texto automático de la regla
 *   'saltar'    → no hacer nada con este chat
 */
export function caminoDeSeguimiento({ config, contacto }) {
  const botActivo = decidirIA({
    config,
    phoneId: contacto?.phoneId,
    contacto,
  })
  if (!botActivo) return 'texto'
  // El bot va a contestar: o lo despertamos, o lo dejamos en paz.
  return config?.seguimientos?.solo_ia_apagada === false ? 'despertar' : 'saltar'
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS — **84** pruebas (78 previas + 6 nuevas), 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add lib/camino-seguimiento.js tests/camino-seguimiento.test.js
git commit -m "feat(cron): funcion pura que decide que hacer con cada chat

Tres caminos: despertar al bot, mandar el texto automatico, o saltar. Se extrae
para poder PROBARLA: es la unica logica de verdad del cambio, el resto es llamar
al agente y enviar.

Usa decidirIA(), la misma funcion que el webhook. Antes el cron decidia mirando el
interruptor por CHAT y no el cortafuegos por NUMERO, asi que con el numero apagado
y el chat en IA se saltaba el chat creyendo que lo manejaba el bot -y el bot estaba
detenido-: ese lead se quedaba sin nadie.

solo_ia_apagada pasa a ser el interruptor de la funcionalidad: en true, que es como
esta hoy, el comportamiento no cambia.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Enchufar el cron (`wa-inbox-next`)

**Files:**
- Modify: `app/api/cron/seguimientos/route.js`

**Interfaces:**
- Consumes: `caminoDeSeguimiento({ config, contacto })` (Task 3) y `responderConIA(origin, phone, name, message, canal, source)` (Task 2).

- [ ] **Step 1: Imports**

Añadir al principio de `app/api/cron/seguimientos/route.js`:

```js
import { caminoDeSeguimiento } from '@/lib/camino-seguimiento'
import { responderConIA } from '@/lib/responder-ia'
```

- [ ] **Step 2: Sustituir el filtro viejo**

Buscar esta línea dentro del bucle de contactos:

```js
    if (seg.solo_ia_apagada && c.modoIA === true) continue // IA prendida → la maneja el agente
```

Reemplazarla por:

```js
    // Tres caminos posibles; ver lib/camino-seguimiento.js.
    const camino = caminoDeSeguimiento({ config: cfg, contacto: c })
    if (camino === 'saltar') continue
```

**Ojo con el nombre de la variable de configuración:** en ese archivo la config completa está en `cfg` y el bloque de seguimientos en `seg`. `caminoDeSeguimiento` necesita la **completa** (`cfg`), porque mira tanto `ia` como `seguimientos`. Confírmalo leyendo el principio de la función `GET`.

- [ ] **Step 3: Ramificar el envío**

Localizar el bloque que hace el envío (el `try` con `fetch(\`${origin}/api/saliente\`…)` y el `marcarSeguimiento`). Sustituir **solo la parte que envía**, conservando el `marcarSeguimiento`, el `enviados.push` y el manejo de errores:

```js
    try {
      let ok = false
      if (camino === 'despertar') {
        // El bot está activo: que retome él la conversación. `responderConIA` ya
        // manda lo que el agente devuelva (texto y fotos) por el canal correcto.
        await responderConIA(origin, c.telefono, c.alias || c.nombre || '', '', c.phoneId, 'seguimiento')
        ok = true
      } else {
        const r = await fetch(`${origin}/api/saliente`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            Telefono: c.telefono,
            Nombre: c.alias || c.nombre || '',
            Mensaje: regla.texto.trim(),
            Canal: c.phoneId,
          }),
        })
        ok = r.ok
      }
      if (ok) {
        await marcarSeguimiento(c.telefono).catch(() => {})
        enviados.push({ telefono: c.telefono, temp, camino })
      } else {
        errores.push({ telefono: c.telefono, camino })
      }
    } catch (e) {
      errores.push({ telefono: c.telefono, camino, error: e.message })
    }
```

> `marcarSeguimiento` se llama **por los dos caminos**: el tope de uno por ventana
> tiene que valer igual si al cliente lo atendió el bot o el texto fijo. Si solo se
> marcara en uno, el otro podría repetir el mensaje en la misma ventana.

- [ ] **Step 4: Comprobar que la regla del texto sigue aplicando donde debe**

Run: `grep -n "regla" app/api/cron/seguimientos/route.js`
Expected: las comprobaciones de `regla.activo`, `regla.texto` y `regla.horas` siguen **antes** del envío. El camino `'despertar'` no usa `regla.texto`, pero sí depende de `regla.activo` y de las horas: despertar al bot en un chat que no cumple la regla sería mandar un mensaje que nadie pidió.

- [ ] **Step 5: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: 84 pruebas en verde, build limpio.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/seguimientos/route.js
git commit -m "feat(cron): despertar al bot en vez de saltarse el chat

Con el bot activo el cron lo despierta (source 'seguimiento'); con el bot apagado
manda el texto automatico de siempre. Cada chat cae ahora en un camino o en el
otro: antes, con el numero apagado y el chat marcado en IA, no caia en ninguno.

marcarSeguimiento se llama por los DOS caminos: el tope de uno por ventana vale
igual si al cliente lo atendio el bot o el texto fijo.

El despliegue no cambia nada: solo_ia_apagada sigue en true y con ese valor el
comportamiento es identico al de hoy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Desplegar y verificar

El agente primero: si el inbox mandara la señal antes, cada despertar daría 400.

**Files:** ninguno.

- [ ] **Step 1: Desplegar el agente**

En `C:\Users\RodrigoWork\Desktop\mandi-agent`:

```bash
git push origin main
```

Confirmar en Vercel que el deployment de producción de `mandi-agent` está `READY` con ese SHA.

- [ ] **Step 2: Comprobar que el camino normal del agente sigue vivo**

Que un cliente escriba a MANDI (o escribirle desde otro teléfono) a un chat con la IA prendida y confirmar que el bot responde como siempre.

> Si la cuenta de Anthropic **sigue sin créditos**, el agente devolverá error en los
> dos caminos y este paso no se puede hacer. En ese caso, anotarlo y **no encender la
> funcionalidad** (Step 6) hasta que haya créditos.

- [ ] **Step 3: Desplegar el inbox**

En `C:\Users\RodrigoWork\Desktop\wa-inbox-next`:

```bash
npm test && npm run build && git push origin main
```

- [ ] **Step 4: Confirmar que NO cambió nada**

Llamar al cron a mano con la clave (`CRON_SECRET` está en Vercel):

```bash
curl -s -H "Authorization: Bearer <CRON_SECRET>" https://wa-inbox-v2.vercel.app/api/cron/seguimientos
```

Expected: `{"ok":true,"enviados":0,...}` o lo que corresponda **según los chats de ese momento**, pero en ningún caso un `camino: "despertar"` en el detalle: con `solo_ia_apagada` en `true` esa rama no puede ejecutarse todavía.

- [ ] **Step 5: Prueba controlada del despertar**

Con créditos disponibles, y sobre **un chat propio**, no de un cliente:

1. Escribirle a MANDI desde un teléfono propio y dejar ese chat con la IA prendida.
2. Marcarlo 🔥 caliente en el inbox.
3. En la base, poner su `ultimo_entrante_at` a 23 horas atrás para que entre en la ventana:

```sql
update inbox.conversaciones
set ultimo_entrante_at = now() - interval '23 hours', ultimo_seguimiento_at = null
where cuenta = 'MANDI' and telefono = '<tu numero>';
```

4. Poner `solo_ia_apagada` en `false` desde la pestaña AUTOS o en la base.
5. Llamar al cron a mano con la clave y confirmar que el detalle trae `camino: "despertar"` y que **al teléfono llega una reanudación escrita por el bot**, no el texto fijo.
6. Comprobar que el mensaje quedó en la bandeja de ese chat.

- [ ] **Step 6: Decidir si queda encendido**

Si la reanudación del paso 5 suena bien, dejar `solo_ia_apagada` en `false`. Si no, volver a `true` y ajustar la instrucción del agente (Task 1, Step 3) antes de reintentar.

---

## Notas para el que ejecute

- **El agente va antes que el inbox.** Es la única dependencia dura entre los dos repos.
- **Esto cuesta tokens de Anthropic**: cada despertar es una llamada. Sin créditos, el agente falla y el cron registra el error sin mandar nada — ningún cliente recibe nada raro, pero tampoco recibe seguimiento.
- El cron corre **cada hora** desde hoy. Con `solo_ia_apagada` en `false`, cada pasada puede despertar a varios chats: mira el `enviados` de la respuesta antes de irte.
- IND queda fuera a propósito: su configuración no tiene bloque `seguimientos` y le falta `CRON_SECRET`, así que su cron ni corre.
