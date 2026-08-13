# Arreglos pendientes + port a IND — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los tres pendientes que dejó la revisión final en MANDI, hacer el horario editable desde el AUTO, y recién entonces portar todo a IND con su propio grupo de Telegram.

**Architecture:** Dos pasadas. La primera toca solo `wa-inbox-next` (MANDI) y deja el código en el estado que IND necesita. La segunda copia ese estado a `ind-inbox-next`, que hoy tiene el código de julio intacto.

**Tech Stack:** Next.js (App Router), Supabase (schema `inbox`, separado por columna `cuenta`), Vercel Cron, `node --test`.

## Por qué este orden

Medido el 13-ago-2026:

| | Pendientes | Avisaría hoy | Arrastre (+24h) |
|---|---|---|---|
| MANDI | 10 | 3 | 7 |
| **IND** | **284** | **70** | **206** |

IND no es MANDI a otra escala: es otro problema. Dos cosas que en MANDI nunca se iban a ver y en IND pasan en la primera corrida:

1. **El sello es un bucle secuencial.** 70 chats × 2 viajes a Supabase = 140 consultas contra `maxDuration = 60`. Si se corta a la mitad, **Telegram ya mandó y las marcas no se guardaron** → el mismo aviso se repite cada 5 minutos hasta drenar. Lo predijo la revisión final; con 3 chats era invisible.
2. **El aviso sería un muro.** "70 chats esperando respuesta hoy" cada 30 minutos no mueve a nadie.

Portar antes de arreglar significa estrenar en IND justo el defecto que ahí sí se rompe.

### ⚠️ CORRECCIÓN — lo anterior estaba mal, y Rodrigo hizo bien en pedir que lo confirmara

La primera lectura fue "arrastre viejo, peso muerto". **Falso.** Al desglosar por semana:

```
2026-07-06     1 chat
2026-07-27    57
2026-08-03    56
2026-08-10   169   <- esta semana
```

**169 de los 284 son de esta semana**, ninguno tiene venta asociada y casi ninguno tiene
temperatura clasificada. No es basura acumulada durante años: es entrada reciente sin contestar,
a un ritmo de ~40 clientas por día. Marcarlas como atendidas habría enterrado conversaciones
vivas de hace tres días.

(Los estados están limpios: `PENDIENTE` 285 · `ATENDIDO` 2405 · `ARCHIVADO` 3 · `SOPORTE` 3 ·
`VENTA` 1, sin nulos ni vacíos. Un solo registro con fecha de 2017, que es un dato corrupto suelto.)

**Decisión de Rodrigo (13-ago), con esos números en la mano: en IND va SOLO el push, nada de
Telegram.** Con 284 pendientes reales, un recordatorio cada 30 minutos sería cierto e inútil —
IND no tiene un problema de recordatorio, tiene uno de capacidad, y una alerta no lo arregla.

**Consecuencia sobre el orden:** el motivo para arreglar antes de portar era el riesgo del sello
secuencial con los 70 avisos de IND. Sin Telegram en IND ese riesgo desaparece, así que el port
del push pasa PRIMERO y los arreglos de MANDI van después. Las Tasks 5 y 6 quedan canceladas.

## Global Constraints

- **Rama `main` siempre**, en los dos repos. Nada de ramas: Supabase solo existe en Production.
- **`node --test` NO entiende `@/`.** Lo testeable vive en `lib/` y se importa relativo. Las rutas de `app/` sí pueden usar `@/`.
- **Español ecuatoriano con TUTEO.** Nada de voseo. Commits en ASCII plano sin tildes.
- **NUNCA `git add -A` ni `git add .`** en ninguno de los dos repos.
- **Variables de entorno por el PANEL WEB de Vercel**, jamás por PowerShell (BOM invisible).
- **Ningún agente hace `git push`.** El despliegue lo lanza el controlador con permiso de Rodrigo.
- MANDI arranca en 282 pruebas / 0 fallos. IND arranca donde esté; medirlo antes de tocar.

## Estructura

