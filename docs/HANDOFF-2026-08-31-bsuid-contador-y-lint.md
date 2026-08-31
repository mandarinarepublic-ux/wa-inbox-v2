# IND + MANDI — el teléfono deja de ser el identificador, y tres bugs que nadie veía (31-ago-2026)

Este documento vale para **los dos inbox**. Está igual en `ind-inbox-next` y en
`wa-inbox-next`.

**Arrancó con un síntoma de dos líneas** —«a veces el cambio de bandejas se demora
unos 4 segundos, y dice que tengo 3 pendientes pero muestra dos»— y terminó
destapando que **Meta está cambiando cómo se identifica a un cliente**.

Todo lo de acá está desplegado y verificado. Lo que quedó pendiente está al final,
con el porqué.

| | IND (`ind-inbox-v2`) | MANDI (`wa-inbox-v2`) |
|---|---|---|
| Último commit | `67e3b33` | `83aca1e` |
| Pruebas | 430 verdes | 491 verdes |
| Lint | limpio (1 aviso a propósito) | limpio (1 aviso a propósito) |

---

## 1. La carga infinita estaba rota en IND — y era peor de lo reportado

Rodrigo reportó que no funcionaba la carga de historial hacia arriba. La causa
apareció en los **logs del servidor**, no en el código del navegador:

```
ReferenceError: antesDe is not defined
```

`/api/hilo` devolvía **500 en TODA carga de hilo**, no solo al subir. O sea que
abrir cualquier chat estaba fallando.

☠️ **La causa fue mía y de un tipo que conviene reconocer:** un script de edición
**imprimió** el cambio en vez de guardarlo, y no lo verifiqué. Se agregó el filtro
a la consulta y nunca el parámetro a la firma de la función.

### Lo que lo hizo invisible

Ni el build ni las 427 pruebas lo cazan: es un error de **ejecución**, y ninguna
prueba llama a esa función.

Y encima quedó tapado por un segundo bug: el `getJSON` de IND hacía
`return res.json()` **sin mirar `res.ok`**. El 500 llegaba como si fuera el dato,
el historial no crecía, y el código concluía **«ya no hay más historial»**,
apagando la carga infinita de ese chat **hasta recargar la página**.

⚠️ Nadie reclama por eso: no se ve roto, el historial simplemente se acaba antes.

### Los tres arreglos

| | IND | MANDI |
|---|---|---|
| Parámetro `antesDe` en la firma | ✅ faltaba | ya estaba |
| `getJSON` mira `res.ok` | ✅ puesto | ya estaba |
| Un fallo ≠ «no hay más historial» | ✅ | ✅ también |

IND `f43f3ea` · MANDI `79b2d70`.

> **La lección:** cuando algo «no funciona», mirar primero si la ruta responde.
> Se perdió media hora leyendo código de navegador teniendo la respuesta a una
> consulta de distancia, en los logs.

---

## 2. ESLint en los dos repos — cazó tres bugs VIVOS en la primera corrida

Ninguno de los dos repos tenía revisor. **Tres veces** se subió a producción una
palabra que no existía en ningún lado, y las tres pasaron el build **y** las
pruebas: `ORANGE`, `antesDe`, y las que salieron ahora.

`no-undef` las caza en un segundo. Es la herramienta correcta para toda esta
familia.

### Lo que encontró apenas se instaló

| repo | qué | consecuencia |
|---|---|---|
| IND | `enviarDocumentoUrl` usada sin importar | mandar un **documento desde una respuesta rápida** reventaba. MANDI sí la importaba |
| MANDI | `setBandeja` / `claveBandeja`, que **no existen** | ver abajo |
| ambos | se perdía el error original al fallar la conversión de audio | arreglado con `{ cause: e }` |

☠️ **El de MANDI es el que más enseña.** Estaba en el código que REVIERTE la fila
cuando falla guardar un cambio de estado. En vez de revertir lanzaba un
`ReferenceError`, y como reventaba **antes del `setToast`**, el vendedor no veía
ni el error: la fila quedaba pintada con el estado nuevo. *El código escrito para
que la pantalla no mienta, mintiendo.* El arreglo era llamar a `pintar()`, que ya
existía tres líneas más arriba.

⚠️ Un bug así **no se nota nunca**: solo aparece cuando ADEMÁS falla el guardado.

### Cómo quedó montado

