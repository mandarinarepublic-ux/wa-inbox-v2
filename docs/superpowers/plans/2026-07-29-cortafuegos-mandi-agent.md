# Cortafuegos de MANDI AGENT — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un interruptor por número (MANDI / REPUBLIC) que corta las llamadas a MANDI AGENT de ese canal, sin tocar el control por chat que ya existe.

**Architecture:** La decisión se extrae a un módulo puro nuevo (`lib/ia-canal.js`) que no toca red ni base, así se puede probar de verdad. El webhook deja de decidir por su cuenta: su `modoIAde()` pasa a ser una envoltura fina sobre ese módulo. La config vive en `inbox.automatizaciones.config.ia` como booleanos planos con llave por id lógico de canal.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (jsonb), `node:test` + `node:assert`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-cortafuegos-mandi-agent-design.md`. Ante duda, manda el spec.
- **Producción = `main`.** Nada de ramas: Preview no sirve acá porque Supabase solo está en Production.
- Config por **id lógico** de canal (`MANDI`, `REPUBLIC`), **nunca** por `phone_id` — el `phone_id` cambia si el número se migra (spec §3.2).
- **Booleanos planos** (`ia: { MANDI: true }`), nunca `{activo: …}` — `merge()` es de un solo nivel (spec §3.1).
- Arranca **PRENDIDO**: el deploy no puede cambiar el comportamiento actual (spec §6).
- Canal desconocido **no bloquea** (spec §7).
- Comentarios y textos de interfaz en **español**, como todo el repo.
- Correr `npm test` (45 pruebas hoy, todas en verde) antes de cada commit.

---

### Task 1: Módulo puro de decisión (`lib/ia-canal.js`)

**Files:**
- Create: `lib/ia-canal.js`
- Test: `tests/ia-canal.test.js`

**Interfaces:**
- Consumes: `canalDePhoneId(phoneId)` de `lib/canales.js` (ya existe; devuelve `'MANDI'`, `'REPUBLIC'` o `null`).
- Produces:
  - `iaActivaEnCanal(config, phoneId) → boolean`
  - `decidirIA({ config, phoneId, contacto }) → boolean` — `contacto` es la fila de la agenda ya encontrada, o `undefined` si no está.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/ia-canal.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { iaActivaEnCanal, decidirIA } from '../lib/ia-canal.js'

// Los phone_id por defecto de lib/canales.js (sin env en las pruebas).
const MANDI    = '1024077200794372'
const REPUBLIC = '118582961194601'

test('sin config, la IA esta activa en los dos canales', () => {
  assert.equal(iaActivaEnCanal(null, MANDI), true)
  assert.equal(iaActivaEnCanal({}, REPUBLIC), true)
})

test('apagar REPUBLIC no apaga MANDI', () => {
  const cfg = { ia: { MANDI: true, REPUBLIC: false } }
  assert.equal(iaActivaEnCanal(cfg, MANDI), true)
  assert.equal(iaActivaEnCanal(cfg, REPUBLIC), false)
})

test('un canal desconocido NO bloquea (spec 7)', () => {
  const cfg = { ia: { MANDI: false, REPUBLIC: false } }
  assert.equal(iaActivaEnCanal(cfg, '999999999999'), true)
  assert.equal(iaActivaEnCanal(cfg, ''), true)
})

test('el cortafuegos gana sobre el chat en modo IA', () => {
  const cfg = { ia: { REPUBLIC: false } }
  const contacto = { telefono: '593987047531', modoIA: true }
  assert.equal(decidirIA({ config: cfg, phoneId: REPUBLIC, contacto }), false)
})

test('con el canal prendido manda el interruptor del chat', () => {
  const cfg = { ia: { MANDI: true } }
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: { modoIA: true } }), true)
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: { modoIA: false } }), false)
})

test('contacto que no esta en la agenda: IA apagada', () => {
  const cfg = { ia: { MANDI: true } }
  assert.equal(decidirIA({ config: cfg, phoneId: MANDI, contacto: undefined }), false)
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/ia-canal.js'`