| Archivo | Repo | Acción |
|---|---|---|
| `lib/pendientes.js` | MANDI | Conteo honesto del arrastre |
| `app/api/cron/pendientes/route.js` | MANDI | Sello en paralelo + lectura después del horario + config |
| `lib/automatizaciones.js` | MANDI | `DEFAULTS.pendientes` |
| `components/Automatizaciones.jsx` | MANDI | Tarjeta editable |
| `lib/push.js`, `public/sw.js`, `app/api/webhook/route.js`, `components/PushToggle.jsx`, `app/api/push/subscribe/route.js` | IND | Port de la parte A |
| `lib/telegram.js`, `lib/pendientes.js`, `app/api/cron/pendientes/route.js`, `middleware.js`, `vercel.json`, `lib/rutas-publicas.js` | IND | Port de la parte C |

---

## PASADA 1 — MANDI

### Task 1: el arrastre deja de ser invisible

Los dos revisores, por separado, levantaron esto: al cruzar las 24 h un chat desaparece del aviso **y del conteo**, y un Telegram callado se lee como "bandeja limpia". Falsa calma.

**Files:**
- Modify: `lib/pendientes.js`
- Test: `tests/pendientes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `chatsQueAvisar` sin cambios de firma. **Nuevo:** `partirPorAntiguedad(contactos, ahoraMs) => {recientes, arrastre}` exportado de `lib/pendientes.js`. `textoAviso(chats, ahoraMs, baseUrl, arrastre = 0)` gana un cuarto parámetro opcional.

- [ ] **Step 1: Escribir las pruebas que fallan**

```js
test('partirPorAntiguedad separa lo de hoy del arrastre', () => {
  const lista = [
    chat({ telefono: '1', ultimoEntranteAt: haceMin(30) }),
    chat({ telefono: '2', ultimoEntranteAt: new Date(AHORA - 45 * 24 * 60 * MIN).toISOString() }),
    chat({ telefono: '3', ultimoEntranteAt: haceMin(2) }),   // no llega al minimo
  ]
  const { recientes, arrastre } = partirPorAntiguedad(lista, AHORA)
  assert.equal(recientes.length, 1, 'solo el de 30 min')
  assert.equal(arrastre.length, 1, 'solo el de 45 dias')
})

test('el arrastre NO incluye chats que no llegan al minimo de espera', () => {
  const { arrastre } = partirPorAntiguedad([chat({ ultimoEntranteAt: haceMin(2) })], AHORA)
  assert.equal(arrastre.length, 0)
})

test('el texto nombra el arrastre cuando lo hay', () => {
  const r = chatsQueAvisar([chat({ nombre: 'Ana' }), chat({ telefono: '9', nombre: 'Bea' })], AHORA)
  const t = textoAviso(r, AHORA, 'https://inbox.test', 206)
  assert.ok(t.includes('206'), `debe decir cuantos arrastra, salio: ${t}`)
})

test('sin arrastre, el texto no inventa un parentesis vacio', () => {
  const r = chatsQueAvisar([chat({ nombre: 'Ana' })], AHORA)
  const t = textoAviso(r, AHORA, 'https://inbox.test', 0)
  assert.ok(!t.includes('('), `no debe haber parentesis, salio: ${t}`)
})

