# Avisos como WhatsApp: arreglar el push en el celular + Telegram de pendientes

Fecha: 2026-08-12 · Cuenta: MANDI (el punto A aplica igual a IND)

## El problema, medido

Rodrigo no oye nada en su celular cuando llegan mensajes. La hipótesis inicial era
que faltaba una app instalable. **Es falso, y los datos lo cierran.**

### Hallazgo 1 — el celular nunca estuvo suscrito

```sql
select count(*) as total,
       count(*) filter (where user_agent ilike '%Android%'
                           or user_agent ilike '%Mobile%'
                           or user_agent ilike '%iPhone%') as desde_celular
from inbox.push_subs;
→ total: 3 · desde_celular: 0
```

Las tres suscripciones que existen (2 MANDI, 1 IND) son `Windows NT 10.0 … Chrome`.
**Cero desde un celular, nunca.** Y el sistema está vivo: MANDI mandó 19 avisos en
48 h, IND 152. Todos aterrizaron en la PC.

O sea: no falta app. La PWA ya existe (`app/manifest.js` con `display:'standalone'`,
iconos 192/512, `public/sw.js`, y el `matcher` de `middleware.js` ya exime
`sw.js`, `icon-` y `manifest.webmanifest`). Lo que falta es la suscripción.

### Hallazgo 2 — por qué nunca se activó: el botón falla mudo

`components/PushToggle.jsx`:

- **Línea 106:** el único lugar donde se muestra el resultado es `title=`. Eso es un
  tooltip de *hover*. **En un celular el hover no existe: el `title` nunca se ve.**
  Si tocaste 🔕 y falló, el botón volvió a 🔕 sin decir nada.
- **Línea 42:** pide `PUSH_CLAVE` por `window.prompt`. Clave equivocada → 401 →
  mensaje "Clave incorrecta" que, por lo anterior, es invisible en el celular.
- El botón mide 28×28 px. Para dedo se recomienda 44.

No se puede saber desde la base si nunca se tocó el botón o si se tocó y falló en
silencio. **Los dos caminos terminan igual y los dos se arreglan con lo mismo.**

### Hallazgo 3 — el enfriamiento de 5 min es de flanco, no de estado

`lib/push.js:debeNotificar()` bloquea el aviso si ya hubo uno hace <5 min. Eso
convierte el sistema en **disparo por evento**: solo avisa cuando *entra* un
mensaje. Una clienta que escribe una vez y espera genera **un aviso en toda su
vida**. Si te lo perdiste, se perdió para siempre.

```sql
select lower(estado), count(*), max(espera_min) from inbox.conversaciones
where cuenta='MANDI' and ultimo_entrante_at > now() - interval '3 days' …
→ pendiente: 12 chats · el que más espera: 1.893 min ≈ 31 horas
```

**Doce chats esperando. El más viejo, 31 horas.** Su push ya se disparó y ya se apagó.

```sql
→ entrantes silenciados por el enfriamiento, 7 días: 9
```
⚠️ Ese 9 es un **piso, no el total**: `ultimo_entrante_at` solo guarda el último
entrante, así que como mucho cuenta uno por conversación. El real es mayor y no se
puede reconstruir con los datos que quedan.

Además contradice la regla de Rodrigo — *"si esa bandeja está vacía, contesté a
todos"*: la verdad de si toca contestar vive en **Pendientes**, no en si entró un
mensaje hace rato.

## Cómo funciona WhatsApp (el modelo a copiar)

1. **Notifica cada mensaje.** No hay enfriamiento por tiempo.
2. **Agrupa por chat.** Cinco mensajes seguidos de la misma persona son un aviso
   que se actualiza, no cinco avisos.
3. **Modera el SONIDO, no el aviso.** Suena en el primero de la ráfaga; los
   siguientes actualizan el aviso en silencio. Se pierde el ruido, nunca el dato.
4. **El estado se queda.** Negrita + globo hasta que abras el chat.

El punto 3 es la clave y es justo lo que falta: hoy el servidor decide *no avisar*,
cuando lo correcto es *avisar siempre y no volver a sonar*.

El punto 4 es lo que ningún push resuelve, y por eso existe la parte C.

## Diseño

### A — que el push suene, y suene como WhatsApp

**A1. Sacar la clave del botón.** Quitar el `window.prompt` de `PushToggle.jsx:42` y
la verificación de `PUSH_CLAVE` en `app/api/push/subscribe/route.js`. Esa tranca se
puso cuando el inbox no tenía login; desde el 7-ago **sí lo tiene**
(`middleware.js`, `AUTH_MODO=bloquear`), y el `matcher` ya cubre `/api/push/*`. Hoy
solo estorba y es la causa más probable del fallo mudo.

**A2. El resultado se muestra en pantalla.** Reemplazar el `title=` por el `Toast`
que ya existe en `components/Components.jsx`. Regla: **todo camino de `activar()` y
`desactivar()` termina en un mensaje visible**, incluidos los tres `catch`. Si algo
falla en el celular, tiene que verse en el celular.

**A3. Botón táctil.** 44×44 cuando el puntero es grueso; se mantiene 28×28 en
escritorio para no romper la fila de botones del encabezado.

**A4. Avisar siempre; sonar como WhatsApp.** Este es el cambio de comportamiento.

- Se elimina la supresión: `debeNotificar()` deja de bloquear. **Todo mensaje
  entrante manda push.**
- El colapso por chat ya funciona: `lib/push.js:86` manda `tag` y `sw.js:37` lo usa,
  así que los mensajes de una misma conversación ya se reemplazan entre sí.