- Corre con **`npm test`** (`node --test … && npm run lint`), en la compu.
- ☠️ **NO corre en Vercel a propósito** (`eslint: { ignoreDuringBuilds: true }` en
  `next.config.js`). `next build` lintea solo si encuentra `eslint.config.mjs`, y
  eso alargaría CADA despliegue: Build CPU llegó a ser el 29% de la factura.
  ☑️ Verificado: el build dice `Skipping linting` y tarda igual (28s / 30s).
  ⚠️ **No hay red si alguien sube sin correr `npm test`.**
- Reglas apagadas **a propósito y explicadas en la config**: `no-unused-vars`,
  `no-empty` (por los `catch {}` de best-effort) y `no-irregular-whitespace` con
  `skipRegExps` (el BOM de Vercel va escrito dentro de una regex).
  **Un revisor ruidoso se ignora, y entonces no revisa nada.**
- 🟡 Queda **un** aviso, con nombre y apellido en la config: `MultiImgEditor`
  (`RightPanel.jsx`) llama `useRef` dentro de un `Array.from`. Violación real que
  **hoy no rompe** (`MAX_IMGS` es constante). Arreglarlo toca el editor de
  adjuntos, donde el ORDEN es el que ve el cliente → **no se hace de paso**.
- ☑️ **Control negativo en los dos**: un archivo con una variable inventada hace
  fallar el lint. *Instalar el revisor y no probarlo contra el bug que motivó
  ponerlo sería repetir el error original.*

IND `37cca91` · MANDI `8d27f36`.

---

## 3. IND: contactos con columnas acotadas (paridad con MANDI)

El sync traía `select('*')` de las 3.967 conversaciones de IND para usar 16
campos.

| | peso |
|---|---|
| Fila completa (como estaba) | **1.220 kB** |
| Solo lo que se usa | **476 kB** |

**61% menos**, en el rubro más caro de la factura (Fast Origin Transfer) y en la
app que es el **90%** de ese gasto.

Las 14 que se dejan de traer: `cuenta`/`canal` (filtro), restos de la época de
Sheets (`humano`, `soporte`, `refuerzo1/2`), `no_leidos` (**cero en las 3.967
filas**, nunca se llenó), `ctwa_*` (se leen por otra consulta), `fecha_creacion`
(nadie la usa hoy), `conversacion_id` (PostgREST **ordena por columnas que no se
piden**) y `updated_at` (el ETag la lee por `max()`).

☑️ **Seguro porque las filas crudas mueren en `getContactosSupabase`**: solo sale
lo que arma `toContacto`.

☠️ **SE ACORTAN LAS COLUMNAS, JAMÁS LAS FILAS.** Filtrar este mapa por número
devuelve el bug de que ARCHIVAR no pega.

⚠️ **La trampa que abre**, y por qué hay `tests/columnas-contacto.test.js`: si
alguien agrega un campo a `toContacto` y olvida la columna, ese campo llega
**`undefined` para siempre** sin reventar nada — solo deja de verse el alias, o la
temperatura. La prueba **LEE el código de `toContacto`** y exige que cada columna
que toca esté pedida. ☑️ Verificada con control negativo: al quitarle `modo_ia` se
cae **y dice cuál falta**.

IND `b5963d4` (MANDI ya lo tenía desde el 29-ago, `8983bcc`).

---

## 4. «Dice 3 pendientes y muestra 2» — eran DOS causas distintas

Se investigó con dos agentes en paralelo: uno leyendo el código, otro midiendo la
base. **Llegaron al mismo sitio por caminos independientes.**

### Causa A — un cliente de un anuncio pagado, sin número de teléfono

☞ Ver la sección 5, que es lo grande.

### Causa B — el contador sumaba doble (ARREGLADA)

El contador y la lista leían el estado de **dos lugares distintos**:

| | fuente del estado |
|---|---|
| el CONTADOR (`inbox.pendientes_por_canal`) | `conversaciones.estado` → **uno por PERSONA** |
| la LISTA (`inbox.lista_bandeja`) | `bandeja.estado` → **uno por persona Y CANAL** |

Quien escribe por los DOS números y está pendiente **se contaba dos veces**.
Medido: botón del 9804 de IND decía **22** con **21** en la lista.

☠️ **SEGUNDA VUELTA DEL MISMO BUG.** El 11-ago se arregló que el contador agrupara
*por canal* (decía 1 donde había 7). Quedó a medias sin que se notara: se corrigió
**por cuál número agrupar** y NO **de dónde sale el estado**.

☠️ Y lo que lo mantuvo vivo tres semanas fue **un comentario en
`lib/inbox-supabase.js` que afirmaba que la vista contaba «igual que la lista»**.
Era cierto a medias. *Los comentarios que describen una equivalencia envejecen
peor que el código: cuando se arregla la mitad, el comentario sigue diciendo que
está entero.* Corregido en los dos repos.