test('textoAviso sin el cuarto argumento se comporta como antes', () => {
  const r = chatsQueAvisar([chat({ nombre: 'Ana' })], AHORA)
  assert.equal(textoAviso(r, AHORA, 'https://inbox.test'), textoAviso(r, AHORA, 'https://inbox.test', 0))
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test tests/pendientes.test.js`
Expected: FAIL — `partirPorAntiguedad` no existe.

- [ ] **Step 3: Implementar**

`partirPorAntiguedad` aplica el mínimo de espera a los dos lados y parte por `ESPERA_MAXIMA_MS`. `chatsQueAvisar` se queda como está (sigue devolviendo solo los recientes, ya filtrados por horario y anti-repetición). `textoAviso` suma el cuarto parámetro y, **solo si es > 0**, agrega una línea del tipo `(+206 de más de un día)`.

⚠️ El arrastre NO se estampa ni se cuenta como avisado: solo se menciona. Estamparlo lo silenciaría para siempre.

- [ ] **Step 4: Correr las pruebas**

Run: `npm test`
Expected: PASS, sin bajar de 282.

- [ ] **Step 5: Commit**

```bash
git add lib/pendientes.js tests/pendientes.test.js
git commit -m "fix(pendientes): el arrastre deja de ser invisible

Al cruzar las 24h un chat desaparecia del aviso Y del conteo, y un
Telegram callado se lee como bandeja limpia. Pasaba de falsa urgencia a
falsa calma. Ahora el techo decide el TITULAR, no la existencia."
```

---

### Task 2: el sello en paralelo y la lectura después del horario

**Files:**
- Modify: `app/api/cron/pendientes/route.js`

**Interfaces:**
- Consumes: `partirPorAntiguedad`, `textoAviso` (Task 1).
- Produces: nada nuevo.

- [ ] **Step 1: Mover el chequeo de horario arriba de la lectura**

Hoy `getContactos(null)` pagina la tabla entera y recién después `chatsQueAvisar` descubre que son las 03:00. Son ~132 lecturas inútiles por día, y una caída de Supabase de madrugada devuelve un 500 por trabajo que no había que hacer.

Poner `if (!enHorarioLaboral(ahora))` y devolver `{ok:true, avisados:0, pendientes:0, motivo:'fuera-de-horario'}` **antes** de leer.

- [ ] **Step 2: Paralelizar el sello**

El bucle secuencial es el riesgo real de IND: 70 chats × 2 viajes contra `maxDuration = 60`. Reemplazarlo por `Promise.all` sobre los mismos `marcarAvisoTelegram`, conservando el `.catch` por chat para que un fallo no tumbe al resto.

⚠️ Sigue yendo **después** del envío exitoso y sigue esperándose (`await Promise.all(...)`). Si se pierde ese `await`, la función devuelve y se congela antes de que aterricen las marcas — y el aviso se repite cada 5 minutos para siempre.

- [ ] **Step 3: Pasar el arrastre al texto**

Usar `partirPorAntiguedad` y pasar `arrastre.length` como cuarto argumento de `textoAviso`.

- [ ] **Step 4: Verificar**

Run: `npm run build && npm test`
Expected: build exitoso, 282+ pruebas, 0 fallos.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/pendientes/route.js
git commit -m "fix(pendientes): sello en paralelo y no leer fuera de horario

Con los 70 chats que IND avisaria hoy, el bucle secuencial son 140
consultas contra maxDuration=60: si se corta, Telegram ya mando y las
marcas no se guardaron, y el aviso se repite cada 5 min hasta drenar."
```

---

### Task 3: el horario y los umbrales, editables desde el AUTO

**Files:**
- Modify: `lib/automatizaciones.js`, `lib/pendientes.js`, `app/api/cron/pendientes/route.js`, `components/Automatizaciones.jsx`
- Test: `tests/pendientes.test.js`

**Interfaces:**
- Consumes: Tasks 1 y 2.
- Produces: `DEFAULTS.pendientes = { activo, horaAbre, horaCierra, esperaMinimaMin, repetirCadaMin, techoHoras }`. Las funciones de `lib/pendientes.js` aceptan un objeto de opciones con esos valores; **sin él siguen usando las constantes de hoy**, así que nada se rompe si la config no existe.

- [ ] **Step 1: Escribir las pruebas que fallan**

Probar que cada valor de la config manda sobre su constante: un `horaAbre: 6` hace laboral las 06:30; un `esperaMinimaMin: 30` calla un chat de 20 min; un `techoHoras: 48` deja entrar uno de 30 h; y que **sin config, el comportamiento es idéntico al de hoy** (esta última es la que protege lo que ya funciona).

- [ ] **Step 2: Correr y ver que falla**

Run: `node --test tests/pendientes.test.js`

- [ ] **Step 3: `DEFAULTS.pendientes` en `lib/automatizaciones.js`**

Con los valores actuales: `activo: true, horaAbre: 8, horaCierra: 21, esperaMinimaMin: 10, repetirCadaMin: 30, techoHoras: 24`. Sigue el patrón de `seguimientos`, que ya está ahí.

- [ ] **Step 4: Que `lib/pendientes.js` acepte opciones**

Sin tocar las firmas existentes de forma incompatible: parámetro opcional al final, con las constantes como default.

- [ ] **Step 5: Que el cron lea la config**

`getAutomatizaciones()` ya existe y nunca lanza. Si `pendientes.activo` es `false`, el cron responde `{ok:true, avisados:0, motivo:'apagado'}` — visible en los registros, no un silencio mudo.

- [ ] **Step 6: La tarjeta en `components/Automatizaciones.jsx`**

Una `Card` con el `Switch` de encendido y cuatro campos numéricos. Seguir el estilo de la tarjeta de seguimientos que ya está en ese archivo. Validar en la pantalla que `horaAbre < horaCierra` y que los minutos sean positivos.

- [ ] **Step 7: Verificar y commitear**

Run: `npm run build && npm test`

```bash
git add lib/automatizaciones.js lib/pendientes.js app/api/cron/pendientes/route.js components/Automatizaciones.jsx tests/pendientes.test.js
git commit -m "feat(pendientes): horario y umbrales editables desde la pestana AUTO"
```

---

## PASADA 2 — IND

⚠️ **Verificado el 13-ago antes de escribir esto, contra producción y no contra la memoria:**
- IND redirige a `crm.apps.mandarinaec.com` sin sesión (**307**) y su `/api/push/subscribe` da **401**. O sea que su candado **sí bloquea**, y quitarle `PUSH_CLAVE` es tan seguro como lo fue en MANDI. La memoria decía que el login de IND estaba pendiente y el comentario de su propio `middleware.js` dice que "sale en observar": **las dos fuentes están desactualizadas.**
- La columna `ultimo_aviso_telegram_at` ya existe: la tabla es compartida y se separa por `cuenta`. **No hay migración en esta pasada.**
- IND **no tiene `CRON_SECRET`**. Sin él, el cron nuevo queda protegido solo por la cabecera `x-vercel-cron`, que es falsificable. Hay que crearlo antes de desplegar.
- IND tiene `TELEGRAM_BOT_TOKEN` (el mismo bot compartido) y **no** tiene `TELEGRAM_CHAT_ID`.

### Task 4: portar la parte A a IND

Copiar de MANDI, adaptando nombres de cuenta donde aplique: `lib/push.js` (`debeSonar` + `avisoDeEntrante` + `renotify` en el payload), `public/sw.js`, `app/api/webhook/route.js`, `components/PushToggle.jsx`, `app/api/push/subscribe/route.js` (fuera `PUSH_CLAVE`), y las pruebas — incluida la reja estructural.

⚠️ IND tiene su **propio par de claves VAPID** y su propia `cuenta` en `inbox.push_subs`. No tocar nada de eso.

- [ ] Medir la línea base de pruebas de IND antes de empezar y no bajarla.
- [ ] Verificar que la reja estructural encuentre sus anclas en el `route.js` de IND, que puede diferir del de MANDI.
- [ ] `npm run build && npm test`, commit, **sin push**.

### Task 5: portar la parte C a IND, con su propio grupo

- [ ] `lib/telegram.js`, `lib/pendientes.js`, `app/api/cron/pendientes/route.js` y sus pruebas.
- [ ] `BASE_URL` por defecto: **`https://ind-inbox.apps.mandarinaec.com`** (verificar contra el `next.config.js` de IND, no asumir).
- [ ] `lib/rutas-publicas.js`, el `matcher` de `middleware.js` y `vercel.json` (`*/5 * * * *`), con su prueba.
- [ ] `DEFAULTS.pendientes` en el `lib/automatizaciones.js` de IND y la tarjeta en su `Automatizaciones.jsx`.
- [ ] `npm run build && npm test`, commit, **sin push**.

### Task 6: encender IND (manual, de Rodrigo)

- [ ] Crear el **grupo nuevo** de Telegram y meter al bot que ya existe. **NO crear bot nuevo ni reemplazar `TELEGRAM_BOT_TOKEN`**: lo comparten los avisos de CAPI y reemplazarlo los mata en silencio.
- [ ] Sacar el `chat_id` con @RawDataBot y cargarlo como `TELEGRAM_CHAT_ID` en el proyecto de IND, por el panel web.
- [ ] Crear `CRON_SECRET` en IND.
- [ ] Probar el transporte **antes** de desplegar: `sendMessage` directo con token + chat_id.
- [ ] Push, confirmar el build con `vercel ls --prod`, y confirmar que el alias saltó.
- [ ] Controles negativos: sin credenciales → 401; con `x-vercel-cron` falsificada → 401.
- [ ] Suscribir el celular y comprobar que aparece la fila con `user_agent` de Android **y `cuenta='IND'`**.

---

## Aparte: la limpieza de los 206

No es una tarea de este plan y **no la hace ningún automatismo**. La regla de Rodrigo es que nada saca un chat de Pendientes solo; una limpieza masiva sería una excepción deliberada a esa regla y la decide él, mirando una muestra primero.

Mientras no se haga, el aviso de IND va a decir `(+206 de más de un día)` en cada mensaje. Es feo y es honesto: refleja la bandeja real.