- [ ] **Step 3: Escribir el módulo**

Crear `lib/ia-canal.js`:

```js
// lib/ia-canal.js — ¿Puede MANDI AGENT responder este mensaje?
//
// Dos rejas en serie, y el orden importa:
//   1. CORTAFUEGOS por número (config.ia.MANDI / .REPUBLIC) — apaga el bot entero
//      en ese canal, sin tocar el estado de ningún chat.
//   2. El interruptor por chat de siempre (conversaciones.modo_ia).
//
// Apagado global GANA: si el canal está apagado da igual que el chat esté en modo
// IA. Al volver a prenderlo, cada chat vuelve a como estaba: el cortafuegos tapa,
// no borra.
//
// Módulo PURO a propósito (sin red ni base): la decisión de si un bot le escribe a
// un cliente tiene que poder probarse.
import { canalDePhoneId } from './canales.js'

/**
 * ¿Está MANDI AGENT habilitado en el número por el que entró este mensaje?
 * Un canal DESCONOCIDO no bloquea: fallar cerrado dejaría el bot mudo en silencio
 * si el phone_id cambia (le pasó al 3326 de IND), y un bot mudo no se nota hasta
 * que se pierden ventas. Uno que gasta de más se ve en la factura.
 */
export function iaActivaEnCanal(config, phoneId) {
  const canal = canalDePhoneId(phoneId)
  if (!canal) return true
  return config?.ia?.[canal] !== false
}

/**
 * Decisión final para un mensaje concreto.
 * @param {{ config:object, phoneId:string, contacto?:{modoIA?:boolean} }} args
 *        `contacto` = la fila de la agenda ya encontrada, o undefined si no está.
 */
export function decidirIA({ config, phoneId, contacto }) {
  if (!iaActivaEnCanal(config, phoneId)) return false
  if (!contacto) return false // contacto nuevo → IA APAGADA (la prende un humano)
  return contacto.modoIA !== false
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS — 51 pruebas (45 previas + 6 nuevas), 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add lib/ia-canal.js tests/ia-canal.test.js
git commit -m "feat(ia): modulo puro que decide si MANDI AGENT puede responder

Extrae la decision a lib/ia-canal.js para poder PROBARLA: hoy vive dentro de
modoIAde(), una funcion anidada en el webhook que ningun test puede alcanzar.

Dos rejas en serie: el cortafuegos por numero y el interruptor por chat de
siempre. El apagado global gana, y no reescribe el estado de ningun chat: al
volver a prender, cada uno vuelve a como estaba.

Un canal desconocido NO bloquea. Fallar cerrado dejaria el bot mudo en silencio
si cambia el phone_id (le paso al 3326 de IND el 28-jul), y un bot mudo no se ve
hasta perder ventas; uno que gasta de mas se ve en la factura.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Default en la config + probar que un canal no borra el otro

**Files:**
- Modify: `lib/automatizaciones.js` (añadir `ia` a `DEFAULTS`, exportar `merge`)
- Test: `tests/automatizaciones-merge.test.js`

**Interfaces:**
- Produces: `DEFAULTS.ia = { MANDI: true, REPUBLIC: true }` y `merge(base, patch)` exportada.

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `tests/automatizaciones-merge.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert'
import { DEFAULTS, merge } from '../lib/automatizaciones.js'

test('la IA arranca PRENDIDA en los dos canales (el deploy no cambia nada)', () => {
  assert.equal(DEFAULTS.ia.MANDI, true)
  assert.equal(DEFAULTS.ia.REPUBLIC, true)
})

test('apagar un canal NO borra el otro (merge de un solo nivel)', () => {
  const base  = { ia: { MANDI: true, REPUBLIC: true } }
  const nueva = merge(base, { ia: { REPUBLIC: false } })
  assert.equal(nueva.ia.MANDI, true)
  assert.equal(nueva.ia.REPUBLIC, false)
})