☑️ **MANDI ya estaba sano** — cuenta de `bandeja` por el rpc
`inbox.pendientes_bandeja` desde el principio. Era **paridad que faltaba en IND**,
no un bug nuevo.

> ⚠️ **Pista general:** «pasa en uno y no en el otro» casi siempre significa que
> falta portar algo, no que el dato esté mal.

☑️ Verificado: **diferencia 0** en los 5 canales de las 2 cuentas.

### Y salió 112x más rápido

Esa consulta corre en **cada ciclo de sondeo**:

| | |
|---|---|
| antes | **1.627 ms** — `conversaciones ⨝ mensajes`, 4.065 mensajes leídos para contar 24 |
| contar desde `lista_bandeja` | 2.217 ms — correcto pero AÚN más lento → **descartado por medida** |
| ahora | **14 ms** — `bandeja` directo |

⚠️ **La invariante de la que depende:** toda conversación con mensajes en un canal
tiene que tener fila en `bandeja`. Faltaba 1 en IND (el número de prueba de Meta,
mensaje de 2017). Si falta una, la lista la muestra PENDIENTE (por el `COALESCE`)
y el contador **NO la cuenta** → un chat sin contestar **fuera** del contador, que
es el lado peligroso del error.

Se sostiene con `inbox.completar_bandeja()`, llamada desde el cron de entregas:
**se garantiza, no se confía.**

IND `67e3b33` · MANDI `83aca1e`.

---

## 5. ☠️ Lo grande: Meta está reemplazando el teléfono por el BSUID

Investigando el chat que no se dibujaba apareció esto, que es más importante que
el síntoma.

Meta está sacando los **nombres de usuario** de WhatsApp durante 2026. La gente
puede escribirle a un negocio **sin darle su celular**. En lugar del teléfono llega
un **BSUID** (*business-scoped user ID*, ej. `CO.2025341914840016`), único por par
usuario↔negocio y estable.

📄 https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/

- **abr-2026** empiezan a llegar en los webhooks
- **jul-2026** ya se puede **ENVIAR** por BSUID
- ⚠️ **El teléfono solo se entrega durante 30 días** desde la última interacción.
  Pasados esos, si la persona usa nombre de usuario, el BSUID es **lo único** con
  lo que se le puede volver a escribir.
- Meta lo declara **obligatorio** para todos los negocios integrados.

### Medido en la base (31-ago)

| | |
|---|---|
| Contactos entrantes en agosto | 153.568 |
| Que **ya** traen BSUID | **153.521 (100%)** |
| Contactos SIN teléfono | **1 de 204.554** |

El único caso: **22-ago, IND, canal 3326, desde un anuncio pagado** («Usa algo
ÚNICO como TÚ»). Meta mandó `profile.name` = *fercho García* y
`profile.username` = *fernan4834*, **sin `wa_id`**.

☑️ En estas cuentas el BSUID empezó a llegar el **16-jul-2026**, corte limpio.

### Lo que se hizo

- Columna `inbox.conversaciones.bsuid` + índice.
- **Relleno histórico**: IND **3.683/3.968** · MANDI **902/1.822**. Los que faltan
  dejaron de escribir antes del 16-jul — a esos Meta nunca se lo mandó.
  **No es un fallo del relleno, es un corte de fecha.**
- Se mantiene al día con `inbox.rellenar_bsuid(dias)` desde el **cron de entregas**
  (30 min).

☠️ **NO ES UN TRIGGER, y esa es la decisión de diseño que importa.** Un trigger
sobre `mensajes` correría DENTRO de la transacción del webhook: si falla, **el
mensaje entrante no se guarda**. La restricción de Rodrigo es explícita —no se
toca ni recibir ni enviar—. Como el BSUID ya viaja en `mensajes.raw` (retención
**sin límite**), rellenarlo 30 minutos después queda **igual de completo** sin
poner código nuevo en el camino por donde entran los mensajes de los clientes.

⚠️ Va **primero** en el cron y **fuera** del camino del aviso: ese cron tiene **dos
salidas** y colgarlo de una sola lo dejaría corriendo la mitad de las veces sin que
nadie lo note.

☑️ Control negativo: se le borró el bsuid a una conversación, la función lo repuso,
totales idénticos.

IND `fe13c74` · MANDI `e9bca8b`.

---

## Migraciones aplicadas (la base es UNA, sirve a los dos)