- **`ultimo_push_at` cambia de significado: de "silenciar" pasa a "no volver a
  sonar".** Si el último push a esa conversación fue hace menos de **60 s**, el
  payload lleva `renotify: false` (el aviso se actualiza callado); si no,
  `renotify: true` (suena). Es el equivalente de `setOnlyAlertOnce` de Android.
- `sw.js` pasa a leer `d.renotify` en vez de tenerlo fijo en `true`.

La columna no se borra ni se migra: se sigue escribiendo igual, solo cambia quién la
lee y para qué. **No hace falta migración.**

`limpiarPush()` (el reseteo al contestar, en `/api/saliente`) se mantiene tal cual:
pone `ultimo_push_at` en NULL, y con el significado nuevo eso quiere decir "la
próxima entrante suena sí o sí". Sigue sirviendo, sin tocarlo.

⚠️ `debeNotificar()` está exportada y tiene pruebas propias (parte de los 15 tests
del push). No se borra: **cambia de trabajo y de nombre** — pasa a ser
`debeSonar(ultimoPushAt, ahoraMs, ventanaMs = 60_000)`, misma firma y misma lógica,
pero su respuesta ya no decide *si se manda* sino *si suena*. Las pruebas se
adaptan, no se tiran, y hay que sumar una que verifique lo nuevo: que con la ventana
activa **igual se manda el push**, solo que callado. Esa es la prueba que distingue
este arreglo de un rename cosmético.

**A5. Activarlo y probarlo en vivo.** Suscribir el Android desde el icono de la
pantalla de inicio y confirmar con `app/api/push/test/route.js` que suena de verdad.
Verificación: aparece una fila en `inbox.push_subs` con `user_agent` de Android.
**Mientras esa fila no exista, nada de esto está arreglado.**

**A6. Batería (manual, lo hace Rodrigo).** Chrome en "Sin restricciones" en los
ajustes de batería del Android. Sin esto, Android puede matar el proceso igual.

### C — Telegram de pendientes (queda listo y mudo)

No es un eco del push. **Es un recordatorio de estado**, que es lo que el push
estructuralmente no puede dar.

**C1. `lib/telegram.js`.** Un `enviarTelegram()` que es **no-op silencioso** si
faltan `TELEGRAM_BOT_TOKEN` o `TELEGRAM_CHAT_ID` — mismo patrón que
`pushConfigurado()`. Así se despliega hoy y no rompe nada hasta que existan las
variables. Nunca lanza; mira `res.ok` (un `fetch` no lanza con 4xx/5xx).

**C2. `app/api/cron/pendientes/route.js`.** Cada 5 min:

- Cuenta los chats de `cuenta='MANDI'` con `estado='pendiente'` cuyo
  `ultimo_entrante_at` tiene más de **10 min**.
- Si hay ≥1 → un mensaje a Telegram: cuántos son, cuál es el que más espera y
  cuánto lleva, con el link directo a ese chat.
- **Insiste cada 30 min** mientras siga habiendo pendientes. Si vaciás la bandeja,
  calla solo — sin acción de nadie.
- Solo entre **8:00 y 21:00 hora Ecuador**. Usar los helpers de `lib/parseFecha`;
  recortar el ISO a mano corre los mensajes de la noche al día siguiente.
- La ruta va en el `matcher` de exclusión del middleware, como
  `api/cron/seguimientos`, y se defiende con el secreto de cron.

**C3. El anti-repetición vive en la BASE, no en RAM.** Las funciones de Vercel son
efímeras; un `Set` en memoria manda avisos duplicados. Es la misma lección que dejó
el enfriamiento del push. Concreto: **columna nueva `ultimo_aviso_telegram_at` en
`inbox.conversaciones`** (mismo patrón que `ultimo_push_at`, sin tabla nueva). El
cron solo incluye en el aviso los chats cuyo valor sea nulo o de hace >30 min, y lo
estampa en los que avisó. Migración: una sola columna `timestamptz` nullable, que se
registra sola en `supabase_migrations.schema_migrations` vía `apply_migration`.

**C4. Configuración.** `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` se cargan **por el
panel web de Vercel**, nunca por PowerShell: le pegan un BOM invisible que revienta
solo en producción.

## Qué NO se hace, y por qué

- **APK / TWA / Capacitor.** No arregla nada de lo medido: con el botón mudo, una
  APK tampoco suscribe. Costo real (keystore, cuenta de Play, revisiones) contra un
  problema que ya está diagnosticado en otro lado. Si después de A el ahorro de
  batería de Android sigue matando avisos, ahí sí se reabre.
- **Telegram como eco del push.** Sería un segundo canal con el mismo hueco de
  flanco. El valor de Telegram está justo en lo que el push no puede hacer.
- **Tocar IND en esta tanda.** El parche A aplica igual, pero se porta después de
  verificar en MANDI — como se hizo con el push el 26-jul.

## Verificación (nada se da por hecho)

| Afirmación | Cómo se comprueba |
|---|---|
| El celular quedó suscrito | Fila nueva en `inbox.push_subs` con `user_agent` de Android **y** `cuenta='MANDI'` |
| Suena de verdad | `/api/push/test` con el celular bloqueado y en el bolsillo |
| Ya no se pierde el 2° mensaje | Dos entrantes seguidos del mismo número: llegan los dos, suena una vez |
| Contestar reinicia el sonido | Contestar y que la siguiente entrante **sí** suene |
| El botón ya no falla mudo | Forzar un fallo (avión) y ver el Toast en el celular |
| Telegram está mudo pero vivo | Sin variables: el cron corre y no manda nada, y no aparece error |
| Telegram avisa cuando toca | Con variables: dejar un chat pendiente 10 min y ver llegar el aviso |

La última fila del push (`enfriamiento`) y la de Telegram son las únicas que exigen
esperar tiempo real. Ninguna verificación necesita mandarle nada a una clienta.