test('tocar la IA no pisa los saludos ni los seguimientos', () => {
  const nueva = merge(DEFAULTS, { ia: { MANDI: false } })
  assert.equal(nueva.seguimientos.caliente.horas, 23)
  assert.ok(nueva.saludo_nuevo.texto.length > 0)
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test`
Expected: FAIL — `merge` no está exportada y `DEFAULTS.ia` es `undefined`.

- [ ] **Step 3: Modificar `lib/automatizaciones.js`**

Añadir al final del objeto `DEFAULTS` (después del bloque `seguimientos`, antes del `}` de cierre):

```js
  // CORTAFUEGOS de MANDI AGENT, uno por número. Llave = id LÓGICO del canal
  // (lib/canales.js), no el phone_id: el phone_id cambia si el número se migra de
  // cuenta y el interruptor quedaría huérfano.
  //
  // Booleano plano y no {activo}: merge() es de UN nivel, así que un patch anidado
  // borraría los hermanos (la mina que ya documenta el handoff para
  // seguimientos.caliente).
  //
  // Arranca PRENDIDO a propósito: a diferencia de los saludos y seguimientos —que
  // arrancan apagados porque MANDAN mensajes nuevos— esto solo deja de bloquear.
  // Si arrancara apagado, el deploy mataría el bot en silencio.
  ia: { MANDI: true, REPUBLIC: true },
```

Y cambiar la línea 39 de `function merge(base, patch) {` a:

```js
export function merge(base, patch) {
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test`
Expected: PASS — 54 pruebas, 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add lib/automatizaciones.js tests/automatizaciones-merge.test.js
git commit -m "feat(ia): default del cortafuegos y prueba de que un canal no borra el otro

ia: {MANDI:true, REPUBLIC:true}. Booleano plano, con llave por id LOGICO del
canal: el phone_id cambia si el numero se migra (3326 de IND, 28-jul) y el
interruptor quedaria apuntando a un numero que ya no existe.

Arranca PRENDIDO: solo deja de bloquear, no manda nada. Si arrancara apagado el
deploy matarian el bot en silencio.

Se exporta merge() para poder probar la mina de siempre: que el merge de UN
nivel no borre el canal hermano ni los bloques vecinos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Enchufar el guard en el webhook

**Files:**
- Modify: `app/api/webhook/route.js` (import, `modoIAde` en ~195-199, llamadas en ~251 y ~334)

**Interfaces:**
- Consumes: `decidirIA({config, phoneId, contacto})` de la Task 1.
- Produces: nada nuevo. `modoIAde(phone, phoneId)` pasa a recibir un segundo parámetro.

> Los dos únicos usos de `modoIAde()` son las líneas 251 y 334, y **los dos ya
> tienen el canal a mano** (`saludarSiCorresponde` lo recibe como `canal`, y la
> auto-respuesta tiene `m.phoneId`). Verificado con
> `grep -n "modoIAde(" app/api/webhook/route.js`.

- [ ] **Step 1: Añadir el import**

En la cabecera de `app/api/webhook/route.js`, junto a los demás imports de `@/lib`:

```js
import { decidirIA } from '@/lib/ia-canal'
```

- [ ] **Step 2: Reemplazar `modoIAde` (líneas ~195-199)**

Buscar exactamente:

```js
  const modoIAde = (phone) => {
    const t = tail9(phone)
    const c = contactos.find(c => tail9(c.telefono) === t)
    return c ? c.modoIA !== false : false // contacto nuevo → IA APAGADA (la prende un humano)
  }
```

Reemplazar por:

```js
  // El CORTAFUEGOS por número se aplica ACÁ y no en cada sitio que llama al
  // agente: una sola fuente. Es la lección de los 4 bugs del 27-29 jul, donde
  // había cuatro caminos hacia /api/saliente y solo uno inyectaba el canal.
  const modoIAde = (phone, phoneId) => {
    const t = tail9(phone)
    const contacto = contactos.find(c => tail9(c.telefono) === t)
    return decidirIA({ config: auto, phoneId, contacto })
  }
```

- [ ] **Step 3: Pasar el canal en los dos usos**

Línea ~251, dentro de `saludarSiCorresponde(phone, name, canal)`:

```js
    if (!auto || modoIAde(phone, canal)) return
```

Línea ~334, en la auto-respuesta:

```js
    if (modoIAde(m.telefono, m.phoneId)) {
```

- [ ] **Step 4: Verificar que no quedó ningún uso sin canal**

Run: `grep -n "modoIAde(" app/api/webhook/route.js`
Expected: exactamente 3 líneas — la definición y los dos usos, **los dos con dos argumentos**. Si alguna llamada tiene un solo argumento, `phoneId` llega `undefined` → `canalDePhoneId` devuelve `null` → el cortafuegos **no** se aplicaría en ese camino.

- [ ] **Step 5: Correr pruebas y build**

Run: `npm test && npm run build`
Expected: 54 pruebas en verde y build sin errores.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.js
git commit -m "feat(ia): el webhook respeta el cortafuegos por numero

modoIAde() pasa a delegar en decidirIA() y a recibir el canal. El guard vive en
UN solo lugar: no puede pasar que la auto-respuesta lo respete y el saludo no.

Los dos usos ya tenian el canal a mano (saludarSiCorresponde lo recibe como
'canal', la auto-respuesta como m.phoneId), asi que no hay que arrastrar nada
nuevo por la cadena.

Efecto lateral anotado en el spec 5: al apagar un canal, modoIAde devuelve false
y el saludo automatico se vuelve elegible. Hoy es inocuo porque saludo_nuevo
esta apagado desde el 28-jul.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: La tarjeta en la pestaña AUTOS

**Files:**
- Modify: `components/Automatizaciones.jsx`

**Interfaces:**
- Consumes: `guardarInterruptor(patch, aplicar)` (ya existe, línea ~76: optimista y revierte si falla) y `Switch` (línea ~11).
- Produces: nada para otras tareas.

- [ ] **Step 1: Importar los canales**

En la cabecera de `components/Automatizaciones.jsx`:

```js
import { CANALES } from '@/lib/canales'
```

- [ ] **Step 2: Añadir el manejador**

Junto a `togBloque` / `togSegG` (línea ~92-98):

```js
  // Cortafuegos de MANDI AGENT, por canal. Patch plano: el merge del servidor es
  // de un nivel y con booleanos eso es exactamente lo que queremos (el canal
  // hermano se conserva solo).
  const togIA = (canalId, valor) => guardarInterruptor(
    { ia: { [canalId]: valor } },
    prev => ({ ...prev, ia: { ...(prev?.ia || {}), [canalId]: valor } }))
```

- [ ] **Step 3: Añadir la tarjeta arriba de todo**

Justo antes de la tarjeta de `saludo_nuevo` (línea ~155, la primera del listado). Es la más importante: va primera.

```jsx
      {/* CORTAFUEGOS: apaga MANDI AGENT entero en un número. Va primero a
          propósito — es el botón de pánico, no puede estar enterrado abajo. */}
      <div style={{ background:'#0b1220', border:'1px solid #1e293b', borderRadius:14, padding:16, marginBottom:14 }}>
        <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>🤖 MANDI AGENT</div>
        <div style={{ fontSize:12, color:'#94a3b8', marginBottom:12 }}>
          Respuestas automáticas del bot, por número. Apagarlo aquí lo detiene en
          TODOS los chats de ese número, sin cambiar el ajuste de cada chat: al
          volver a prenderlo, cada conversación vuelve a como estaba.
        </div>
        {CANALES.map(c => {
          const on = config?.ia?.[c.id] !== false
          return (
            <div key={c.id} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, padding:'10px 12px', borderRadius:10, marginTop:8,
              background: on ? 'rgba(37,211,102,.06)' : 'rgba(239,68,68,.10)',
              border: `1px solid ${on ? 'rgba(37,211,102,.20)' : 'rgba(239,68,68,.35)'}`,
            }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>{c.etiqueta}</div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{c.titulo}</div>
                <div style={{ fontSize:11, fontWeight:700, marginTop:2, color: on ? '#25d366' : '#ef4444' }}>
                  {on ? 'Respondiendo' : '⛔ DETENIDO — el bot no contesta en este número'}
                </div>
              </div>
              <Switch on={on} onClick={() => togIA(c.id, !on)} />
            </div>
          )
        })}
      </div>
```

> El estado apagado se pinta en **rojo y con texto explícito**, no en gris: un
> número con el bot detenido no puede parecer un detalle (spec §8).

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev` y abrir la pestaña **AUTOS**.

Comprobar:
1. Se ven dos filas, **MANDI** y **REPUBLIC**, las dos en verde ("Respondiendo").
2. Al apagar REPUBLIC: se pone rojo y dice "⛔ DETENIDO", sale el toast `✅ Guardado`, y **MANDI sigue en verde**.
3. Recargar la página: REPUBLIC sigue apagado (se guardó de verdad, no solo en pantalla).
4. Volver a prenderlo y confirmar que queda en verde tras recargar.

- [ ] **Step 5: Confirmar en la base que se guardó lo que se ve**

```sql
select config->'ia' from inbox.automatizaciones where cuenta = 'MANDI';
```

Expected: refleja **exactamente** lo que muestra la pantalla. Si difieren, es el bug 4.4 del handoff otra vez (el switch que miente) y hay que parar.

- [ ] **Step 6: Commit**

```bash
git add components/Automatizaciones.jsx
git commit -m "feat(ia): interruptor de MANDI AGENT por numero en la pestana AUTOS

Tarjeta primera de la lista: es el boton de panico, no puede estar enterrado.
Recorre CANALES de lib/canales.js, asi que agregar un tercer numero no obliga a
tocar esta pantalla.

Reusa guardarInterruptor: se guarda solo y, si el guardado falla, el switch
VUELVE donde estaba en vez de mentir. El estado apagado se pinta en rojo y con
texto explicito -no en gris- porque un numero con el bot detenido no puede
parecer un detalle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificación en producción

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Correr todo antes de subir**

Run: `npm test && npm run build`
Expected: 54 pruebas en verde, build limpio.

- [ ] **Step 2: Subir a producción**

```bash
git push origin main
```

- [ ] **Step 3: Esperar el deploy y confirmar el commit vivo**

Comprobar en Vercel que el último deployment con `target: "production"` tiene el SHA que se acaba de subir.

- [ ] **Step 4: Prueba de humo con un mensaje real**

1. En AUTOS, **apagar** MANDI AGENT en REPUBLIC.
2. Desde otro teléfono, escribirle al **+593 97 910 4167** un texto cualquiera.
3. Confirmar que el mensaje **entra al inbox** y que el bot **no responde**.
4. Volver a **prender** REPUBLIC.
5. Escribir de nuevo y confirmar que el bot **sí responde** (en un chat que tenga la IA prendida).

> El paso 3 es el que importa: el mensaje tiene que **entrar igual**. Si al apagar
> el bot dejaran de llegar los mensajes, el cortafuegos estaría cortando de más.

- [ ] **Step 5: Confirmar que no rompió el otro número**

Con REPUBLIC apagado, comprobar que un chat de **MANDI** con la IA prendida sigue recibiendo respuesta del bot.

---

## Notas para el que ejecute

- **No** tocar `conversaciones.modo_ia` en ningún paso. El cortafuegos tapa, no borra.
- Si `npm run build` se queja de `@/lib/ia-canal`, revisar el alias `@` en `jsconfig.json` — el resto del repo ya lo usa así.
- Esto **no** apaga la IA de Meta. Eso se hace del lado de Meta (spec §1).
- **IND necesita el mismo cambio en su repo** (`ind-inbox-next`), y no está en este plan.