| nombre | qué hace |
|---|---|
| `conversaciones_bsuid` | columna `bsuid` + índice + relleno histórico |
| `rellenar_bsuid_funcion` | `inbox.rellenar_bsuid(dias)` — la llama el cron, NUNCA el webhook |
| `completar_bandeja_funcion` | `inbox.completar_bandeja()` — sostiene la invariante del contador |
| `pendientes_por_canal_desde_bandeja` | la vista del contador ahora lee de `bandeja` |

---

## ⏳ Pendientes, con el porqué

### 1. Poder CONTESTARLE a un cliente sin teléfono

Rodrigo eligió **no tocar `/api/saliente` todavía**. El formato de Meta es
`recipient: <BSUID>` **omitiendo `to`**; si van los dos, gana el teléfono.
Diseñarlo como **puro agregado**: con teléfono, el camino de hoy **intacto**.

⚠️ A *fercho García* la ventana de 24 h ya se cerró → haría falta plantilla, y a la
WABA de IND **le faltan recrear las 4**.

### 2. Que el chat sin teléfono se VEA

Hoy `pintable` (`lib/inbox-supabase.js`) exige ≥9 dígitos y lo descarta, mientras
el contador sí lo cuenta. **Ese es el «3 vs 2» que queda.**

☠️ **No es un cambio de una línea, y por eso NO se hizo de paso:** la lista se
agrupa **por teléfono**, así que dos conversaciones sin número se **fusionarían en
silencio** en una sola fila. Hace falta una clave de verdad (`conversacion_id` o el
bsuid), y para eso hay que tocar `ultimos_mensajes_canal` — **la vista de los
3,7 s que ya da timeout 10-29 veces al día**. → va junto con el punto 3, con
período de comparación en paralelo.

### 3. Los 4 segundos al cambiar de bandeja

Al cambiar de número el inbox **borra su marca de versión** y ya no puede recibir
un «sin novedad»: se paga el ciclo completo. Es el **único** momento del día en que
eso pasa.

Ya se le quitaron dos pedazos: **−61%** del payload de contactos (§3) y **−1.613 ms**
del contador (§4). Lo que queda es la consulta de la lista: recorre **35.408
mensajes** para dar 1.965 filas.

☑️ Descartado con datos: no es disco ni CPU. La propuesta es completar
`inbox.bandeja` con el texto del último mensaje y que la lista lea de ahí.
⚠️ **Duplica datos → va con período de comparación en paralelo** contra la consulta
vieja, y solo se cambia la lectura cuando coincidan al 100%.

### 4. `bsuid` NO está en `COLS_CONTACTO`, a propósito

Son ~100 kB por ciclo de un dato que **todavía nadie usa**, justo después de
recortar ese payload un 61%. Se agrega cuando el envío lo pida.

### 5. Otros que siguen abiertos

- `META_APP_SECRET` de IND (bloqueado en Rodrigo). La firma de Meta sigue en
  **modo observación** + aviso por Telegram.
- El aviso de `useRef` en `MultiImgEditor` (§2).
- Los ~10-29 `statement timeout` (57014) diarios en `/api/inbox-sync` de IND — los
  causa la consulta del punto 3.
- Verificar la factura al cierre del ciclo (**22-sep**), proyectada en ~$28.

---

## Cómo comprobar que esto sigue sano

```sql
-- El contador tiene que coincidir con la lista. Diferencia 0 en TODOS los canales.
with c as (select cuenta, phone_id, pendientes from inbox.pendientes_por_canal),
     l as (select cuenta, phone_id, count(*)::int n
           from inbox.lista_bandeja where estado_bandeja='PENDIENTE' group by 1,2)
select coalesce(c.cuenta,l.cuenta), coalesce(c.phone_id,l.phone_id),
       coalesce(c.pendientes,0) - coalesce(l.n,0) as diferencia
from c full join l on c.cuenta=l.cuenta and c.phone_id=l.phone_id;

-- La invariante del contador: tiene que dar 0.
select count(*) from inbox.ultimos_mensajes_canal u
left join inbox.bandeja b on b.cuenta=u.cuenta and b.telefono=u.telefono and b.phone_id=u.phone_id
where b.telefono is null;

-- ¿Están llegando clientes sin teléfono? (hoy: 1 en todo el histórico)
select count(*) from inbox.conversaciones
where coalesce(length(regexp_replace(coalesce(telefono,''),'\D','','g')),0) < 9;
```

Y en la compu, antes de subir cualquier cosa: **`npm test`** en los dos repos.
